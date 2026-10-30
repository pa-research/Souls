namespace Souls.Model.Entities;

public class Card
{
    public int Id { get; set; }
    public int? AbilityId { get; set; }
    public Ability? Ability { get; set; }

    /// <summary>Strength of the ability (Burn 3, Heal 4, ...); <c>null</c> uses the ability's default.</summary>
    public int? AbilityValue { get; set; }
    public int? RaceId { get; set; }
    public Race? Race { get; set; }

    /// <summary>A class card can only be owned and played by heroes of this class (see <see cref="GameRules.CanUse"/>); <c>null</c>: every class.</summary>
    public int? ClassId { get; set; }
    public PlayerType? Class { get; set; }
    public required string Name { get; set; }
    public int Attack { get; set; }
    public int Health { get; set; }
    public int Armor { get; set; }
    public int Cost { get; set; }
    public int VendorPrice { get; set; }

    /// <summary>Level 1 cards are starter cards that can be picked on registration.</summary>
    public int Level { get; set; }

    /// <summary>Relative URL of the card portrait image.</summary>
    public string? Portrait { get; set; }

    /// <summary>See <see cref="Model.Rarity"/>: limits the copies in a deck.</summary>
    public int Rarity { get; set; } = Model.Rarity.Common;

    /// <summary>A line of story text shown under the rules text.</summary>
    public string? Flavor { get; set; }

    /// <summary>Minions go on the board; spells are cast from the hand and have no attack or health.</summary>
    public CardKind Kind { get; set; }
}

public enum CardKind
{
    Minion,

    /// <summary>Cast from the hand on its target (or on nothing), then used up: it never takes a board slot.</summary>
    Spell,
}
