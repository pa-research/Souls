namespace Souls.Model;

/// <summary>Card rarities. Rarer cards are stronger for their cost, cost more coins and fewer copies fit in a deck.</summary>
public static class Rarity
{
    public const int Common = 1;
    public const int Rare = 2;
    public const int Epic = 3;
    public const int Legendary = 4;

    public static string Name(int rarity) => rarity switch
    {
        Rare => "Rare",
        Epic => "Epic",
        Legendary => "Legendary",
        _ => "Common",
    };

    /// <summary>Lower-case name used as a CSS class and in the game clients.</summary>
    public static string Css(int rarity) => Name(rarity).ToLowerInvariant();

    /// <summary>The name in the reader's language.</summary>
    public static Localization.GameText Text(int rarity) => new("rarity." + Css(rarity));

    /// <summary>How many copies of a card of this rarity a deck may hold.</summary>
    public static int MaxCopies(int rarity) => rarity switch
    {
        Rare => 3,
        Epic => 2,
        Legendary => 1,
        _ => GameRules.MaxCopiesInDeck,
    };
}
