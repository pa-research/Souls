using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Ai;
using Souls.Server.Game;
using Souls.Server.Network;

namespace Souls.Tests.Integration;

/// <summary>
/// The community (docs/ranked-bots.md, phase 7) on the real database: six personas, online all day, play each other
/// away, rated like players, take a challenge and play a game on the server to watch, shown like any player.
/// </summary>
[Collection(SoulsCollection.Name)]
public class AiCommunityTests(SoulsAppFixture app)
{
    private const string Password = "CorrectHorse9!";

    private ServerState State => app.Server.Services.GetRequiredService<ServerState>();

    private AiCommunity Community(double gamesPerHour = 0) => new(
        State,
        app.Server.Services.GetRequiredService<PlayerRepository>(),
        app.Server.Services.GetRequiredService<IServiceScopeFactory>(),
        TimeProvider.System,
        Options.Create(new CommunityOptions { Size = 6, GamesPerHour = gamesPerHour }),
        app.Server.Services.GetRequiredService<GameMetrics>(),
        NullLoggerFactory.Instance);

    /// <summary>Makes the six personas (once) and sets them online all day today.</summary>
    private async Task<List<Persona>> OnlineAsync(AiCommunity community)
    {
        await community.EnsurePersonasAsync(TestContext.Current.CancellationToken);
        var now = DateTimeOffset.UtcNow;
        return await app.WithDbAsync(async db =>
        {
            var personas = await db.Personas.Include(p => p.Player).OrderBy(p => p.PlayerId).ToListAsync();
            foreach (var persona in personas)
            {
                (persona.PlayFrom, persona.PlayHours) = (0, 24);
                // A whole day later or earlier by its clock, until it is one of its days.
                persona.UtcOffset = Enumerable.Range(0, 7).Select(d => d * 1440).First(offset =>
                {
                    persona.UtcOffset = offset;
                    return AiCommunity.IsOnline(persona, now);
                });
            }

            await db.SaveChangesAsync();
            return personas;
        });
    }

    private Task LeaveAsync() => State.RunExclusiveAsync(() =>
    {
        State.Personas.Clear();
        return Task.CompletedTask;
    });

