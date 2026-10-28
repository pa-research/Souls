using System.Text.Json.Nodes;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

public sealed class GameRoom
{
    private static int _gameCounter;

    public GameRoom(Pair<Player> players, TimeProvider time)
    {
        GameId = Interlocked.Increment(ref _gameCounter);
        Players = players;
        StartedAt = time.GetUtcNow();
        CurrentPlaying = players.First;

        var p1 = players.First.GPlayer!;
        var p2 = players.Second.GPlayer!;
        p1.GameRoom = this;
        p2.GameRoom = this;
        p1.Mana += Round;
        p2.Mana += Round;
        p1.AddCardsToHand(GetRandomCards(players.First, 3));
        p2.AddCardsToHand(GetRandomCards(players.Second, 3));
    }

    /// <summary>In-memory id while running; replaced by the database id when the game is saved.</summary>
    public int GameId { get; set; }
    public Pair<Player> Players { get; }
    public int Turn { get; private set; }
    public int Round { get; private set; } = 1;

    /// <summary>The player whose turn it is.</summary>
    public Player CurrentPlaying { get; private set; }
    public bool IsEnded { get; set; }
    public Player? Winner { get; set; }
    public GameLogger Logger { get; } = new();
    public DateTimeOffset StartedAt { get; }

    /// <summary>Draws random copies of cards the player owns.</summary>
    public static List<Card> GetRandomCards(Player p, int amount = 1)
    {
        var cards = new List<Card>(amount);
        if (p.OwningCards.Count == 0)
        {
            return cards;
        }

        for (var i = 0; i < amount; i++)
        {
            cards.Add(p.OwningCards[Random.Shared.Next(p.OwningCards.Count)].NewInstance());
        }

        return cards;
    }

    /// <summary>Passes the turn. The round increases each time it is player one's turn again.</summary>
    public void NextTurn()
    {
        if (++Turn % 2 == 0)
        {
            Round++;
            CurrentPlaying = Players.First;
        }
        else
        {
            CurrentPlaying = Players.Second;
        }

        // Mana equals the round, capped at 10.
        CurrentPlaying.GPlayer!.Mana = Math.Min(Round, 10);
        Players.First.GPlayer!.ResetAttacked();
        Players.Second.GPlayer!.ResetAttacked();
    }

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
                ["hand"] = new JsonArray([.. opponent.HandCards.Values.Select(c => (JsonNode)new JsonObject { ["cid"] = c.Cid })]),
            },
        };
    }

    private static JsonObject CardsByKey(Dictionary<int, Card> cards)
    {
        var obj = new JsonObject();
        foreach (var (key, card) in cards)
        {
            obj[key.ToString(System.Globalization.CultureInfo.InvariantCulture)] = card.ToJson();
        }

        return obj;
    }
}
