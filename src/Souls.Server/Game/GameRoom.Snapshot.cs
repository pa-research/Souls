using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Souls.Model.Entities;
using Souls.Server.Objects;
using Card = Souls.Server.Objects.Card;
using Player = Souls.Server.Objects.Player;

namespace Souls.Server.Game;

/// <summary>Saving a running game and restoring it after a restart of the server (see <see cref="GameStore"/>).</summary>
public sealed partial class GameRoom
{
    /// <summary>A restored turn (or mulligan) keeps the time it had left, but at least this much: the players reconnect first.</summary>
    public static readonly TimeSpan MinimumTimeAfterRestore = TimeSpan.FromSeconds(15);

    /// <summary>
    /// State only: properties without a setter are computed (<see cref="GamePlayer.Ident"/>, <see cref="Card.CanAct"/>)
    /// and left out, except the collections, which are filled in place.
    /// </summary>
    private static readonly JsonSerializerOptions SnapshotJson = new()
    {
        TypeInfoResolver = new DefaultJsonTypeInfoResolver
        {
            Modifiers =
            {
                info =>
                {
                    foreach (var property in info.Properties.Where(p => p.Set is null && p.ObjectCreationHandling != JsonObjectCreationHandling.Populate))
                    {
                        property.ShouldSerialize = (_, _) => false;
                    }
                },
            },
        },
    };

    /// <summary>The game changed since it was last saved. Set by <see cref="Record"/>, cleared by <see cref="GameStore"/>.</summary>
    public bool Dirty { get; set; } = true;

    /// <summary>How many messages of the <see cref="Replay"/> are saved.</summary>
    public int SavedReplay { get; set; }

    /// <summary>The game without its replay, which is saved message by message.</summary>
    internal sealed record SavedGame(
        int GameId, bool IsPractice, DateTimeOffset StartedAt, TimeSpan TurnTime, TimeSpan MulliganTime, bool InMulligan, int Turn, int Round,
        int Current, long TurnEndsIn, SavedPlayer First, SavedPlayer Second, List<GameLog> Log, List<JsonObject> Events);

    /// <summary>A player as the game needs it. The collection, deck and connections come back when the player reconnects.</summary>
    internal sealed record SavedPlayer(int Id, string Name, int Rank, int Rating, PlayerTypeInfo PlayerType, int? HeroPower, bool IsBot, int Difficulty, GamePlayer Game);

    /// <summary>The game as JSON. Taken between two actions, so there are no pending events.</summary>
    public string Snapshot() => JsonSerializer.Serialize(new SavedGame(
        GameId, IsPractice, StartedAt, TurnTime, MulliganTime, InMulligan, Turn, Round, CurrentPlaying.GPlayer!.Ident, TurnEndsIn,
        Save(Players.First), Save(Players.Second), [.. Logger.Records], _events), SnapshotJson);

    private static SavedPlayer Save(Player p) => new(p.Id, p.Name, p.Rank, p.Rating, p.PlayerType, p.HeroPower, p.IsBot, p.Difficulty, p.GPlayer!);

    /// <summary>A game saved by <see cref="Snapshot"/>, with the replay messages saved so far. Nobody is connected yet.</summary>
    public static GameRoom Restore(string snapshot, IEnumerable<string> replay, TimeProvider time) =>
        new(JsonSerializer.Deserialize<SavedGame>(snapshot, SnapshotJson) ?? throw new JsonException("Empty game snapshot"), replay, time);

    private GameRoom(SavedGame saved, IEnumerable<string> replay, TimeProvider time)
    {
        _time = time;
        GameId = saved.GameId;
        IsPractice = saved.IsPractice;
        StartedAt = saved.StartedAt;
        TurnTime = saved.TurnTime;
        MulliganTime = saved.MulliganTime;
        InMulligan = saved.InMulligan;
        Turn = saved.Turn;
        Round = saved.Round;
        Players = new Pair<Player>(Load(saved.First), Load(saved.Second));
        CurrentPlaying = PlayerOf(saved.Current);
        TurnDeadline = time.GetUtcNow() + TimeSpan.FromMilliseconds(Math.Max(saved.TurnEndsIn, (long)MinimumTimeAfterRestore.TotalMilliseconds));
        Logger = new GameLogger(saved.Log);
        _events.AddRange(saved.Events);
        _replay.AddRange(replay.Select(r => JsonNode.Parse(r)!.AsObject()));
        SavedReplay = _replay.Count;
        Dirty = false;

        // New games and cards must not reuse the restored ids.
        ReserveIds(GameId);
        Card.ReserveCids(new[] { Players.First.GPlayer!, Players.Second.GPlayer! }
            .SelectMany(gp => gp.HandCards.Values.Concat(gp.BoardCards.Values).Concat(gp.Deck).Concat(gp.Used))
            .Select(c => c.Cid).DefaultIfEmpty().Max());

        Player Load(SavedPlayer p)
        {
            p.Game.GameRoom = this;
            return new Player
            {
                Id = p.Id,
                Name = p.Name,
                Rank = p.Rank,
                Rating = p.Rating,
                PlayerType = p.PlayerType,
                HeroPower = p.HeroPower,
                OwningCards = [],
                Deck = [],
                IsBot = p.IsBot,
                Difficulty = p.Difficulty,
                GPlayer = p.Game,
            };
        }
    }

    /// <summary>New games get ids above <paramref name="id"/>.</summary>
    public static void ReserveIds(int id)
    {
        int seen;
        while ((seen = Volatile.Read(ref _gameCounter)) < id && Interlocked.CompareExchange(ref _gameCounter, id, seen) != seen)
        {
        }
    }
}
