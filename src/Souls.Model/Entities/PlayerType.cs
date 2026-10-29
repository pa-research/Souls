namespace Souls.Model.Entities;

/// <summary>The hero class a player picks on registration.</summary>
public class PlayerType
{
    public int Id { get; set; }
    public int? AbilityId { get; set; }
    public Ability? Ability { get; set; }
    public int? RaceId { get; set; }
    public Race? Race { get; set; }
    public required string Name { get; set; }
    public int Attack { get; set; }
    public int Armor { get; set; }
    public int Health { get; set; }
    public int Mana { get; set; }
}
