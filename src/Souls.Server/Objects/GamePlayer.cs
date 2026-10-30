using System.Globalization;
using System.Text.Json.Nodes;
using Souls.Server.Game;

namespace Souls.Server.Objects;

/// <summary>The in-game state of a player (hero stats, deck, hand and board).</summary>
public sealed class GamePlayer
{
    public const int MaxHandCards = 10;
    public const int BoardSlots = 7;

    /// <summary>Hand cards keyed by <see cref="Card.Cid"/>, in the order they were drawn.</summary>
    public OrderedDictionary<int, Card> HandCards { get; } = new(MaxHandCards);

    /// <summary>Board cards keyed by slot id.</summary>
    public Dictionary<int, Card> BoardCards { get; } = new(BoardSlots);

    /// <summary>The shuffled deck; the next card is drawn from the end.</summary>
    public List<Card> Deck { get; } = [];

    /// <summary>Spells that were cast: they leave the hand for this pile, never the board.</summary>
    public List<Card> Used { get; } = [];

    public bool IsPlayerOne { get; init; }

    /// <summary>1 for player one, 2 for player two: how events and the state refer to the heroes.</summary>
    public int Ident => IsPlayerOne ? 1 : 2;
    public bool IsDead { get; set; }
    public int Attack { get; set; }
    public int Health { get; set; }
    public int MaxHealth { get; set; }
    public int Armor { get; set; }
    public int Mana { get; set; }

    /// <summary>Mana at the start of this turn.</summary>
    public int MaxMana { get; set; }

    /// <summary>Extra mana each turn from the hero class.</summary>
    public int BonusMana { get; init; }
    public required string Name { get; init; }
    public int Rank { get; init; }
    public int Rating { get; init; }
    public int Type { get; init; }
    public int? RaceId { get; init; }
    public bool HasAttacked { get; set; }
    public bool HeroPowerUsed { get; set; }

    /// <summary>Damage of the next draw from an empty deck.</summary>
    public int Fatigue { get; set; }
    public GameRoom? GameRoom { get; set; }

    // What the player did, for daily quests.
    public int CardsPlayed { get; set; }
    public int CardsDestroyed { get; set; }
    public int AbilitiesUsed { get; set; }
    public int HeroDamage { get; set; }

    /// <summary>Turns in a row that ended because the turn timer ran out.</summary>
    public int TimeoutsInARow { get; set; }

    /// <summary>Emote rate limit, see <see cref="GameEngine.Throttle"/>.</summary>
    public DateTimeOffset EmoteClock { get; set; }

    /// <summary>The player muted the opponent's emotes for this game.</summary>
    public bool EmotesMuted { get; set; }

    /// <summary>The player has chosen which starting cards to replace (or kept them).</summary>
    public bool MulliganDone { get; set; }

    /// <summary>Hero stats as strings, like the original server sent them, plus the new stats.</summary>
    public JsonObject GetPlayerData() => new()
    {
        ["health"] = Health.ToString(CultureInfo.InvariantCulture),
        ["attack"] = Attack.ToString(CultureInfo.InvariantCulture),
        ["mana"] = Mana.ToString(CultureInfo.InvariantCulture),
        ["name"] = Name,
        ["type"] = Type.ToString(CultureInfo.InvariantCulture),
        ["armor"] = Armor,
        ["maxHealth"] = MaxHealth,
        ["maxMana"] = MaxMana,
        ["rating"] = Rating,
        ["ident"] = Ident,
    };

    /// <summary>A deep copy for <see cref="GameRoom.Copy"/>; the deck is reshuffled with the copy's random numbers.</summary>
    public GamePlayer Copy(GameRoom room)
    {
        var copy = new GamePlayer
        {
            IsPlayerOne = IsPlayerOne,
            IsDead = IsDead,
            Attack = Attack,
            Health = Health,
            MaxHealth = MaxHealth,
            Armor = Armor,
            Mana = Mana,
            MaxMana = MaxMana,
            BonusMana = BonusMana,
            Name = Name,
            Rank = Rank,
            Rating = Rating,
            Type = Type,
            RaceId = RaceId,
            HasAttacked = HasAttacked,
            HeroPowerUsed = HeroPowerUsed,
            Fatigue = Fatigue,
            MulliganDone = MulliganDone,
            GameRoom = room,
        };
        foreach (var (cid, card) in HandCards)
        {
            copy.HandCards[cid] = card.Copy();
        }

        foreach (var (slot, card) in BoardCards)
        {
            copy.BoardCards[slot] = card.Copy();
        }

        copy.Deck.AddRange(Deck.Select(c => c.Copy()));
        copy.Used.AddRange(Used);
        room.Random.Shuffle(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(copy.Deck));
        return copy;
    }

    public bool HasEnoughMana(Card c) => Mana >= c.Cost;

    /// <summary>Nobody's turn has started while the mulligan runs.</summary>
    public bool IsPlayerTurn() => GameRoom is { InMulligan: false } room && room.CurrentPlaying?.GPlayer == this;

    public bool HasTaunt => BoardCards.Values.Any(c => c.HasTaunt && !c.IsDead);

    public Card? FindBoardCard(int cid) => BoardCards.Values.FirstOrDefault(c => c.Cid == cid);

    public void RemoveBoardCard(Card c)
    {
        if (BoardCards.TryGetValue(c.SlotId, out var there) && there == c)
        {
            BoardCards.Remove(c.SlotId);
        }
    }

    /// <summary>A free slot as close to <paramref name="near"/> as possible, or <c>null</c> if the board is full.</summary>
    public int? FreeSlotNear(int near)
    {
        for (var distance = 1; distance < BoardSlots; distance++)
        {
            foreach (var slot in new[] { near + distance, near - distance })
            {
                if (slot is >= 0 and < BoardSlots && !BoardCards.ContainsKey(slot))
                {
                    return slot;
                }
            }
        }

        return null;
    }
}
