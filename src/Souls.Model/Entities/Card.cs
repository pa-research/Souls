namespace Souls.Model.Entities;

public class Card
{
    public int Id { get; set; }
    public int? AbilityId { get; set; }
    public Ability? Ability { get; set; }
    public int? RaceId { get; set; }
    public Race? Race { get; set; }
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
}
