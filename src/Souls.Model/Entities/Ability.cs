namespace Souls.Model.Entities;

/// <summary>A card ability. Ids must match the abilities implemented by the game engine.</summary>
public class Ability
{
    public const int Heal = 1;
    public const int Sacrifice = 2;

    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Parameter { get; set; }
}
