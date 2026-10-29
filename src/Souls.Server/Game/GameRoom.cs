using System.Globalization;
using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

public sealed class GameRoom
{
    private static int _gameCounter;

    /// <summary>Messages player one receives that spectators may see too (hidden hands are stripped).</summary>
    private static readonly HashSet<int> MirroredTypes =
    [
        (int)GameResponse.GameCreate,
        (int)GameResponse.GameRecover,
        (int)GameResponse.GameUseCardOk,
        (int)GameResponse.GameOpponentMove,
        (int)GameResponse.GameOpponentRelease,
        (int)GameResponse.GameOpponentUseCardOk,
        (int)GameResponse.GameNewCard,
        (int)GameResponse.GameOpponentNewCard,
        (int)GameResponse.GameNextTurn,
        (int)GameResponse.GameEvents,
        (int)GameResponse.GameSync,
    ];

    private readonly TimeProvider _time;
    private readonly List<JsonObject> _events = [];
    private readonly List<JsonObject> _replay = [];

    public GameRoom(Pair<Player> players, TimeProvider time, TimeSpan turnTime, bool practice = false)
    {
        _time = time;
        GameId = Interlocked.Increment(ref _gameCounter);
        Players = players;
        StartedAt = time.GetUtcNow();
        TurnTime = turnTime;
        IsPractice = practice;
        CurrentPlaying = players.First;

        foreach (var player in new[] { players.First, players.Second })
        {
            var gp = player.GPlayer!;
            gp.GameRoom = this;
            foreach (var card in player.Deck.OrderBy(_ => Random.Shared.Next()))
            {
                gp.Deck.Add(card.NewInstance());
            }

            for (var i = 0; i < GameRules.StartingHand && gp.Deck.Count > 0; i++)
            {
                var card = gp.Deck[^1];
                gp.Deck.RemoveAt(gp.Deck.Count - 1);
                gp.HandCards[card.Cid] = card;
            }
        }

        StartTurn(players.First.GPlayer!);
    }

    /// <summary>In-memory id while running; replaced by the database id when the game is saved.</summary>
    public int GameId { get; set; }
    public Pair<Player> Players { get; }

    /// <summary>Turns played (0 on the first turn).</summary>
    public int Turn { get; private set; }
    public int Round { get; private set; } = 1;
    public bool IsPractice { get; }
    public TimeSpan TurnTime { get; }
    public DateTimeOffset TurnDeadline { get; private set; }

    /// <summary>The player whose turn it is.</summary>
    public Player CurrentPlaying { get; private set; }
    public bool IsEnded { get; set; }
    public Player? Winner { get; set; }
    public GameLogger Logger { get; } = new();
    public DateTimeOffset StartedAt { get; }

    public List<Player> Spectators { get; } = [];

    public IReadOnlyList<JsonObject> Replay => _replay;

    public Player PlayerOf(int ident) => ident == 1 ? Players.First : Players.Second;

    public GamePlayer Other(GamePlayer gp) => gp.IsPlayerOne ? Players.Second.GPlayer! : Players.First.GPlayer!;

    /// <summary>Passes the turn. The round increases each time it is player one's turn again.</summary>
    public void NextTurn()
    {
        var ending = CurrentPlaying.GPlayer!;

        // Paralysis lasts through the owner's turn after it was cast.
        foreach (var card in ending.BoardCards.Values)
        {
            card.Paralyzed = false;
        }

        if (++Turn % 2 == 0)
        {
            Round++;
            CurrentPlaying = Players.First;
        }
        else
        {
            CurrentPlaying = Players.Second;
        }

        StartTurn(CurrentPlaying.GPlayer!);

        // Going second: one extra mana on the first turn.
        if (Turn == 1)
        {
            CurrentPlaying.GPlayer!.Mana++;
        }
    }

