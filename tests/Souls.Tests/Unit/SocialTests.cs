using System.Diagnostics.Metrics;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Tests.Unit;

/// <summary>Emotes in games and friendly challenges, against the engine with a manual clock.</summary>
public class SocialTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private readonly ManualTime _clock = new();
    private readonly ServerState _state = new();
    private readonly GameEngine _engine;
    private readonly GameService _service;

    public SocialTests()
    {
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), _state);
        _engine = new GameEngine(_state, new ChatEngine(_state, NullLogger<ChatEngine>.Instance), scopes, _clock, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);
        _service = new GameService(_state, _engine, new PlayerRepository(scopes), _clock, NullLogger<GameService>.Instance);
    }

    /// <summary>A logged in player whose messages are captured.</summary>
    private Player Online(string name)
    {
        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => new Card { Id = 1, Name = "Filler", BaseAttack = 1, BaseHealth = 1, Cost = 1 })];
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var player = new Player { Id = _state.GameClients.Count + 1, Name = name, PlayerType = new PlayerTypeInfo(1, 1, 20, 1), OwningCards = deck, Deck = deck, GameContext = connection };
        _state.GameClients[connection] = player;
        return player;
    }

    /// <summary>The messages a player received since the last call.</summary>
    private static List<JsonNode> Messages(Player p)
    {
        var list = new List<JsonNode>();
        while (((BotConnection)p.GameContext!).Inbox.TryRead(out var json))
        {
            list.Add(JsonNode.Parse(json)!);
        }

        return list;
    }

    private static List<JsonNode> Of(List<JsonNode> messages, GameResponse type) => [.. messages.Where(m => (int)m["Type"]! == (int)type)];

    private static string Closed(Player p) => (string)Of(Messages(p), GameResponse.ChallengeClosed).Single()["Payload"]!;

    private GameRoom Game(Player a, Player b)
    {
        var room = _engine.CreateGame(new Pair<Player>(a, b));
        Messages(a);
        Messages(b);
        return room;
    }

    private void Emote(Player p, int emote) => _engine.RequestEmote(p, emote);

    private void Challenge(Player from, Player to) => _engine.RequestChallenge(from, to.Name);

    [Fact]
    public void EmotesReachBothPlayersSpectatorsAndTheReplayUntilMuted()
    {
        var (a, b, watcher) = (Online("a"), Online("b"), Online("watcher"));
        var room = Game(a, b);
        _engine.Spectate(watcher, room.GameId);
        Messages(watcher);

        Emote(b, 1);
        foreach (var p in new[] { a, b, watcher })
        {
            var emote = Of(Messages(p), GameResponse.Emote).Single()["Payload"]!;
            Assert.Equal(2, (int)emote["ident"]!);
            Assert.Equal("Well played!", (string)emote["text"]!);
        }

        Assert.Equal((int)GameResponse.Emote, (int)room.Replay[^1]["m"]!["Type"]!);

        // A mutes B: B still sees its own emote, the spectator too, A does not. A's emotes still reach B.
        GameEngine.MuteEmotes(a, true);
        Emote(b, 3);
        Assert.Empty(Of(Messages(a), GameResponse.Emote));
        Assert.Single(Of(Messages(b), GameResponse.Emote));
        Assert.Single(Of(Messages(watcher), GameResponse.Emote));
        Emote(a, 0);
        Assert.Single(Of(Messages(b), GameResponse.Emote));
        Assert.Single(Of(Messages(a), GameResponse.Emote));

        GameEngine.MuteEmotes(a, false);
        _clock.Now += TimeSpan.FromSeconds(10);
        Emote(b, 5);
        Assert.Single(Of(Messages(a), GameResponse.Emote));
    }

    [Fact]
    public void EmotesAreRateLimited()
    {
        var (a, b) = (Online("a"), Online("b"));
        Game(a, b);

        // A burst of three, then one every 3 seconds.
        for (var i = 0; i < 4; i++)
        {
            Emote(a, i);
        }

        var received = Messages(a);
        Assert.Equal(3, Of(received, GameResponse.Emote).Count);
        Assert.Equal("You are sending emotes too fast.", (string)Of(received, GameResponse.GameGeneralMessage).Single()["Payload"]!);

        _clock.Now += TimeSpan.FromSeconds(3);
        Emote(a, 0);
        Emote(a, 0);
        received = Messages(a);
        Assert.Single(Of(received, GameResponse.Emote));
        Assert.Single(Of(received, GameResponse.GameGeneralMessage));
        Assert.Equal(4, Of(Messages(b), GameResponse.Emote).Count);
    }

    [Fact]
    public void OnlyPlayersOfARunningGameCanSendKnownEmotes()
    {
        var (a, b, watcher, idle) = (Online("a"), Online("b"), Online("watcher"), Online("idle"));
        var room = Game(a, b);
        _engine.Spectate(watcher, room.GameId);
        Messages(watcher);

        Assert.Throws<ProtocolException>(() => Emote(a, -1));
        Assert.Throws<ProtocolException>(() => Emote(a, GameRules.Emotes.Count));
        Emote(watcher, 0);
        Emote(idle, 0);
        Assert.Empty(Messages(a));
        Assert.Empty(Messages(b));
        Assert.Empty(Messages(watcher));
        Assert.Empty(Messages(idle));
    }

    [Fact]
    public void AcceptedChallengeStartsAnUnrankedGame()
    {
        var (a, b) = (Online("Alice"), Online("Bob"));
        _engine.RequestChallenge(a, " bob ");

        var sent = Of(Messages(a), GameResponse.ChallengeSent).Single()["Payload"]!;
        Assert.Equal("Bob", (string)sent["name"]!);
        Assert.Equal(30000, (long)sent["expiresIn"]!);
        var invite = Of(Messages(b), GameResponse.ChallengeInvite).Single()["Payload"]!;
        Assert.Equal("Alice", (string)invite["name"]!);

        _engine.AnswerChallenge(b, accept: true);
        Assert.Empty(_state.Challenges);
        var room = Assert.Single(_state.Rooms.Values);
        Assert.True(room.IsPractice); // unranked: stored and rewarded like a practice game
        Assert.Contains(a, new[] { room.Players.First, room.Players.Second });
        Assert.Contains(b, new[] { room.Players.First, room.Players.Second });
        Assert.Single(Of(Messages(a), GameResponse.GameCreate));
        Assert.Single(Of(Messages(b), GameResponse.GameCreate));
    }

    [Fact]
    public void ChallengesCanBeDeclinedWithdrawnOrLeftToExpire()
    {
        var (a, b) = (Online("a"), Online("b"));

        Challenge(a, b);
        _engine.AnswerChallenge(b, accept: false);
        Assert.Equal("b declined your challenge.", Closed(a));
        Assert.Empty(_state.Challenges);

        Challenge(a, b);
        Messages(b);
        _engine.CancelChallenge(b); // only the challenger can withdraw
        Assert.Single(_state.Challenges);
        _engine.CancelChallenge(a);
        Assert.Equal("a withdrew the challenge.", Closed(b));

        Challenge(a, b);
        Messages(a);
        Messages(b);
        _clock.Now += TimeSpan.FromSeconds(29);
        _engine.ExpireChallenges();
        Assert.Single(_state.Challenges);
        _clock.Now += TimeSpan.FromSeconds(1);
        _engine.ExpireChallenges();
        Assert.Empty(_state.Challenges);
        Assert.Equal("b did not answer.", Closed(a));
        Assert.Equal("The challenge from a expired.", Closed(b));

        // Answering a challenge that is gone.
        _engine.AnswerChallenge(b, accept: true);
        Assert.Equal("That challenge is no longer open.", Closed(b));
        Assert.Empty(_state.Rooms);
    }

    [Fact]
    public void ChallengesNeedAFreeOnlinePlayer()
    {
        var (a, b, c, d, e) = (Online("a"), Online("b"), Online("c"), Online("d"), Online("e"));

        _engine.RequestChallenge(a, "nobody");
        Assert.Equal("nobody is not online.", Closed(a));
        Challenge(a, a);
        Assert.Equal("You cannot challenge yourself.", Closed(a));

        Game(c, d);
        Challenge(a, c);
        Assert.Equal("c is busy in another game.", Closed(a));
        Challenge(c, a);
        Assert.Equal("Finish your game or your pending challenge first.", Closed(c));

        // One pending challenge per player, on either side.
        _clock.Now += TimeSpan.FromMinutes(1);
        Challenge(a, b);
        Messages(a);
        Messages(b);
        Challenge(e, b);
        Assert.Equal("b already has a pending challenge.", Closed(e));
        Challenge(a, e);
        Assert.Equal("Finish your game or your pending challenge first.", Closed(a));
        Challenge(b, e);
        Assert.Equal("Finish your game or your pending challenge first.", Closed(b));
    }

    [Fact]
    public void ChallengesAreRateLimitedPerAccount()
    {
        var a = Online("a");
        for (var i = 0; i < 3; i++)
        {
            _engine.RequestChallenge(a, "nobody");
            Assert.Equal("nobody is not online.", Closed(a));
        }

        _engine.RequestChallenge(a, "nobody");
        Assert.Equal("You are sending challenges too fast. Wait a few seconds.", Closed(a));

        _clock.Now += TimeSpan.FromSeconds(10);
        _engine.RequestChallenge(a, "nobody");
        Assert.Equal("nobody is not online.", Closed(a));
    }

    [Fact]
    public async Task ChallengesEndWhenAPlayerLeavesOrStartsAnotherGame()
    {
        var (a, b, c, d) = (Online("a"), Online("b"), Online("c"), Online("d"));

        // The challenged player may wait in the ranked queue; accepting leaves it.
        _engine.RequestQueue(b, normal: true);
        Challenge(a, b);
        Assert.Single(Of(Messages(b), GameResponse.ChallengeInvite));
        _engine.AnswerChallenge(b, accept: true);
        Assert.Empty(_state.NormalQueue);
        Assert.False(b.InQueue);
        Assert.NotNull(b.GPlayer);

        // Matched in the queue while invited.
        _engine.RequestQueue(d, normal: true);
        Challenge(c, d);
        Messages(c);
        _engine.RemoveFromQueues(d);
        Game(d, Online("e"));
        Assert.Equal("d started another game.", Closed(c));

        // The challenger disconnects.
        var f = Online("f");
        _clock.Now += TimeSpan.FromMinutes(1);
        Challenge(c, f);
        Messages(f);
        await _service.OnDisconnectedAsync(c.GameContext!);
        Assert.Equal("c left.", Closed(f));
        Assert.Empty(_state.Challenges);
    }

    [Fact]
    public void ThrottleAllowsABurstThenOneActionPerInterval()
    {
        var now = DateTimeOffset.UnixEpoch;
        var second = TimeSpan.FromSeconds(1);
        var clock = DateTimeOffset.MinValue;
        for (var i = 0; i < 2; i++)
        {
            clock = GameEngine.Throttle(clock, now, second, 2) ?? throw new Xunit.Sdk.XunitException($"refused {i}");
        }

        Assert.Null(GameEngine.Throttle(clock, now, second, 2));
        Assert.NotNull(GameEngine.Throttle(clock, now + second, second, 2));
        Assert.NotNull(GameEngine.Throttle(clock, now + 5 * second, second, 2));
    }
}
