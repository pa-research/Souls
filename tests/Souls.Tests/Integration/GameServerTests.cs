using System.Net.WebSockets;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model.Entities;

namespace Souls.Tests.Integration;

[Collection(SoulsCollection.Name)]
public class GameServerTests(SoulsAppFixture app)
{
    private const string Password = "CorrectHorse9!";

    private async Task<(TestBrowser Browser, string Name)> LoggedInPlayerAsync(int playerType = 1)
    {
        var name = "g" + Guid.NewGuid().ToString("N")[..10];
        var browser = app.CreateBrowser();
        await browser.RegisterAsync(name, Password, playerType);
        using var _ = await browser.LoginAsync(name, Password);
        Assert.NotNull(browser.AuthCookie);
        return (browser, name);
    }

    private static int Type(JsonNode message) => (int)message["Type"]!;

    [Fact]
    public async Task SocketsRequireALogin()
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => GameSocket.ConnectAsync(app.Server, "ws/game", cookie: null));
        Assert.Contains("401", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SocketsRejectForeignOrigins()
    {
        var (browser, _) = await LoggedInPlayerAsync();
        using (browser)
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie, origin: "https://evil.example"));
            Assert.Contains("403", error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task AdminSocketRequiresTheAdminRole()
    {
        var (browser, _) = await LoggedInPlayerAsync();
        using (browser)
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => GameSocket.ConnectAsync(app.Server, "ws/admin", browser.AuthCookie));
            Assert.Contains("403", error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task OldClientsSendingTheBotHashCannotImpersonateIt()
    {
        var (browser, name) = await LoggedInPlayerAsync();
        using (browser)
        {
            await using var game = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await game.SendAsync(0, new JsonObject { ["hash"] = "BOT" });
            var login = await game.ReceiveTypeAsync(10);
            Assert.Equal($"Logged in as {name}", (string)login["Payload"]!);
        }
    }

    [Fact]
    public async Task MalformedMessagesAreAnsweredWithAnError()
    {
        var (browser, _) = await LoggedInPlayerAsync();
        using (browser)
        {
            await using var game = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await game.SendAsync(0);
            await game.ReceiveTypeAsync(10);

            await game.SendRawAsync("{not json");
            Assert.Equal("Malformed JSON", (string)(await game.ReceiveTypeAsync(98))["Payload"]!);

            await game.SendRawAsync("""{"Payload":{}}""");
            Assert.Equal("Missing message type", (string)(await game.ReceiveTypeAsync(98))["Payload"]!);

            // Still usable afterwards.
            await game.SendAsync(2, new JsonObject { ["heartbeat"] = 1, ["last"] = 2 });
            Assert.Equal(2, (int)(await game.ReceiveTypeAsync(5))["Payload"]!["last"]!);

            // Oversized messages close the connection.
            await game.SendRawAsync(new string('x', 64 * 1024));
            Assert.True(await game.WaitForCloseAsync());
        }
    }

    /// <summary>Plays a whole practice game against the bot through the WebSocket protocol.</summary>
    [Fact]
    public async Task PracticeGameAgainstTheBotIsPlayedAndStored()
    {
        var (browser, name) = await LoggedInPlayerAsync();
        using (browser)
        {
            await using var game = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await using var chat = await GameSocket.ConnectAsync(app.Server, "ws/chat", browser.AuthCookie);

            await game.SendAsync(0);
            Assert.Equal($"Logged in as {name}", (string)(await game.ReceiveTypeAsync(10))["Payload"]!);
            await chat.SendAsync(0);

            await game.SendAsync(101);
            await game.ReceiveTypeAsync(100);
            var create = (await game.ReceiveTypeAsync(206))["Payload"]!;
            Assert.False((bool)create["yourTurn"]!); // the mulligan comes first
            Assert.False((bool)create["mulligan"]!["done"]!);
            Assert.Equal(1, (int)create["ident"]!);
            Assert.StartsWith("[BOT] ", (string)create["opponent"]!["info"]!["name"]!, StringComparison.Ordinal);
            Assert.Equal(3, create["player"]!["hand"]!.AsObject().Count);
            Assert.Equal(3, create["opponent"]!["hand"]!.AsArray().Count);

            // Mulligan: replace the first card. The game starts once the bot has chosen too, and the bot (going second)
            // gets its extra card.
            var first = (int)create["player"]!["hand"]!.AsObject().First().Value!["cid"]!;
            await game.SendAsync(227, new JsonObject { ["replace"] = new JsonArray(first) });
            var mulligan = (await game.ReceiveTypeAsync(227))["Payload"]!;
            Assert.Equal(1, (int)mulligan["replaced"]!);
            Assert.Equal(3, mulligan["hand"]!.AsArray().Count);
            var start = (await game.ReceiveAsync(m => Type(m) == 226, seconds: 20))["Payload"]!;
            Assert.True((bool)start["yourTurn"]!);
            await game.ReceiveTypeAsync(223);

            // In-game chat with the bot.
            await chat.SendAsync(1009);
            var room = (int)(await chat.ReceiveTypeAsync(1004))["Payload"]!["chRoomId"]!;
            await chat.SendAsync(1002, new JsonObject { ["room"] = room, ["message"] = "<b>good luck</b>" });
            var said = (await chat.ReceiveTypeAsync(1003))["Payload"]!;
            Assert.Equal(name, (string)said["name"]!);
            Assert.Equal("<b>good luck</b>", (string)said["message"]!);

            // Our turn: play the cheapest card, attack the bot's hero with ours and pass, until the game ends (empty decks
            // deal growing fatigue damage, so it always ends).
            var mana = int.Parse((string)start["playerInfo"]!["mana"]!, System.Globalization.CultureInfo.InvariantCulture);
            var hand = mulligan["hand"]!.AsArray().Select(c => c!).ToList();
            var played = new HashSet<int>();
            JsonNode? result = null;
            for (var turn = 0; turn < 60 && result is null; turn++)
            {
                var card = hand.Where(c => (int)c["cost"]! <= mana).OrderBy(c => (int)c["cost"]!).FirstOrDefault();
                if (card is not null)
                {
                    await game.SendAsync(201, new JsonObject { ["cid"] = (int)card["cid"]!, ["slotId"] = turn % 7 });
                    var used = await game.ReceiveTypeAsync(207, 208, 213);
                    if (Type(used) == 207)
                    {
                        hand.Remove(card);
                        played.Add((int)card["cid"]!);
                    }
                }

                // Hero attacks hero: answered with events and the new state (or a message, e.g. a Taunt in the way).
                await game.SendAsync(200, new JsonObject { ["source"] = -1, ["target"] = -1, ["type"] = 3 });
                var attack = await game.ReceiveTypeAsync(236, 232, 230, 231, 233);
                if (Type(attack) is 230 or 231 or 233)
                {
                    result = attack;
                    break;
                }

                await game.SendAsync(226);
                var next = await game.ReceiveAsync(m => Type(m) is 230 or 231 or 233 || (Type(m) == 226 && (bool)m["Payload"]!["yourTurn"]! == true), seconds: 20);
                if (Type(next) != 226)
                {
                    result = next;
                    break;
                }

                mana = int.Parse((string)next["Payload"]!["playerInfo"]!["mana"]!, System.Globalization.CultureInfo.InvariantCulture);
                hand.AddRange(game.Received.Where(m => Type(m) == 222).SelectMany(m => m["Payload"]!["card"]!.AsArray()).Select(c => c!)
                    .Where(c => !played.Contains((int)c["cid"]!) && hand.All(h => (int)h["cid"]! != (int)c["cid"]!)));
            }

            Assert.NotNull(result);
            var gameId = (int)result["Payload"]!["statistics"]!;
            Assert.True(gameId > 0);
            Assert.Equal(3, result["Payload"]!["quests"]!.AsArray().Count);
            Assert.True((int)result["Payload"]!["coins"]! >= 0);
            Assert.Null(result["Payload"]!["ratingChange"]); // practice games are not rated
            Assert.Null(result["Payload"]!["season"]);
            Assert.Null(result["Payload"]!["friendly"]);
            Assert.Equal((int)result["Payload"]!["coins"]!, await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Money).SingleAsync()));

            // Attacks are reported as events, followed by the full state.
            Assert.Contains(game.Received, m => Type(m) == 235 && m["Payload"]!["events"]!.AsArray().Any(e => (string?)e!["t"] == "attack"));
            Assert.Contains(game.Received, m => Type(m) == 236 && m["Payload"]!["heroes"]!["1"]!["name"] is not null);

            var (stored, log, replay) = await app.WithDbAsync(async db => (
                await db.Games.Include(g => g.Player1).Include(g => g.Player2).SingleAsync(g => g.Id == gameId),
                await db.GameLogs.Where(l => l.GameId == gameId).ToListAsync(),
                await db.GameReplays.SingleOrDefaultAsync(r => r.GameId == gameId)));
            Assert.Equal(name, stored.Player1!.Name);
            Assert.True(stored.Player2!.IsSystem);
            Assert.True(stored.IsPractice);
            Assert.Contains(log, l => l.GameLogTypeId == (int)GameLogKind.GameCreated && l.Text!.Contains(name, StringComparison.Ordinal));
            Assert.Contains(log, l => l.GameLogTypeId is (int)GameLogKind.Won or (int)GameLogKind.Draw);

            // The replay holds the spectator view: it starts with the game, never reveals hands, and ends.
            Assert.NotNull(replay);
            var records = JsonNode.Parse(replay.Data)!.AsArray();
            Assert.Equal(241, (int)records[0]!["m"]!["Type"]!);
            Assert.Equal(242, (int)records[^1]!["m"]!["Type"]!);
            Assert.DoesNotContain(records, r => (int)r!["m"]!["Type"]! == 222 && r["m"]!["Payload"]!["card"]!.AsArray().Any(c => c!["name"] is not null));
            var replayedMulligan = Assert.Single(records, r => (int)r!["m"]!["Type"]! == 227)!["m"]!["Payload"]!;
            Assert.All(replayedMulligan["hand"]!.AsArray(), c => Assert.Single(c!.AsObject()));
            using var replayData = await browser.GetAsync($"/Game/ReplayData/{gameId}");
            Assert.Equal(System.Net.HttpStatusCode.OK, replayData.StatusCode);

            using var stats = await browser.GetAsync($"/Game/Stats/{gameId}");
            Assert.Contains($"Game Summary for #{gameId}", await stats.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// A challenges B by name; B declines, then accepts; they emote until B mutes A; A leaves and B wins. A friendly
    /// game earns nothing (two accounts could farm it): no coins, quests, rating or season points, but it is stored.
    /// </summary>
    [Fact]
    public async Task FriendlyChallengeStartsAnUnrankedGameWithEmotes()
    {
        var (browserA, nameA) = await LoggedInPlayerAsync();
        var (browserB, nameB) = await LoggedInPlayerAsync(2);
        using (browserA)
        using (browserB)
        {
            await using var a = await GameSocket.ConnectAsync(app.Server, "ws/game", browserA.AuthCookie);
            await using var b = await GameSocket.ConnectAsync(app.Server, "ws/game", browserB.AuthCookie);
            await a.SendAsync(0);
            await a.ReceiveTypeAsync(10);
            await b.SendAsync(0);
            await b.ReceiveTypeAsync(10);

            await a.SendAsync(199, new JsonObject { ["name"] = "x" + nameB });
            Assert.Equal($"x{nameB} is not online.", (string)(await a.ReceiveTypeAsync(197))["Payload"]!);

            await a.SendAsync(199, new JsonObject { ["name"] = nameB });
            await a.ReceiveTypeAsync(198);
            Assert.Equal(nameA, (string)(await b.ReceiveTypeAsync(199))["Payload"]!["name"]!);
            await b.SendAsync(198, new JsonObject { ["accept"] = false });
            Assert.Equal($"{nameB} declined your challenge.", (string)(await a.ReceiveTypeAsync(197))["Payload"]!);

            await a.SendAsync(199, new JsonObject { ["name"] = nameB });
            await b.ReceiveTypeAsync(199);
            await b.SendAsync(198, new JsonObject { ["accept"] = true });
            var identA = (int)(await a.ReceiveTypeAsync(206))["Payload"]!["ident"]!;
            await b.ReceiveTypeAsync(206);

            await a.SendAsync(299, new JsonObject { ["emote"] = 1 });
            var emote = (await b.ReceiveTypeAsync(299))["Payload"]!;
            Assert.Equal(identA, (int)emote["ident"]!);
            Assert.Equal("Well played!", (string)emote["text"]!);

            // B mutes A (the heartbeat answer confirms the server has read it): A still sees its own emote, B does not.
            await b.SendAsync(298, new JsonObject { ["muted"] = true });
            await b.SendAsync(2, new JsonObject { ["heartbeat"] = 1, ["last"] = 1 });
            await b.ReceiveTypeAsync(5);
            await a.SendAsync(299, new JsonObject { ["emote"] = 2 });
            await a.ReceiveAsync(m => Type(m) == 299 && (int)m["Payload"]!["emote"]! == 2);
            await b.SendAsync(2, new JsonObject { ["heartbeat"] = 2, ["last"] = 2 });
            await b.ReceiveAsync(m => Type(m) == 5 && (int)m["Payload"]!["last"]! == 2);
            Assert.DoesNotContain(b.Received, m => Type(m) == 299 && (int)m["Payload"]!["emote"]! == 2);

            // A leaves: B wins, and earns nothing.
            await a.SendAsync(1);
            var result = (await b.ReceiveTypeAsync(230, 231, 233))["Payload"]!;
            Assert.Equal(230, Type(b.Received[^1]));
            Assert.True((bool)result["friendly"]!);
            Assert.Equal(0, (int)result["coins"]!);
            Assert.Null(result["ratingChange"]);
            Assert.Null(result["quests"]);
            Assert.Null(result["season"]);
            var gameId = (int)result["statistics"]!;
            var (game, replay, players, quests) = await app.WithDbAsync(async db => (
                await db.Games.SingleAsync(g => g.Id == gameId),
                await db.GameReplays.AnyAsync(r => r.GameId == gameId),
                await db.Players.Where(p => p.Name == nameA || p.Name == nameB).Select(p => new { p.Rating, p.Money }).ToListAsync(),
                await db.PlayerQuests.CountAsync(q => q.Player!.Name == nameA || q.Player!.Name == nameB)));
            Assert.True(game.IsPractice);
            Assert.True(replay);
            Assert.Equal(0, game.Player1RatingChange);
            Assert.Equal(0, game.Player2RatingChange);
            Assert.All(players, p => Assert.Equal((Souls.Model.Ratings.Initial, 0), (p.Rating, p.Money)));
            Assert.Equal(0, quests);
        }
    }

    /// <summary>
    /// A ranked game pays coins, counts for the daily quests and moves both ratings, and the result shows the season:
    /// the winner is promoted from Bronze III to Bronze II, the loser demoted from Bronze II to Bronze III.
    /// </summary>
    [Fact]
    public async Task ARankedGameEarnsCoinsQuestsRatingAndShowsTheSeason()
    {
        var (browserA, nameA) = await LoggedInPlayerAsync();
        var (browserB, nameB) = await LoggedInPlayerAsync(2);
        using (browserA)
        using (browserB)
        {
            await app.WithDbAsync(async db =>
                await db.Players.Where(p => p.Name == nameA).ExecuteUpdateAsync(s => s.SetProperty(p => p.Rating, 1050)) +
                await db.Players.Where(p => p.Name == nameB).ExecuteUpdateAsync(s => s.SetProperty(p => p.Rating, 1040)));
            await using var a = await GameSocket.ConnectAsync(app.Server, "ws/game", browserA.AuthCookie);
            await using var b = await GameSocket.ConnectAsync(app.Server, "ws/game", browserB.AuthCookie);
            await a.SendAsync(0);
            await a.ReceiveTypeAsync(10);
            await b.SendAsync(0);
            await b.ReceiveTypeAsync(10);
            await a.SendAsync(100);
            await b.SendAsync(100);
            await a.ReceiveTypeAsync(206);
            await b.ReceiveTypeAsync(206);

            // A leaves: B wins.
            await a.SendAsync(1);
            var lost = (await a.ReceiveTypeAsync(230, 231, 233))["Payload"]!;
            var won = (await b.ReceiveTypeAsync(230, 231, 233))["Payload"]!;
            Assert.Equal(231, Type(a.Received[^1]));
            Assert.Equal(230, Type(b.Received[^1]));
            Assert.Null(won["friendly"]);
            Assert.Equal((3, 16, 1056, 3), ((int)won["coins"]!, (int)won["ratingChange"]!, (int)won["rating"]!, won["quests"]!.AsArray().Count));
            Assert.Equal((1, -16, 1034, 3), ((int)lost["coins"]!, (int)lost["ratingChange"]!, (int)lost["rating"]!, lost["quests"]!.AsArray().Count));

            var season = (await app.WithDbAsync(db => Souls.Model.Seasons.CurrentAsync(db)))!;
            AssertSeason(won["season"], 1040, 1, "Bronze III", 1056, 2, "Bronze II", promoted: true);
            AssertSeason(lost["season"], 1050, 2, "Bronze II", 1034, 1, "Bronze III", promoted: false);

            var stored = await app.WithDbAsync(db => db.Players.Where(p => p.Name == nameA || p.Name == nameB).OrderBy(p => p.Name == nameB)
                .Select(p => new { p.Money, p.Rating, p.Rank }).ToListAsync());
            Assert.Equal([(1, 1034, 1), (3, 1056, 2)], stored.Select(p => (p.Money, p.Rating, p.Rank)));

            void AssertSeason(JsonNode? actual, int ratingBefore, int rankBefore, string tierBefore, int ratingAfter, int rankAfter, string tierAfter, bool promoted)
            {
                var expected = new JsonObject
                {
                    ["number"] = season.Number,
                    ["name"] = season.Name,
                    ["before"] = new JsonObject { ["rating"] = ratingBefore, ["rank"] = rankBefore, ["tier"] = tierBefore, ["css"] = "tier-bronze" },
                    ["after"] = new JsonObject { ["rating"] = ratingAfter, ["rank"] = rankAfter, ["tier"] = tierAfter, ["css"] = "tier-bronze" },
                    ["promoted"] = promoted,
                    ["demoted"] = !promoted,
                };
                // The texts' keys (nameKey, tierKey, ...) are checked by LocalizationTests.
                Assert.True(JsonNode.DeepEquals(expected, WithoutKeys(actual?.DeepClone())), actual?.ToJsonString());
            }

            static JsonNode? WithoutKeys(JsonNode? node)
            {
                if (node is JsonObject o)
                {
                    foreach (var name in o.Select(p => p.Key).Where(k => k.EndsWith("Key", StringComparison.Ordinal) || k.EndsWith("Args", StringComparison.Ordinal)).ToList())
                    {
                        o.Remove(name);
                    }

                    foreach (var (_, child) in o)
                    {
                        WithoutKeys(child);
                    }
                }

                return node;
            }
        }
    }

    [Fact]
    public async Task AdminCanSeeAndKickOnlinePlayers()
    {
        var (browser, name) = await LoggedInPlayerAsync();
        using (browser)
        using (var admin = app.CreateBrowser())
        {
            using var _ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
            var playerId = await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Id).SingleAsync());

            await using var game = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await game.SendAsync(0);
            await game.ReceiveTypeAsync(10);

            await using var adminSocket = await GameSocket.ConnectAsync(app.Server, "ws/admin", admin.AuthCookie);
            await adminSocket.SendAsync(1);
            await adminSocket.ReceiveTypeAsync(1);
            await adminSocket.SendAsync(2);
            var online = (await adminSocket.ReceiveTypeAsync(2))["Payload"]!.AsObject();
            Assert.Contains(online, entry => (int)entry.Value! == playerId);

            await adminSocket.SendAsync(6, new JsonObject { ["pId"] = playerId });
            Assert.True(await game.WaitForCloseAsync());
        }
    }

    [Fact]
    public async Task BannedPlayersAreLoggedOutEverywhere()
    {
        var (browser, name) = await LoggedInPlayerAsync();
        using (browser)
        using (var admin = app.CreateBrowser())
        {
            using var _ = await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword);
            var playerId = await app.WithDbAsync(db => db.Players.Where(p => p.Name == name).Select(p => p.Id).SingleAsync());

            await using var game = await GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie);
            await game.SendAsync(0);
            await game.ReceiveTypeAsync(10);

            await using var adminSocket = await GameSocket.ConnectAsync(app.Server, "ws/admin", admin.AuthCookie);
            await adminSocket.SendAsync(1);
            await adminSocket.ReceiveTypeAsync(1);
            await adminSocket.SendAsync(5, new JsonObject { ["pId"] = playerId, ["until"] = DateTimeOffset.UtcNow.AddDays(1).ToString("O") });
            await adminSocket.ReceiveTypeAsync(5);

            Assert.True(await game.WaitForCloseAsync());
            using var shop = await browser.GetAsync("/Shop");
            Assert.Equal(System.Net.HttpStatusCode.Redirect, shop.StatusCode);

            using var login = await browser.LoginAsync(name, Password);
            Assert.Contains("This account is banned.", await login.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            await Assert.ThrowsAsync<InvalidOperationException>(() => GameSocket.ConnectAsync(app.Server, "ws/game", browser.AuthCookie ?? "souls=x"));
        }
    }
}
