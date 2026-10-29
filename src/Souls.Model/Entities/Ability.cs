namespace Souls.Model.Entities;

/// <summary>A card ability. Ids must match the abilities implemented by the game engine.</summary>
public class Ability
{
    public const int Heal = 1;
    public const int Sacrifice = 2;
    public const int Taunt = 3;
    public const int Summon = 4;
    public const int Paralyze = 5;
    public const int Haunt = 6;
    public const int Harden = 7;
    public const int Burn = 8;
    public const int Charge = 9;

    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Parameter { get; set; }
}
