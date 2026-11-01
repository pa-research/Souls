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
builder.Services.AddSoulsAuthentication(builder.Configuration);
builder.Services.AddSoulsForwardedHeaders(builder.Configuration);
builder.Services.AddSoulsTelemetry(builder.Configuration);

builder.Services.Configure<WebSocketOptionsConfig>(builder.Configuration.GetSection("Souls:WebSockets"));
builder.Services.Configure<MatchmakerOptions>(builder.Configuration.GetSection("Souls:Matchmaker"));
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Souls:Bot"));
builder.Services.Configure<GameOptions>(builder.Configuration.GetSection("Souls:Game"));
builder.Services.Configure<CommunityOptions>(builder.Configuration.GetSection("Souls:Community"));

builder.Services.AddSingleton<ServerState>();
builder.Services.AddSingleton<GameMetrics>();
builder.Services.AddSingleton<GameEngine>();
builder.Services.AddSingleton<GameStore>();
builder.Services.AddSingleton<ChatEngine>();
builder.Services.AddSingleton<PlayerRepository>();
builder.Services.AddSingleton<GameService>();
builder.Services.AddSingleton<ChatService>();
builder.Services.AddSingleton<AdminService>();
builder.Services.AddSingleton<ConnectionRegistry>();
builder.Services.AddSingleton<OriginPolicy>();
builder.Services.AddHostedService<Matchmaker>();
builder.Services.AddHostedService<AiCommunity>();

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

// Who is online, for the site's lobby: players and the AI community apart, and the AI games running here to watch.
app.MapGet("/community", (ServerState state) => state.RunExclusiveAsync(() => new
{
    players = state.GameClients.Values.Concat(state.ChatClients.Values).Where(p => !p.IsBot && p.DisconnectedAt is null).Select(p => p.Id).Distinct().Count(),
    ai = state.Personas.Count,
    // A few who are free now, by account name, to challenge from the lobby.
    idle = state.Personas.Values.Where(state.IsFree).Select(p => p.Name[..^Souls.Model.Localization.Strings.PersonaTag.Length]).Order().Take(8).ToList(),
    live = state.Rooms.Values.Where(r => r.Players.First.IsPersona && r.Players.Second.IsPersona && !r.IsEnded)
        .Select(r => new { gameId = r.GameId, players = new[] { r.Players.First.Name, r.Players.Second.Name } }).ToList(),
}));

await app.RunAsync();
return 0;

