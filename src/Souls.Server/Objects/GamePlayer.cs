using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Souls.Server.Game;

namespace Souls.Server.Objects;

/// <summary>
/// The in-game state of a player (hero stats, deck, hand and board). Saved as JSON with the game (see
/// <see cref="GameRoom.Snapshot"/>): every property with a setter is state, and so are the collections.
/// </summary>
public sealed class GamePlayer
{
    public const int MaxHandCards = 10;
    public const int BoardSlots = 7;

    /// <summary>Hand cards keyed by <see cref="Card.Cid"/>, in the order they were drawn.</summary>
    [JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
    public OrderedDictionary<int, Card> HandCards { get; private set; } = new(MaxHandCards);

    /// <summary>Board cards keyed by slot id.</summary>
    [JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
    public Dictionary<int, Card> BoardCards { get; } = new(BoardSlots);

    /// <summary>The shuffled deck; the next card is drawn from the end.</summary>
    [JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
    public List<Card> Deck { get; private set; } = [];

    /// <summary>Spells that were cast: they leave the hand for this pile, never the board.</summary>
    [JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
    public List<Card> Used { get; private set; } = [];

    // A copy of a copy shares its hand, deck and used pile (the collections) with the copy it came from: a copy changes
    // them only while the bot's lookahead tries a move on it, before any copy is made of it, and takes its own first.
    private bool _sharedHand;
    private bool _sharedDeck;
    private bool _sharedUsed;

    /// <summary>The hand, to change: a copy's own (see <see cref="Copy"/>).</summary>
    public OrderedDictionary<int, Card> OwnHand()
    {
        if (_sharedHand)
        {
            var hand = new OrderedDictionary<int, Card>(MaxHandCards);
            foreach (var (cid, card) in HandCards)
            {
                hand.Add(cid, card);
            }

            (HandCards, _sharedHand) = (hand, false);
        }

        return HandCards;
    }

    /// <summary>The deck, to change: a copy's own.</summary>
    public List<Card> OwnDeck()
    {
        if (_sharedDeck)
        {
            (Deck, _sharedDeck) = ([.. Deck], false);
        }

        return Deck;
    }

    /// <summary>The used pile, to change: a copy's own.</summary>
    public List<Card> OwnUsed()
    {
        if (_sharedUsed)
        {
            (Used, _sharedUsed) = ([.. Used], false);
        }

        return Used;
    }

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

    /// <summary>The hero power (see <see cref="Model.GameRules.HeroPowers"/>), one of the class's.</summary>
    public int Power { get; init; }
    public int? RaceId { get; init; }
    public bool HasAttacked { get; set; }
    public bool HeroPowerUsed { get; set; }

    /// <summary>Damage of the next draw from an empty deck.</summary>
    public int Fatigue { get; set; }

    [JsonIgnore]
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

    /// <summary>
    /// Shuffles the cards a player sends back in the mulligan into their deck. Each player has their own, seeded from
    /// the game's, so a reproducible game does not depend on whose mulligan arrives first.
    /// </summary>
    public Random MulliganRandom { get; set; } = Random.Shared;

    /// <summary>Hero stats as strings, like the original server sent them, plus the new stats.</summary>
    public JsonObject GetPlayerData() => new()
    {
        ["health"] = Health.ToString(CultureInfo.InvariantCulture),
        ["attack"] = Attack.ToString(CultureInfo.InvariantCulture),
        ["mana"] = Mana.ToString(CultureInfo.InvariantCulture),
        ["name"] = Name,
        ["type"] = Type.ToString(CultureInfo.InvariantCulture),
        ["power"] = Power,
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
            Power = Power,
            RaceId = RaceId,
            HasAttacked = HasAttacked,
            HeroPowerUsed = HeroPowerUsed,
            Fatigue = Fatigue,
            MulliganDone = MulliganDone,
            GameRoom = room,
        };
        foreach (var (slot, card) in BoardCards)
        {
            copy.BoardCards[slot] = card.Copy();
        }

        // The first copy of the real game gets its own cards and its own shuffled deck, so it does not reveal the next
        // draws. Copies of that copy (most of the bot's lookahead) share its hand, deck and used pile (see OwnHand), and so
        // their cards: nothing changes a card in the hand or the deck, and a card leaving them is copied (see
        // GameEngine.TryUseCard, TryCastSpell, Draw).
        if (GameRoom?.IsCopy == true)
        {
            Share(copy);
            return copy;
        }

        foreach (var (cid, card) in HandCards)
        {
            copy.HandCards[cid] = card.Copy();
        }

        copy.Deck.Capacity = Deck.Count;
        copy.Deck.AddRange(Deck.Select(c => c.Copy()));
        room.Random.Shuffle(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(copy.Deck));
        copy.Used.AddRange(Used);
        return copy;
    }

    private void Share(GamePlayer copy)
    {
        (copy.HandCards, copy._sharedHand) = (HandCards, true);
        (copy.Deck, copy._sharedDeck) = (Deck, true);
        (copy.Used, copy._sharedUsed) = (Used, true);
    }

    /// <summary>
    /// Copies this player (of a copy of the game) into <paramref name="target"/>, the same player in an earlier copy:
    /// the same state as <see cref="Copy"/> gives (the rest as a new player's), sharing the hand, deck and used pile like
    /// it, in the target's board and board cards, which belong to that copy alone (see <see cref="GameRoom.CopyInto"/>).
    /// </summary>
    public void CopyInto(GamePlayer target)
    {
        target.IsDead = IsDead;
        target.Attack = Attack;
        target.Health = Health;
        target.MaxHealth = MaxHealth;
        target.Armor = Armor;
        target.Mana = Mana;
        target.MaxMana = MaxMana;
        target.HasAttacked = HasAttacked;
        target.HeroPowerUsed = HeroPowerUsed;
        target.Fatigue = Fatigue;
        target.MulliganDone = MulliganDone;
        target.CardsPlayed = 0;
        target.CardsDestroyed = 0;
        target.AbilitiesUsed = 0;
        target.HeroDamage = 0;
        target.TimeoutsInARow = 0;
        target.EmoteClock = default;
        target.EmotesMuted = false;
        target.MulliganRandom = Random.Shared;

        Share(target);
        var spare = target._spareCards ??= [];
        spare.AddRange(target.BoardCards.Values);
        target.BoardCards.Clear();
        foreach (var (slot, card) in BoardCards)
        {
            target.BoardCards[slot] = spare.Count > 0 ? card.CopyTo(spare[^1]) : card.Copy();
            if (spare.Count > 0)
            {
                spare.RemoveAt(spare.Count - 1);
            }
        }

        spare.Clear();
    }

    private List<Card>? _spareCards;

    public bool HasEnoughMana(Card c) => Mana >= c.Cost;

    /// <summary>Nobody's turn has started while the mulligan runs.</summary>
    public bool IsPlayerTurn() => GameRoom is { InMulligan: false } room && room.CurrentPlaying?.GPlayer == this;

    // Loops, not LINQ: these run for every move the bot's lookahead tries.
    public bool HasTaunt
    {
        get
        {
            foreach (var c in BoardCards.Values)
            {
                if (c.HasTaunt && !c.IsDead)
                {
                    return true;
                }
            }

            return false;
        }
    }

    public Card? FindBoardCard(int cid)
    {
        foreach (var c in BoardCards.Values)
        {
            if (c.Cid == cid)
            {
                return c;
            }
        }

        return null;
    }

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
            if (near + distance is >= 0 and < BoardSlots && !BoardCards.ContainsKey(near + distance))
            {
                return near + distance;
            }

            if (near - distance is >= 0 and < BoardSlots && !BoardCards.ContainsKey(near - distance))
            {
                return near - distance;
            }
        }

        return null;
    }
}
