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
/// The AI community (docs/ranked-bots.md, phase 7) on the real database: six personas, online all day, play each other
/// away on their own ladder, take a challenge and play a game on the server to watch, always shown as AI.
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
    public async Task PersonasPlayEachOtherAwayOnTheirOwnLadder()
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
            Assert.All(online, name => Assert.EndsWith(" (AI)", name, StringComparison.Ordinal));
            Assert.Equal(0, away);

            // Everyone online played: three games, rated on the AI ladder, without a log or replay.
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

            var (ladder, players) = await app.WithDbAsync(async db =>
            {
                var season = (await Seasons.CurrentAsync(db))!;
                return (await Seasons.Standings(db, season.StartsAt, ai: true).Select(s => s.Name).ToListAsync(),
                    await Seasons.Standings(db, season.StartsAt).Select(s => s.Name).ToListAsync());
            });
            Assert.All(personas, p => Assert.Contains(p.Player!.Name, ladder));
            Assert.All(personas, p => Assert.DoesNotContain(p.Player!.Name, players));

            // The site shows them as AI: on their ladder and their profiles.
            using var browser = app.CreateBrowser();
            var name = personas[0].Player!.Name;
            var aiLadder = await (await browser.GetAsync("/Season/Ai")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains(name, aiLadder, StringComparison.Ordinal);
            var profile = await (await browser.GetAsync("/Player/Profile/" + name)).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains("AI player", profile, StringComparison.Ordinal);
            Assert.Contains("not a person", profile, StringComparison.Ordinal);
            var home = JsonNode.Parse(await (await browser.GetAsync("/Home/Community")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!;
            Assert.NotNull(home["feed"]);
            // Their games with each other stay off the players' "Recent games".
            var recent = JsonNode.Parse(await (await browser.GetAsync("/Home/GetGames")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!.AsArray();
            Assert.DoesNotContain(recent, g => games.Any(x => x.Id == (int)g!["gameId"]!));
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
            Assert.Equal(personas[0].Player!.Name + " (AI)", (string)(await socket.ReceiveTypeAsync(198))["Payload"]!["name"]!);
            await socket.ReceiveTypeAsync(206);

            // A friendly game: it earns nothing and moves no rating. The players' feed shows it, the persona tagged AI.
            await socket.SendAsync(1);
            var result = (await socket.ReceiveTypeAsync(230, 231, 233))["Payload"]!;
            Assert.True((bool)result["friendly"]!);
            var recent = await (await browser.GetAsync("/Home/GetGames")).Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains(personas[0].Player!.Name + " (AI)", recent, StringComparison.Ordinal);
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
        await OnlineAsync(community);
        var options = app.Server.Services.GetRequiredService<IOptions<CommunityOptions>>().Value;
        try
        {
            await community.TickAsync(TestContext.Current.CancellationToken);
            options.LiveGames = 1;
            GameRoom? room = null;
            for (var i = 0; i < 100 && room is null; i++)
            {
                await Task.Delay(100, TestContext.Current.CancellationToken);
                room = await State.RunExclusiveAsync(() => State.Rooms.Values.FirstOrDefault(r => r.Players.First.IsPersona && r.Players.Second.IsPersona));
            }

            Assert.NotNull(room);
            var status = (await app.Server.CreateClient().GetFromJsonAsync<JsonObject>("/community", TestContext.Current.CancellationToken))!;
            Assert.Equal(6, (int)status["ai"]!);
            var live = Assert.Single(status["live"]!.AsArray());
            Assert.Equal(room.GameId, (int)live!["gameId"]!);
            Assert.All(live["players"]!.AsArray(), p => Assert.EndsWith(" (AI)", (string)p!, StringComparison.Ordinal));
            Assert.True((bool)room.Summary()["players"]![0]!["ai"]!);
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