    private void StartTurn(GamePlayer gp)
    {
        gp.Mana = Math.Min(Round + gp.BonusMana, GameRules.MaxMana);
        gp.MaxMana = gp.Mana;
        gp.HasAttacked = false;
        gp.HeroPowerUsed = false;
        foreach (var card in gp.BoardCards.Values)
        {
            card.HasAttacked = false;
        }

        TurnDeadline = _time.GetUtcNow() + TurnTime;
    }

    // ---- Events ---------------------------------------------------------------------------------------------------

    public void Event(string type, JsonObject data)
    {
        data["t"] = type;
        _events.Add(data);
    }

    public void LogLine(string text) => Event("log", new JsonObject { ["text"] = text });

    /// <summary>Sends the collected events to both players (and, through player one, to spectators).</summary>
    public void FlushEvents()
    {
        if (_events.Count == 0)
        {
            return;
        }

        var response = new Response(GameResponse.GameEvents, new JsonObject { ["events"] = new JsonArray([.. _events]) });
        _events.Clear();
        Players.First.Send(response);
        Players.Second.Send(response);
    }

    /// <summary>Flushes the events, then sends the full state to both players.</summary>
    public void Sync()
    {
        FlushEvents();
        var response = new Response(GameResponse.GameSync, SyncPayload());
        Players.First.Send(response);
        Players.Second.Send(response);
    }

    public JsonObject SyncPayload()
    {
        var p1 = Players.First.GPlayer!;
        var p2 = Players.Second.GPlayer!;
        return new JsonObject
        {
            ["turn"] = Turn,
            ["round"] = Round,
            ["current"] = CurrentPlaying.GPlayer!.Ident,
            ["turnEndsIn"] = Math.Max(0, (long)(TurnDeadline - _time.GetUtcNow()).TotalMilliseconds),
            ["turnTime"] = (long)TurnTime.TotalMilliseconds,
            ["heroes"] = new JsonObject { ["1"] = HeroState(p1), ["2"] = HeroState(p2) },
            ["board"] = new JsonObject { ["1"] = BoardState(p1), ["2"] = BoardState(p2) },
        };
    }

    private JsonObject HeroState(GamePlayer gp)
    {
        var data = gp.GetPlayerData();
        data["hand"] = gp.HandCards.Count;
        data["deck"] = gp.Deck.Count;
        data["fatigue"] = gp.Fatigue;
        data["heroPowerUsed"] = gp.HeroPowerUsed;
        data["canAttack"] = gp.IsPlayerTurn() && !gp.HasAttacked && gp.Attack > 0;
        data["canUsePower"] = gp.IsPlayerTurn() && !gp.HeroPowerUsed && gp.Mana >= GameRules.HeroPowerCost;
        return data;
    }

    private JsonArray BoardState(GamePlayer gp) => new([.. gp.BoardCards.Values.OrderBy(c => c.SlotId).Select(c =>
    {
        var json = c.ToJson();
        json["canAct"] = gp.IsPlayerTurn() && c.CanAct;
        return (JsonNode)json;
    })]);

    /// <summary>The full game state for each player (player one, player two).</summary>
    public Pair<Response> GenerateGameUpdate(bool create = false)
    {
        var p1Data = GameData.Get(this, playerOne: true);
        var p2Data = GameData.Get(this, playerOne: false);
        p1Data["create"] = create;
        p2Data["create"] = create;
        p1Data["yourTurn"] = Players.First.GPlayer!.IsPlayerTurn();
        p2Data["yourTurn"] = Players.Second.GPlayer!.IsPlayerTurn();
        return new Pair<Response>(new Response(GameResponse.GameCreate, p1Data), new Response(GameResponse.GameCreate, p2Data));
    }

    // ---- Spectators and replay ------------------------------------------------------------------------------------

    /// <summary>The game as spectators see it: player one's view without the cards in player one's hand.</summary>
    public JsonObject SpectatorSnapshot()
    {
        var data = GameData.Get(this, playerOne: true);
        data["player"]!["hand"] = HiddenHand(Players.First.GPlayer!);
        data["yourTurn"] = Players.First.GPlayer!.IsPlayerTurn();
        data["create"] = false;
        data["spectator"] = true;
        data["practice"] = IsPractice;
        return data;
    }

