using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>Rule constants and rules text shared by the game server and the web site.</summary>
public static class GameRules
{
    public const int DeckSize = 20;
    public const int MaxCopiesInDeck = 4;
    public const int MaxCardLevel = 3;
    public const int StartingHand = 3;
    public const int HeroPowerCost = 2;
    public const int MaxMana = 10;

    /// <summary>Heal ability amount (+2 for Lightbringer cards); adjacent friendly cards get 1.</summary>
    public const int HealAmount = 3;
    public const int HardenArmor = 3;
    public const int BurnDamage = 2;
    public const int DeathCurseDamage = 2;
    public const int LightbringerBlessing = 2;

    /// <summary>Id of the token card created by Summon (not a database card).</summary>
    public const int LostSoulId = 0;

    /// <summary>Coins needed to upgrade a card from <paramref name="level"/> to the next level.</summary>
    public static int UpgradeCost(Card card, int level) => card.VendorPrice + 2 * level;

    /// <summary>Attack and health bonus of an upgraded card.</summary>
    public static int LevelBonus(int level) => Math.Max(0, level - 1);

    public static class Races
    {
        public const int Darkness = 1;
        public const int Vampiric = 2;
        public const int Lightbringer = 3;
        public const int Ferocious = 4;
    }

    public sealed record RuleText(string Name, string Text);

    public static readonly IReadOnlyDictionary<int, RuleText> AbilityTexts = new Dictionary<int, RuleText>
    {
        [Ability.Heal] = new("Heal", $"Restores {HealAmount} health to a friendly card or your hero, and 1 to the cards next to it."),
        [Ability.Sacrifice] = new("Sacrifice", "Destroys this card and gives its attack, health and armor to a friendly card or your hero."),
        [Ability.Taunt] = new("Taunt", "Enemies must attack this card before anything else."),
        [Ability.Summon] = new("Summon", "When played, summons a 1/1 Lost Soul next to it."),
        [Ability.Paralyze] = new("Paralyze", "An enemy card cannot attack or act during its next turn."),
        [Ability.Haunt] = new("Haunt", "The first time it dies, it returns to your hand."),
        [Ability.Harden] = new("Harden", $"A friendly card or your hero gains {HardenArmor} armor."),
        [Ability.Burn] = new("Burn", $"Deals {BurnDamage} damage to an enemy card or hero."),
        [Ability.Charge] = new("Charge", "Can attack the turn it is played."),
    };

    /// <summary>Abilities used like an attack (drag from the card to a target); the others work on their own.</summary>
    public static bool IsActivated(int? abilityId) => abilityId is Ability.Heal or Ability.Sacrifice or Ability.Paralyze or Ability.Harden or Ability.Burn;

    /// <summary>What an activated ability can target: "friendlyCard", "ownHero", "enemyHero", "enemyCard".</summary>
    public static IReadOnlyList<string> AbilityTargets(int abilityId) => abilityId switch
    {
        Ability.Heal or Ability.Sacrifice or Ability.Harden => ["friendlyCard", "ownHero"],
        Ability.Paralyze => ["enemyCard"],
        Ability.Burn => ["enemyCard", "enemyHero"],
        _ => [],
    };

    /// <summary>What a hero power target kind ("enemy", "friendly", "none") allows.</summary>
    public static IReadOnlyList<string> PowerTargets(string target) => target switch
    {
        "enemy" => ["enemyCard", "enemyHero"],
        "friendly" => ["friendlyCard", "ownHero"],
        _ => [],
    };

    public static readonly IReadOnlyDictionary<int, RuleText> RaceTexts = new Dictionary<int, RuleText>
    {
        [Races.Darkness] = new("Darkness", $"Death curse: when it dies, deals {DeathCurseDamage} damage to a random enemy."),
        [Races.Vampiric] = new("Vampiric", "Lifesteal: damage it deals heals your hero."),
        [Races.Lightbringer] = new("Lightbringer", $"Blessing: when played, restores {LightbringerBlessing} health to your hero. Its heals restore 2 more."),
        [Races.Ferocious] = new("Ferocious", "Frenzy: +1 attack when it attacks."),
    };

    public sealed record HeroPowerText(string Name, string Text, string Target);

    /// <summary>Hero powers by player type (class) id. Target: "enemy", "friendly" or "none".</summary>
    public static readonly IReadOnlyDictionary<int, HeroPowerText> HeroPowers = new Dictionary<int, HeroPowerText>
    {
        [1] = new("Rabid Bite", "Deal 1 damage to an enemy card or hero.", "enemy"),
        [2] = new("Drain", "Deal 1 damage to an enemy card or hero and restore 1 health to your hero.", "enemy"),
        [3] = new("Holy Light", "Restore 2 health to a friendly card or your hero.", "friendly"),
        [4] = new("Fade", "Your hero gains 2 armor.", "none"),
    };

    public static class Keywords
    {
        public const string SummoningSick = "Arrives exhausted: cards cannot attack or act the turn they are played (unless they have Charge).";
        public const string Paralyzed = "Paralyzed: cannot attack or act this turn.";
        public const string Armor = "Armor absorbs damage before health does.";
        public const string Fatigue = "When your deck is empty, each draw deals 1 more damage to your hero than the last.";
        public const string Burned = "Drawing with a full hand (10 cards) burns the drawn card.";
    }
}
