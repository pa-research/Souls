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

// Who is online, for the home page: the players (the community's personas among them), a few free to challenge, and
// the community's games running here to watch.
app.MapGet("/community", (ServerState state) => state.RunExclusiveAsync(() =>
{
    var lobby = state.GameClients.Values.Where(p => !p.IsBot && p.DisconnectedAt is null).DistinctBy(p => p.Id).ToList();
    var personas = state.Personas.Values.ToList();
    return new
    {
        players = lobby.Count + personas.Count,
        idle = lobby.Where(p => p.GPlayer is null).Concat(personas.Where(state.IsFree)).Select(p => p.Name).OrderBy(_ => Random.Shared.Next()).Take(8).ToList(),
        live = state.Rooms.Values.Where(r => !r.IsEnded && !r.IsPractice && !r.Players.First.IsPracticeBot && !r.Players.Second.IsPracticeBot)
            .OrderByDescending(r => r.Spectators.Count).Take(4)
            .Select(r => new { gameId = r.GameId, players = new[] { r.Players.First.Name, r.Players.Second.Name } }).ToList(),
    };
}));

await app.RunAsync();
return 0;

