using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;

namespace Souls.Tests.Integration;

/// <summary>
/// Running games survive a restart of the game server (P3-17): it saves them when it stops, the next instance restores
/// them and the clients reconnect. Own database (class fixture), because restarting restores every saved game.
/// </summary>
public class RestartTests(SoulsAppFixture app) : IClassFixture<SoulsAppFixture>
{
    private const string Password = "CorrectHorse9!";

    private async Task<(TestBrowser Browser, string Name)> LoggedInPlayerAsync(int playerType = 1)
    {
        var name = "r" + Guid.NewGuid().ToString("N")[..10];
        var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password, playerType);
        using var _ = await browser.LoginAsync(name, Password);
        return (browser, name);
    }

    private async Task<GameSocket> JoinAsync(TestBrowser browser)
    {
        var socket = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
        await socket.SendAsync(0);
        await socket.ReceiveTypeAsync(10);
        return socket;
    }

    private static int Type(JsonNode message) => (int)message["Type"]!;

    private static List<int> HandCids(JsonNode create) => [.. create["player"]!["hand"]!.AsObject().Select(c => int.Parse(c.Key, System.Globalization.CultureInfo.InvariantCulture))];

    /// <summary>Restarts the server; it closes every open connection first.</summary>
    private async Task RestartAsync(params GameSocket[] sockets)
    {
        var restart = app.RestartServerAsync();
        foreach (var socket in sockets)
        {
            Assert.True(await socket.WaitForCloseAsync(), "the server closes the connection");
            await socket.DisposeAsync();
        }

        await restart;
    }

    [Fact]
    public async Task ARankedGameWithASpectatorSurvivesARestartDuringTheMulligan()
    {
        var (browserA, nameA) = await LoggedInPlayerAsync();
        var (browserB, nameB) = await LoggedInPlayerAsync(2);
        var (browserC, _) = await LoggedInPlayerAsync(3);
        using (browserA)
        using (browserB)
        using (browserC)
        {
            var a = await JoinAsync(browserA);
            var b = await JoinAsync(browserB);
            await a.SendAsync(100);
            await b.SendAsync(100);
            var createA = (await a.ReceiveTypeAsync(206))["Payload"]!;
            await b.ReceiveTypeAsync(206);
            var gameId = (int)createA["gameId"]!;
            var identA = (int)createA["ident"]!;

            // A replaces a card; B has not chosen yet when the server restarts. C watches.
            await a.SendAsync(227, new JsonObject { ["replace"] = new JsonArray(HandCids(createA)[0]) });
            var handA = (await a.ReceiveTypeAsync(227))["Payload"]!["hand"]!.AsArray().Select(c => (int)c!["cid"]!).ToList();
            var c = await JoinAsync(browserC);
            await c.SendAsync(241, new JsonObject { ["gameId"] = gameId });
            await c.ReceiveTypeAsync(241);

            await RestartAsync(a, b, c);
            Assert.True(await app.WithDbAsync(db => db.RunningGames.AnyAsync(g => g.GameId == gameId)));

            // Everybody reconnects (the clients send LOGIN and their queue request again) and finds the game as it was.
            a = await JoinAsync(browserA);
            b = await JoinAsync(browserB);
            c = await JoinAsync(browserC);
            await using var _ = a;
            await using var __ = b;
            await using var ___ = c;
            await a.SendAsync(100);
            var againA = (await a.ReceiveTypeAsync(206))["Payload"]!;
            Assert.Equal(gameId, (int)againA["gameId"]!);
            Assert.Equal(identA, (int)againA["ident"]!);
            Assert.Equal(handA, HandCids(againA));
            Assert.True((bool)againA["mulligan"]!["done"]!);
            Assert.True((long)againA["mulligan"]!["endsIn"]! >= 14_000);
            await a.ReceiveTypeAsync(236);
            await b.SendAsync(100);
            var againB = (await b.ReceiveTypeAsync(206))["Payload"]!;
            Assert.False((bool)againB["mulligan"]!["done"]!);
            await c.SendAsync(241, new JsonObject { ["gameId"] = gameId });
            Assert.Equal(nameA, (string)(await c.ReceiveTypeAsync(241))["Payload"]![identA == 1 ? "player" : "opponent"]!["info"]!["name"]!);

            // B keeps the hand: the game starts and goes on.
            await b.SendAsync(227);
            var (first, second) = identA == 1 ? (a, b) : (b, a);
            Assert.True((bool)(await first.ReceiveTypeAsync(226))["Payload"]!["yourTurn"]!);
            await second.ReceiveTypeAsync(226);
            await first.SendAsync(226);
            Assert.True((bool)(await second.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!))["Payload"]!["yourTurn"]!);

            // A leaves: B wins. The result is stored once, with the replay from before and after the restart.
            await a.SendAsync(1);
            var result = await b.ReceiveTypeAsync(230, 231, 233);
            Assert.Equal(230, Type(result));
            var changeB = (int)result["Payload"]!["ratingChange"]!;
            Assert.True(changeB > 0);
            await c.ReceiveTypeAsync(242);
            var statistics = (int)result["Payload"]!["statistics"]!;

            var (games, ratingB, running, replay) = await app.WithDbAsync(async db => (
                await db.Games.Where(g => g.Player1!.Name == nameA || g.Player2!.Name == nameA).ToListAsync(),
                await db.Players.Where(p => p.Name == nameB).Select(p => p.Rating).SingleAsync(),
                await db.RunningGames.CountAsync(g => g.GameId == gameId) + await db.RunningGameReplays.CountAsync(r => r.GameId == gameId),
                await db.GameReplays.SingleAsync(r => r.GameId == statistics)));
            Assert.Equal(statistics, Assert.Single(games).Id);
            Assert.Equal(Ratings.Initial + changeB, ratingB);
            Assert.Equal(0, running);
            var types = JsonNode.Parse(replay.Data)!.AsArray().Select(r => (int)r!["m"]!["Type"]!).ToList();
            Assert.Equal(241, types[0]);
            Assert.Equal(242, types[^1]);
            Assert.Contains(identA == 1 ? 227 : 228, types); // A's mulligan, before the restart
            Assert.Equal(2, types.Count(t => t == 226)); // the turns after it
        }
    }

    [Fact]
    public async Task APracticeGameSurvivesARestartAndTheBotPlaysOn()
    {
        var (browser, _) = await LoggedInPlayerAsync(4);
        using (browser)
        {
            var game = await JoinAsync(browser);
            await game.SendAsync(101, new JsonObject { ["difficulty"] = 2 });
            var create = (await game.ReceiveTypeAsync(206))["Payload"]!;
            var gameId = (int)create["gameId"]!;
            var bot = (string)create["opponent"]!["info"]!["name"]!;
            await game.SendAsync(227);
            await game.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!, seconds: 20);
            await game.SendAsync(226);
            await game.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!, seconds: 20);
            var sync = await game.ReceiveTypeAsync(236);

            await RestartAsync(game);

            game = await JoinAsync(browser);
            await using var _ = game;
            await game.SendAsync(101);
            var again = (await game.ReceiveTypeAsync(206))["Payload"]!;
            Assert.Equal(gameId, (int)again["gameId"]!);
            Assert.Equal(bot, (string)again["opponent"]!["info"]!["name"]!);
            Assert.True((bool)again["yourTurn"]!);
            var restored = (await game.ReceiveTypeAsync(236))["Payload"]!;
            Assert.Equal((int)sync["Payload"]!["turn"]!, (int)restored["turn"]!);
            Assert.True(JsonNode.DeepEquals(sync["Payload"]!["board"], restored["board"]));

            // The bot takes its turn after ours.
            await game.SendAsync(226);
            var back = await game.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!, seconds: 20);
            Assert.NotNull(back);

            await game.SendAsync(1);
            await game.ReceiveTypeAsync(231);
            Assert.False(await app.WithDbAsync(db => db.RunningGames.AnyAsync(g => g.GameId == gameId)));
        }
    }
}
