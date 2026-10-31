using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Souls.Model;
using Souls.Server.Game;

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

    /// <summary>A and B queue for a ranked game and keep their starting hands: the first player's turn has started.</summary>
    private static async Task<(GameSocket First, GameSocket Second, int GameId)> StartRankedAsync(GameSocket a, GameSocket b)
    {
        await a.SendAsync(100);
        await b.SendAsync(100);
        var create = (await a.ReceiveTypeAsync(206))["Payload"]!;
        await b.ReceiveTypeAsync(206);
        await a.SendAsync(227);
        await b.SendAsync(227);
        var (first, second) = (int)create["ident"]! == 1 ? (a, b) : (b, a);
        await first.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!);
        await second.ReceiveTypeAsync(226);
        return (first, second, (int)create["gameId"]!);
    }

    /// <summary>The current player ends the turn; returns when the other one's turn has started.</summary>
    private static async Task PassAsync(GameSocket current, GameSocket next)
    {
        await current.SendAsync(226);
        await next.ReceiveAsync(m => Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]!);
    }

    /// <summary>Makes every save of a running game take a second (a slow database), or fast again.</summary>
    private Task SlowDatabaseAsync(bool slow) => app.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(slow
        ? """
          CREATE OR REPLACE FUNCTION slow_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NULL; END $$;
          CREATE TRIGGER slow_save BEFORE INSERT ON running_game FOR EACH STATEMENT EXECUTE FUNCTION slow_save();
          """
        : "DROP TRIGGER IF EXISTS slow_save ON running_game"));

    /// <summary>The saved game: its snapshot (null while not saved) and the sequence numbers of its saved replay.</summary>
    private Task<(JsonNode? State, List<int> Replay)> SavedAsync(int gameId) => app.WithDbAsync(async db => (
        (await db.RunningGames.AsNoTracking().Where(g => g.GameId == gameId).Select(g => g.State).SingleOrDefaultAsync()) is { } state ? JsonNode.Parse(state) : null,
        await db.RunningGameReplays.Where(r => r.GameId == gameId).OrderBy(r => r.Seq).Select(r => r.Seq).ToListAsync()));

    /// <summary>The turn and the length of the replay of a running game on the server.</summary>
    private Task<(int Turn, int Replay)> RunningAsync(int gameId)
    {
        var state = app.Server.Services.GetRequiredService<ServerState>();
        return state.RunExclusiveAsync(() => (state.Rooms[gameId].Turn, state.Rooms[gameId].Replay.Count));
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

    /// <summary>The players' chat room in the game is saved with it: after a restart they are back in it and can talk.</summary>
    [Fact]
    public async Task TheGameChatRoomComesBackAfterARestart()
    {
        var (browserA, nameA) = await LoggedInPlayerAsync();
        var (browserB, _) = await LoggedInPlayerAsync(2);
        using (browserA)
        using (browserB)
        {
            var a = await JoinAsync(browserA);
            var b = await JoinAsync(browserB);
            await a.SendAsync(100);
            await b.SendAsync(100);
            var gameId = (int)(await a.ReceiveTypeAsync(206))["Payload"]!["gameId"]!;
            await b.ReceiveTypeAsync(206);

            // Both log in to the chat, then A makes the game's room.
            var chatA = await ChatAsync(browserA);
            var chatB = await ChatAsync(browserB);
            await chatA.SendAsync(1009);
            var room = (int)(await chatA.ReceiveTypeAsync(1004))["Payload"]!["chRoomId"]!;
            Assert.Equal(room, (int)(await chatB.ReceiveTypeAsync(1004))["Payload"]!["chRoomId"]!);

            await RestartAsync(a, b, chatA, chatB);

            // The clients reconnect, game first. Each is told the room it is back in, and a line reaches the other.
            a = await JoinAsync(browserA);
            b = await JoinAsync(browserB);
            await using var _ = a;
            await using var __ = b;
            chatA = await ChatAsync(browserA);
            chatB = await ChatAsync(browserB);
            await using var ___ = chatA;
            await using var ____ = chatB;
            Assert.All(new[] { chatA, chatB }, chat => Assert.Contains(chat.Received, m => Type(m) == 1094 && (int)m["Payload"]!["room"]! == room));
            await chatA.SendAsync(1002, new JsonObject { ["room"] = room, ["message"] = "still here" });
            var line = (await chatB.ReceiveTypeAsync(1003))["Payload"]!;
            Assert.Equal((nameA, "still here", room), ((string)line["name"]!, (string)line["message"]!, (int)line["room"]!));

            await a.SendAsync(1);
            await b.ReceiveTypeAsync(230);
            Assert.False(await app.WithDbAsync(db => db.RunningGames.AnyAsync(g => g.GameId == gameId)));
        }

        // Logs in to the chat; the answer to a question about a room confirms it (messages before it are in Received).
        async Task<GameSocket> ChatAsync(TestBrowser browser)
        {
            var chat = await GameSocket.ConnectAsync(app.Server, "ws/chat", browser.AuthCookie);
            await chat.SendAsync(0);
            await chat.SendAsync(1010, new JsonObject { ["room"] = -1 });
            await chat.ReceiveTypeAsync(1096);
            return chat;
        }
    }

    /// <summary>
    /// Saves are written in the background: with a database that takes a second for each, the game goes on at full
    /// speed, and its last state is still written when the server stops (the latest snapshot and the whole replay).
    /// </summary>
    [Fact]
    public async Task ASlowDatabaseHoldsUpNoGameAndTheLastStateIsStillSaved()
    {
        var (browserA, _) = await LoggedInPlayerAsync();
        var (browserB, _) = await LoggedInPlayerAsync(2);
        using (browserA)
        using (browserB)
        {
            var a = await JoinAsync(browserA);
            var b = await JoinAsync(browserB);
            var (first, second, gameId) = await StartRankedAsync(a, b);
            int turn, replay;
            await SlowDatabaseAsync(true);
            try
            {
                // Saved before each answer, six turns would take six seconds at least.
                var watch = Stopwatch.StartNew();
                for (var i = 0; i < 6; i++)
                {
                    await (i % 2 == 0 ? PassAsync(first, second) : PassAsync(second, first));
                }

                Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3), $"Six turns took {watch.Elapsed}");
                (turn, replay) = await RunningAsync(gameId);
                await RestartAsync(a, b);
            }
            finally
            {
                await SlowDatabaseAsync(false);
            }

            var (state, seqs) = await SavedAsync(gameId);
            Assert.Equal(6, turn);
            Assert.Equal(turn, (int)state!["Turn"]!);
            Assert.Equal(Enumerable.Range(0, replay), seqs);

            a = await JoinAsync(browserA);
            b = await JoinAsync(browserB);
            await using var _ = a;
            await using var __ = b;
            await a.SendAsync(100);
            await a.ReceiveTypeAsync(206);
            Assert.Equal(turn, (int)(await a.ReceiveTypeAsync(236))["Payload"]!["turn"]!);
            await a.SendAsync(1);
            await b.ReceiveTypeAsync(230);
            Assert.Null((await SavedAsync(gameId)).State);
        }
    }

    /// <summary>
    /// A game that ends while a save of it is being written (and the next one waits) is deleted after that write: a
    /// finished game never comes back.
    /// </summary>
    [Fact]
    public async Task AGameThatEndsWhileItIsBeingSavedStaysDeleted()
    {
        var (browserA, _) = await LoggedInPlayerAsync();
        var (browserB, _) = await LoggedInPlayerAsync(2);
        using (browserA)
        using (browserB)
        {
            await using var a = await JoinAsync(browserA);
            await using var b = await JoinAsync(browserB);
            var (first, second, gameId) = await StartRankedAsync(a, b);

            // Everything so far is written: the writer is idle.
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while ((await SavedAsync(gameId)).State?["InMulligan"]?.GetValue<bool>() != false && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }

            await SlowDatabaseAsync(true);
            try
            {
                await PassAsync(first, second); // its save takes a second
                await PassAsync(second, first); // this one waits for it
                await first.SendAsync(1);
                var result = await second.ReceiveTypeAsync(230, 231, 233);
                Assert.Equal(230, Type(result));
                await Task.Delay(TimeSpan.FromSeconds(3));
                var (state, seqs) = await SavedAsync(gameId);
                Assert.Null(state);
                Assert.Empty(seqs);
                Assert.True(await app.WithDbAsync(db => db.Games.AnyAsync(g => g.Id == (int)result["Payload"]!["statistics"]!)));
            }
            finally
            {
                await SlowDatabaseAsync(false);
            }
        }
    }
}
