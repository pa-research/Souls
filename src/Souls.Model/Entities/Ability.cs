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

    // Added with the 2026 card set.
    public const int Ward = 10;
    public const int Fury = 11;
    public const int Venom = 12;
    public const int Rally = 13;
    public const int Insight = 14;
    public const int Inferno = 15;
    public const int Regenerate = 16;
    public const int Grow = 17;
    public const int Drain = 18;
    public const int Brood = 19;

    // Added with spells.
    public const int Empower = 20;

    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Parameter { get; set; }
}
