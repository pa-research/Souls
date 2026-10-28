using System.Globalization;
using System.Text.Json.Nodes;
using Souls.Server.Game;

namespace Souls.Server.Objects;

/// <summary>The in-game state of a player (hero stats, hand and board).</summary>
public sealed class GamePlayer
{
    public const int MaxHandCards = 10;
    public const int BoardSlots = 7;

    /// <summary>Hand cards keyed by <see cref="Card.Cid"/>.</summary>
    public Dictionary<int, Card> HandCards { get; } = new(MaxHandCards);

    /// <summary>Board cards keyed by slot id.</summary>
    public Dictionary<int, Card> BoardCards { get; } = new(BoardSlots);

    public bool IsPlayerOne { get; init; }
    public bool IsDead { get; set; }
    public int Attack { get; set; }
    public int Health { get; set; }
    public int Mana { get; set; }
    public required string Name { get; init; }
    public int Rank { get; init; }
    public int Type { get; init; }
    public bool HasAttacked { get; set; }
    public GameRoom? GameRoom { get; set; }

    /// <summary>Hero stats as strings, like the original server sent them.</summary>
    public JsonObject GetPlayerData() => new()
    {
        ["health"] = Health.ToString(CultureInfo.InvariantCulture),
        ["attack"] = Attack.ToString(CultureInfo.InvariantCulture),
        ["mana"] = Mana.ToString(CultureInfo.InvariantCulture),
        ["name"] = Name,
        ["type"] = Type.ToString(CultureInfo.InvariantCulture),
    };

    public void ResetAttacked()
    {
        HasAttacked = false;
        foreach (var c in BoardCards.Values)
        {
            c.HasAttacked = false;
        }
    }

    public bool HasEnoughMana(Card c) => Mana >= c.Cost;

    public void AttackCard(Card defender)
    {
        defender.Health -= Attack;
        Health -= defender.Attack;
        if (Health < 1)
        {
            IsDead = true;
        }

        if (defender.Health < 1)
        {
            defender.IsDead = true;
        }

        HasAttacked = true;
    }

    public void AttackHero(GamePlayer opponent)
    {
        opponent.Health -= Attack;
        Health -= opponent.Attack;
        if (Health < 1)
        {
            IsDead = true;
        }

        if (opponent.Health < 1)
        {
            opponent.IsDead = true;
        }

        HasAttacked = true;
    }

    public bool IsPlayerTurn() => GameRoom?.CurrentPlaying?.GPlayer == this;

    public void AddCardsToHand(IEnumerable<Card> cards)
    {
        foreach (var c in cards)
        {
            HandCards[c.Cid] = c;
        }
    }

    public Card? FindBoardCard(int cid) => BoardCards.Values.FirstOrDefault(c => c.Cid == cid);

    public void RemoveBoardCard(Card c) => BoardCards.Remove(c.SlotId);
}
