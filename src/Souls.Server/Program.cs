using Souls.Model.Hosting;
using Souls.Server.Ai;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;

if (await SoulsCommands.TryRunHealthCheckAsync(args) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(SoulsCommands.HostArgs(args));
builder.Configuration.AddSoulsSecrets();
if (SoulsCommands.IsMigrate(args))
{
    // EF Core logs an error while probing for the migrations table on an empty database.
    builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Critical);
}
builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.AddServerHeader = false;
    kestrel.Limits.MaxRequestBodySize = 64 * 1024;
});

builder.Services.AddSoulsDatabase();
builder.Services.AddSoulsAuthentication();
builder.Services.AddSoulsForwardedHeaders(builder.Configuration);

builder.Services.Configure<WebSocketOptionsConfig>(builder.Configuration.GetSection("Souls:WebSockets"));
builder.Services.Configure<MatchmakerOptions>(builder.Configuration.GetSection("Souls:Matchmaker"));
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Souls:Bot"));

builder.Services.AddSingleton<ServerState>();
builder.Services.AddSingleton<GameEngine>();
builder.Services.AddSingleton<ChatEngine>();
builder.Services.AddSingleton<PlayerRepository>();
builder.Services.AddSingleton<GameService>();
builder.Services.AddSingleton<ChatService>();
builder.Services.AddSingleton<AdminService>();
builder.Services.AddSingleton<ConnectionRegistry>();
builder.Services.AddSingleton<OriginPolicy>();
builder.Services.AddHostedService<Matchmaker>();

var app = builder.Build();

if (SoulsCommands.IsMigrate(args))
{
    await SoulsCommands.RunMigrationsAsync(app);
    return 0;
}

app.UseForwardedHeaders();
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(20),
    KeepAliveTimeout = TimeSpan.FromSeconds(60),
});
app.UseAuthentication();

app.MapSoulsHealthChecks();
app.MapSoulsWebSockets();
app.MapGet("/", () => "Souls game server");

await app.RunAsync();
return 0;