    /// <summary>Called for every message player one receives.</summary>
    public void Mirror(Response response)
    {
        if (!MirroredTypes.Contains(response.Type))
        {
            return;
        }

        Response mirrored;
        if (response.Type is (int)GameResponse.GameCreate or (int)GameResponse.GameRecover)
        {
            var snapshot = SpectatorSnapshot();
            snapshot["create"] = response.Payload?["create"]?.DeepClone();
            mirrored = new Response(GameResponse.SpectateStart, snapshot);
        }
        else if (response.Type == (int)GameResponse.GameNewCard)
        {
            var cards = response.Payload?["card"] as JsonArray ?? [];
            mirrored = new Response(GameResponse.GameNewCard, new JsonObject
            {
                ["card"] = new JsonArray([.. cards.Select(c => (JsonNode)new JsonObject { ["cid"] = c?["cid"]?.DeepClone() })]),
                ["hidden"] = true,
            });
        }
        else
        {
            mirrored = response;
        }

        Broadcast(mirrored);
    }

    /// <summary>Sends to spectators and records for the replay.</summary>
    public void Broadcast(Response response)
    {
        Record(response);
        foreach (var spectator in Spectators)
        {
            spectator.GameContext?.Send(response);
        }
    }

    /// <summary>Adds a message to the replay only.</summary>
    public void Record(Response response) => _replay.Add(new JsonObject
    {
        ["t"] = (long)(_time.GetUtcNow() - StartedAt).TotalMilliseconds,
        ["m"] = JsonNode.Parse(response.ToJson()),
    });

    public static JsonArray HiddenHand(GamePlayer gp) =>
        new([.. gp.HandCards.Values.Select(c => (JsonNode)new JsonObject { ["cid"] = c.Cid })]);

    public JsonObject Summary() => new()
    {
        ["gameId"] = GameId,
        ["practice"] = IsPractice,
        ["turn"] = Turn,
        ["round"] = Round,
        ["spectators"] = Spectators.Count,
        ["startedAt"] = StartedAt.ToUnixTimeMilliseconds(),
        ["players"] = new JsonArray(
            PlayerSummary(Players.First),
            PlayerSummary(Players.Second)),
    };

    private static JsonObject PlayerSummary(Player p) => new()
    {
        ["name"] = p.Name,
        ["type"] = p.PlayerType.Id,
        ["rating"] = p.IsBot ? null : p.Rating,
        ["health"] = p.GPlayer?.Health,
        ["bot"] = p.IsBot,
    };
}

public static class GameData
{
    public static JsonObject Get(GameRoom room, bool playerOne)
    {
        var (player, opponent) = playerOne
            ? (room.Players.First.GPlayer!, room.Players.Second.GPlayer!)
            : (room.Players.Second.GPlayer!, room.Players.First.GPlayer!);

        return new JsonObject
        {
            ["gameId"] = room.GameId,
            ["round"] = room.Turn,
            ["ident"] = playerOne ? 1 : 2,
            ["player"] = new JsonObject
            {
                ["info"] = player.GetPlayerData(),
                ["board"] = CardsByKey(player.BoardCards),
                ["hand"] = CardsByKey(player.HandCards),
            },
            ["opponent"] = new JsonObject
            {
                ["info"] = opponent.GetPlayerData(),
                ["board"] = CardsByKey(opponent.BoardCards),
                // Only the instance ids of the opponent's hand are revealed.
                ["hand"] = GameRoom.HiddenHand(opponent),
            },
        };
    }

    private static JsonObject CardsByKey(IEnumerable<KeyValuePair<int, Card>> cards)
    {
        var obj = new JsonObject();
        foreach (var (key, card) in cards)
        {
            obj[key.ToString(System.Globalization.CultureInfo.InvariantCulture)] = card.ToJson();
        }

        return obj;
    }
}