    [Fact]
    public async Task PersonasPlayEachOtherAwayRatedLikePlayers()
    {
        var community = Community(gamesPerHour: 100_000);
        var personas = await OnlineAsync(community);
        try
        {
            Assert.Equal(6, personas.Count);
            Assert.All(personas, p => Assert.True(p.Player!.IsAi));
            var before = await app.WithDbAsync(db => db.Games.MaxAsync(g => (int?)g.Id));

            await community.TickAsync(TestContext.Current.CancellationToken);

            var (online, away) = await State.RunExclusiveAsync(() => (State.Personas.Values.Select(p => p.Name).ToList(), State.PersonasAway.Count));
            Assert.Equal(6, online.Count);
            Assert.All(personas, p => Assert.Contains(p.Player!.Name, online));
            Assert.Equal(0, away);

            // Everyone online played: three games, rated, without a log or replay.
            var (games, replays) = await app.WithDbAsync(async db =>
            {
                var played = await db.Games.Where(g => g.Id > (before ?? 0) && g.Player1!.IsAi && g.Player2!.IsAi).ToListAsync();
                var ids = played.Select(g => g.Id).ToList();
                return (played, await db.GameReplays.CountAsync(r => ids.Contains(r.GameId)));
            });
            Assert.Equal(3, games.Count);
            Assert.All(games, g => Assert.False(g.IsPractice));
            Assert.Contains(games, g => g.Player1RatingChange != 0);
            Assert.Equal(0, replays);

            var ladder = await app.WithDbAsync(async db => await Seasons.Standings(db, (await Seasons.CurrentAsync(db))!.StartsAt).Select(s => s.Name).ToListAsync());
            Assert.All(personas, p => Assert.Contains(p.Player!.Name, ladder));

            // The site shows them like any player.
            using var browser = app.CreateBrowser();
            var name = personas[0].Player!.Name;
            var season = await (await browser.GetAsync("/Season")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains(name, season, StringComparison.Ordinal);
            var profile = await (await browser.GetAsync("/Player/Profile/" + name)).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains("Player profile", profile, StringComparison.Ordinal);
            Assert.DoesNotContain("(AI)", profile, StringComparison.Ordinal);
            var home = JsonNode.Parse(await (await browser.GetAsync("/Home/Community")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!;
            Assert.NotNull(home["feed"]);
            var recent = JsonNode.Parse(await (await browser.GetAsync("/Home/GetGames")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!.AsArray();
            Assert.Contains(recent, g => games.Any(x => x.Id == (int)g!["gameId"]!));
        }
        finally
        {
            await LeaveAsync();
        }
    }

    [Fact]
    public async Task APersonaAcceptsAChallenge()
    {
        var community = Community();
        var personas = await OnlineAsync(community);
        try
        {
            await community.TickAsync(TestContext.Current.CancellationToken);
            var name = "c" + Guid.NewGuid().ToString("N")[..10];
            using var browser = app.CreateBrowser();
            await browser.RegisterAsync(name, Password);
            using var _ = await browser.LoginAsync(name, Password);
            await using var socket = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await socket.SendAsync(0);
            await socket.ReceiveTypeAsync(10);

            await socket.SendAsync(199, new JsonObject { ["name"] = personas[0].Player!.Name.ToLowerInvariant() });
            Assert.Equal(personas[0].Player!.Name, (string)(await socket.ReceiveTypeAsync(198))["Payload"]!["name"]!);
            await socket.ReceiveTypeAsync(206);

            // A friendly game: it earns nothing and moves no rating.
            await socket.SendAsync(1);
            var result = (await socket.ReceiveTypeAsync(230, 231, 233))["Payload"]!;
            Assert.True((bool)result["friendly"]!);
        }
        finally
        {
            await LeaveAsync();
        }
    }

    [Fact]
    public async Task PersonasPlayOnTheServerForPlayersToWatch()
    {
        var community = Community();
        var personas = await OnlineAsync(community);
        var options = app.Server.Services.GetRequiredService<IOptions<CommunityOptions>>().Value;
        try
        {
            await community.TickAsync(TestContext.Current.CancellationToken);
            options.LiveGames = 1;

            // The bots think without delay here, so a game is over in moments; the matchmaker starts the next at once.
            var names = personas.Select(p => p.Player!.Name).ToHashSet();
            using var client = app.Server.CreateClient();
            JsonObject? live = null;
            for (var i = 0; i < 100 && live is null; i++)
            {
                var status = (await client.GetFromJsonAsync<JsonObject>("/community", TestContext.Current.CancellationToken))!;
                Assert.True((int)status["players"]! >= 6);
                live = status["live"]!.AsArray().Select(g => g!.AsObject()).FirstOrDefault(g => g["players"]!.AsArray().All(p => names.Contains((string)p!)));
                await Task.Delay(50, TestContext.Current.CancellationToken);
            }

            Assert.NotNull(live);
            // Not shown as a bot to whoever watches.
            var summary = await State.RunExclusiveAsync(() => State.Rooms.Values.FirstOrDefault(r => r.Players.First.IsPersona)?.Summary());
            Assert.True(summary is null || !(bool)summary["players"]![0]!["bot"]!);
        }
        finally
        {
            options.LiveGames = 0;
            var engine = app.Server.Services.GetRequiredService<GameEngine>();
            await State.RunExclusiveAsync(async () =>
            {
                foreach (var room in State.Rooms.Values.Where(r => r.Players.First.IsPersona).ToList())
                {
                    await engine.EndGameAsync(room, isDraw: true);
                }
            });
            await LeaveAsync();
        }
    }
}
