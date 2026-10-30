using System.Collections;
using System.Diagnostics.Metrics;
using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using CardKind = Souls.Model.Entities.CardKind;

namespace Souls.Tests.Unit;

/// <summary>Running games saved as JSON (see <see cref="GameStore"/>) come back exactly as they were.</summary>
public class SnapshotTests
{
    /// <summary>
    /// Fields that are deliberately not saved, each with its reason. Every other field of the room, its players, their
    /// game state and cards must survive a snapshot: a new field fails <see cref="EveryFieldSurvivesASnapshot"/> until it
    /// is saved or listed here.
    /// </summary>
    private static readonly HashSet<string> NotSaved =
    [
        "GameRoom._time",               // the server's clock
        "GameRoom.Random",              // Random.Shared: nothing to continue, the deck order is saved
        "GameRoom.TurnDeadline",        // the time left is saved (checked below)
        "GameRoom.Spectators",          // spectators reconnect and watch again
        "GameRoom.IsEnded",             // only running games are saved
        "GameRoom.Winner",
        "GameRoom.IsCopy",              // the bot's lookahead copies are never saved
        "GameRoom.Dirty",               // bookkeeping of the store
        "GameRoom.SavedReplay",
        "GamePlayer.GameRoom",          // the back reference (checked below)
        "Player.OwningCards",           // only needed to start a game; loaded again when the player logs in
        "Player.Deck",
        "Player.InQueue",               // a player in a game is not queued
        "Player.QueuedAt",
        "Player.PracticeDifficulty",
        "Player.ChPlayer",              // connections come back when the player reconnects
        "Player.GameContext",
        "Player.ChatContext",
        "Player.Spectating",
        "Player.DisconnectedAt",
    ];

    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static (GameEngine Engine, ServerState State) NewEngine(TimeProvider time)
    {
        var state = new ServerState();
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), state);
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), services.GetRequiredService<IServiceScopeFactory>(),
            time, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);
        return (engine, state);
    }

    private static Player NewPlayer(int id)
    {
        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(i => new Card { Id = i + 1, Name = $"c{id}-{i}", Cost = 1, BaseAttack = 1, BaseHealth = 2 })];
        return new Player
        {
            Id = id,
            Name = "p" + id,
            PlayerType = new PlayerTypeInfo(id, Attack: 1, Health: 20, Mana: 0, Armor: 2, RaceId: 3),
            OwningCards = deck,
            Deck = deck,
            GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true },
        };
    }

    private static GameRoom Restore(GameRoom room, TimeProvider time) =>
        GameRoom.Restore(room.Snapshot(), room.Replay.Select(r => r.ToJsonString()), time);

    [Fact]
    public void EveryFieldSurvivesASnapshot()
    {
        var time = new ManualTime();
        var (engine, _) = NewEngine(time);
        var room = engine.CreateGame(new Pair<Player>(NewPlayer(1), NewPlayer(2)));
        room.Event("test", new JsonObject { ["x"] = 1 });

        // Every field gets a value of its own, so a field that is not saved cannot pass by keeping its default.
        var counter = 1000;
        Scramble(room, ref counter);
        foreach (var p in new[] { room.Players.First, room.Players.Second })
        {
            Scramble(p, ref counter);
            Scramble(p.PlayerType, ref counter);
            Scramble(p.GPlayer!, ref counter);
            foreach (var card in p.GPlayer!.HandCards.Values.Concat(p.GPlayer.Deck))
            {
                Scramble(card, ref counter);
            }

            var gp = p.GPlayer;
            gp.BoardCards[4] = gp.Deck[^1];
            gp.Deck.RemoveAt(gp.Deck.Count - 1);
            gp.Used.Add(gp.Deck[^1]);
            gp.Deck.RemoveAt(gp.Deck.Count - 1);
        }

        time.Now += TimeSpan.FromSeconds(5);
        var restored = Restore(room, time);

        AssertSame(room, restored, "room");
        Assert.All([restored.Players.First, restored.Players.Second], p => Assert.Same(restored, p.GPlayer!.GameRoom));
        Assert.Same(restored.PlayerOf(room.CurrentPlaying.GPlayer!.Ident), restored.CurrentPlaying);
        Assert.Equal(Math.Max(room.TurnEndsIn, (long)GameRoom.MinimumTimeAfterRestore.TotalMilliseconds), restored.TurnEndsIn);
        Assert.False(restored.Dirty);
        Assert.Equal(room.Replay.Count, restored.SavedReplay);
    }

    /// <summary>A game restored mid-turn plays on: the same draws in the same order, the turn timer, new cards with new cids.</summary>
    [Fact]
    public async Task ARestoredGamePlaysOn()
    {
        var time = new ManualTime();
        var (engine, _) = NewEngine(time);
        var p1 = NewPlayer(1);
        var p2 = NewPlayer(2);
        var room = engine.CreateGame(new Pair<Player>(p1, p2));
        await engine.RequestMulliganAsync(p1, Message.Create(GameRequest.Mulligan, new JsonObject { ["replace"] = new JsonArray((JsonNode)p1.GPlayer!.HandCards.Keys.First()) }));
        await engine.RequestMulliganAsync(p2, Message.Create(GameRequest.Mulligan));
        var card = p1.GPlayer!.HandCards.Values.First();
        await engine.RequestUseCardAsync(p1, Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = 2 }));
        time.Now += TimeSpan.FromSeconds(65);
        var nextDraw = p2.GPlayer!.Deck[^1].Cid;
        var deckOrder = p1.GPlayer.Deck.Select(c => c.Cid).ToList();

        // Ids from before the restart are reserved: new games and cards never reuse them.
        room.GameId = 40_000_000;
        p2.GPlayer.Deck[0].Cid = 50_000_000;

        // The server restarts: a new engine takes over the saved game.
        var (engine2, state2) = NewEngine(time);
        var restored = Restore(room, time);
        engine2.Resume(restored);
        var r1 = restored.Players.First;
        var r2 = restored.Players.Second;
        Assert.Same(restored, state2.Rooms[40_000_000]);
        Assert.NotNull(r1.DisconnectedAt);
        Assert.Contains(state2.GameClients, x => x.Value == r1 && !x.Key.IsOpen);
        Assert.Equal(GameRoom.MinimumTimeAfterRestore.TotalMilliseconds, restored.TurnEndsIn); // 10 s were left: at least 15 s
        Assert.Equal(card.Cid, restored.Players.First.GPlayer!.BoardCards[2].Cid);
        Assert.Equal(deckOrder, r1.GPlayer!.Deck.Select(c => c.Cid));

        await engine2.RequestNextTurnAsync(r1);
        Assert.Same(r2, restored.CurrentPlaying);
        Assert.Contains(nextDraw, r2.GPlayer!.HandCards.Keys);
        Assert.True(Card.LostSoul().Cid > 50_000_000);
        Assert.True(engine2.CreateGame(new Pair<Player>(NewPlayer(3), NewPlayer(4))).GameId > 40_000_000);

        // The turn timer runs on the restored room.
        time.Now += TimeSpan.FromSeconds(76);
        await engine2.CheckTurnTimersAsync();
        Assert.Same(r1, restored.CurrentPlaying);
    }

    /// <summary>Sets every instance field of a simple type (numbers, flags, text, times) to a value of its own.</summary>
    private static void Scramble(object target, ref int counter)
    {
        foreach (var field in target.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
        {
            var name = $"{target.GetType().Name}.{Name(field)}";
            if (NotSaved.Contains(name) || name is "GamePlayer.IsPlayerOne")
            {
                continue;
            }

            var type = Nullable.GetUnderlyingType(field.FieldType) ?? field.FieldType;
            object? value = type switch
            {
                _ when type == typeof(int) => ++counter,
                _ when type == typeof(long) => (long)++counter,
                _ when type == typeof(bool) => !(bool)(field.GetValue(target) ?? false),
                _ when type == typeof(string) => "s" + ++counter,
                _ when type == typeof(DateTimeOffset) => DateTimeOffset.UnixEpoch.AddMinutes(++counter),
                _ when type == typeof(TimeSpan) => TimeSpan.FromSeconds(++counter),
                _ when type == typeof(CardKind) => CardKind.Spell,
                _ => null,
            };
            if (value is not null)
            {
                field.SetValue(target, value);
            }
        }
    }

    /// <summary>Compares two object graphs field by field (collections in order), except the fields in <see cref="NotSaved"/>.</summary>
    private static void AssertSame(object? expected, object? actual, string path)
    {
        if (expected is null || actual is null)
        {
            Assert.True(expected is null && actual is null, $"{path}: {expected ?? "null"} != {actual ?? "null"}");
            return;
        }

        var type = expected.GetType();
        Assert.True(type == actual.GetType(), $"{path}: {type} != {actual.GetType()}");
        if (type.IsPrimitive || type.IsEnum || expected is string or DateTimeOffset or TimeSpan)
        {
            Assert.True(Equals(expected, actual), $"{path}: {expected} != {actual}");
        }
        else if (expected is JsonNode node)
        {
            Assert.True(JsonNode.DeepEquals(node, (JsonNode)actual), $"{path}: {node.ToJsonString()} != {((JsonNode)actual).ToJsonString()}");
        }
        else if (expected is IEnumerable items)
        {
            var a = items.Cast<object?>().ToList();
            var b = ((IEnumerable)actual).Cast<object?>().ToList();
            Assert.True(a.Count == b.Count, $"{path}: {a.Count} items != {b.Count}");
            for (var i = 0; i < a.Count; i++)
            {
                AssertSame(a[i], b[i], $"{path}[{i}]");
            }
        }
        else
        {
            // A field of another type (a clock, a random generator) needs a decision: save it, or list it in NotSaved.
            Assert.True(type.FullName!.StartsWith("Souls.", StringComparison.Ordinal) || (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(KeyValuePair<,>)),
                $"{path}: cannot compare {type}");
            foreach (var field in type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (!NotSaved.Contains($"{type.Name}.{Name(field)}"))
                {
                    AssertSame(field.GetValue(expected), field.GetValue(actual), $"{path}.{Name(field)}");
                }
            }
        }
    }

    /// <summary>The property name for an auto-property's backing field.</summary>
    private static string Name(FieldInfo field) =>
        field.Name.StartsWith('<') ? field.Name[1..field.Name.IndexOf('>', StringComparison.Ordinal)] : field.Name;
}
