using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>Rule constants and rules text shared by the game server and the web site.</summary>
public static class GameRules
{
    public const int DeckSize = 20;
    public const int MaxCopiesInDeck = 4;
    public const int MaxCardLevel = 3;
    public const int StartingHand = 3;

    /// <summary>
    /// The player going second draws this many more cards when the mulligan is over (and gets 1 extra mana on their
    /// first turn).
    /// </summary>
    public const int SecondPlayerExtraCards = 1;
    public const int HeroPowerCost = 2;
    public const int MaxMana = 10;

    /// <summary>Default Heal ability amount (+2 for Lightbringer cards); adjacent friendly cards get 1.</summary>
    public const int HealAmount = 3;
    public const int LightbringerHealBonus = 2;
    public const int HardenArmor = 3;
    public const int BurnDamage = 2;
    public const int DeathCurseDamage = 2;
    public const int LightbringerBlessing = 2;

    /// <summary>Id of the token card created by Summon and Brood (not a database card).</summary>
    public const int LostSoulId = 0;
    public const string LostSoulPortrait = "/Content/Images/Card/Portraits/lost-soul.jpg";

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

    /// <summary>When an ability does its thing.</summary>
    public enum Timing
    {
        /// <summary>Always on (Taunt, Charge, Ward, Fury, Venom).</summary>
        Passive,

        /// <summary>Used like an attack: drag from the card to a target.</summary>
        Activated,

        /// <summary>When the card is played.</summary>
        OnPlay,

        /// <summary>At the start of its owner's turn.</summary>
        TurnStart,

        /// <summary>When the card dies.</summary>
        OnDeath,
    }

    /// <summary>
    /// An ability. <paramref name="Template"/> is the rules text with <c>{0}</c> for the card's value (Burn 3 deals 3
    /// damage); <paramref name="DefaultValue"/> is used by cards without one.
    /// </summary>
    public sealed record AbilityDefinition(int Id, string Name, Timing Timing, int DefaultValue, string Template, IReadOnlyList<string> Targets);

    private static readonly string[] FriendlyTargets = ["friendlyCard", "ownHero"];
    private static readonly string[] EnemyTargets = ["enemyCard", "enemyHero"];

    public static readonly IReadOnlyDictionary<int, AbilityDefinition> Abilities = new AbilityDefinition[]
    {
        new(Ability.Heal, "Heal", Timing.Activated, HealAmount, "Restores {0} health to a friendly card or your hero, and 1 to the cards next to it.", FriendlyTargets),
        new(Ability.Sacrifice, "Sacrifice", Timing.Activated, 0, "Destroys this card and gives its attack, health and armor to a friendly card or your hero.", FriendlyTargets),
        new(Ability.Taunt, "Taunt", Timing.Passive, 0, "Enemies must attack this card before anything else.", []),
        new(Ability.Summon, "Summon", Timing.OnPlay, 1, "When played, summons {0} 1/1 Lost Soul(s) next to it.", []),
        new(Ability.Paralyze, "Paralyze", Timing.Activated, 0, "An enemy card cannot attack or act during its next turn.", ["enemyCard"]),
        new(Ability.Haunt, "Haunt", Timing.OnDeath, 0, "The first time it dies, it returns to your hand.", []),
        new(Ability.Harden, "Harden", Timing.Activated, HardenArmor, "A friendly card or your hero gains {0} armor.", FriendlyTargets),
        new(Ability.Burn, "Burn", Timing.Activated, BurnDamage, "Deals {0} damage to an enemy card or hero.", EnemyTargets),
        new(Ability.Charge, "Charge", Timing.Passive, 0, "Can attack the turn it is played.", []),
        new(Ability.Ward, "Ward", Timing.Passive, 0, "The first time it would take damage, the ward breaks instead.", []),
        new(Ability.Fury, "Fury", Timing.Passive, 0, "Can attack twice each turn.", []),
        new(Ability.Venom, "Venom", Timing.Passive, 0, "Destroys any card it damages.", []),
        new(Ability.Rally, "Rally", Timing.OnPlay, 1, "When played, the cards next to it gain +{0} attack.", []),
        new(Ability.Insight, "Insight", Timing.OnPlay, 1, "When played, draw {0} card(s).", []),
        new(Ability.Inferno, "Inferno", Timing.OnPlay, 1, "When played, deals {0} damage to every enemy card.", []),
        new(Ability.Regenerate, "Regenerate", Timing.TurnStart, 2, "At the start of your turn, restores {0} health to itself.", []),
        new(Ability.Grow, "Grow", Timing.TurnStart, 1, "At the start of your turn, gains +{0} attack and +{0} health.", []),
        new(Ability.Drain, "Drain", Timing.Activated, 2, "Deals {0} damage to an enemy card or hero and restores {0} health to your hero.", EnemyTargets),
        new(Ability.Brood, "Brood", Timing.OnDeath, 1, "When it dies, summons {0} 1/1 Lost Soul(s) in its place.", []),
        new(Ability.Empower, "Empower", Timing.Activated, 1, "A friendly card gains +{0} attack and +{0} health.", ["friendlyCard"]),
    }.ToDictionary(a => a.Id);

    /// <summary>The value an ability works with on a card (the card's own, or the ability's default).</summary>
    public static int AbilityValue(int abilityId, int? value) =>
        value ?? (Abilities.TryGetValue(abilityId, out var a) ? a.DefaultValue : 0);

    /// <summary>The ability as printed on the card face: "Burn 3", "Rally +1", "Taunt".</summary>
    public static string AbilityLabel(int abilityId, int? value)
    {
        if (!Abilities.TryGetValue(abilityId, out var a))
        {
            return "?";
        }

        var v = AbilityValue(abilityId, value);
        return abilityId switch
        {
            Ability.Rally or Ability.Grow or Ability.Empower => $"{a.Name} +{v}",
            Ability.Summon or Ability.Insight or Ability.Brood => v > 1 ? $"{a.Name} {v}" : a.Name,
            _ when a.Template.Contains("{0}", StringComparison.Ordinal) => $"{a.Name} {v}",
            _ => a.Name,
        };
    }

    /// <summary>The rules text of a card's ability with its numbers filled in (Lightbringer heals restore 2 more).</summary>
    public static string AbilityText(int abilityId, int? value, int? raceId = null)
    {
        if (!Abilities.TryGetValue(abilityId, out var a))
        {
            return "";
        }

        var v = AbilityValue(abilityId, value) + (abilityId == Ability.Heal && raceId == Races.Lightbringer ? LightbringerHealBonus : 0);
        var text = string.Format(System.Globalization.CultureInfo.InvariantCulture, a.Template, v);
        return v == 1 ? text.Replace("(s)", "", StringComparison.Ordinal) : text.Replace("(s)", "s", StringComparison.Ordinal);
    }

    /// <summary>Generic rules text of every ability (with default values), for tooltips and the rules pages.</summary>
    public static readonly IReadOnlyDictionary<int, RuleText> AbilityTexts =
        Abilities.Values.ToDictionary(a => a.Id, a => new RuleText(a.Name, AbilityText(a.Id, null)));

    /// <summary>Abilities used like an attack (drag from the card to a target); the others work on their own.</summary>
    public static bool IsActivated(int? abilityId) =>
        abilityId is { } id && Abilities.TryGetValue(id, out var a) && a.Timing == Timing.Activated;

    /// <summary>
    /// Abilities a spell can have: the activated ones but Sacrifice (cast on their targets like the ability) and the
    /// on-play ones that do not need a board slot (cast on nothing).
    /// </summary>
    public static bool IsSpellAbility(int? abilityId) =>
        abilityId is Ability.Insight or Ability.Inferno || IsActivated(abilityId) && abilityId != Ability.Sacrifice;

    /// <summary>
    /// A spell's ability value at an upgrade level: +1 per level above 1 (Burn 3 at level 2 deals 4), where cards
    /// gain attack and health instead. <c>null</c> keeps the ability's default.
    /// </summary>
    public static int? SpellValue(int abilityId, int? value, int level) =>
        level > 1 && Abilities.TryGetValue(abilityId, out var a) && a.Template.Contains("{0}", StringComparison.Ordinal)
            ? AbilityValue(abilityId, value) + LevelBonus(level)
            : value;

    /// <summary>What an activated ability can target: "friendlyCard", "ownHero", "enemyHero", "enemyCard".</summary>
    public static IReadOnlyList<string> AbilityTargets(int abilityId) =>
        Abilities.TryGetValue(abilityId, out var a) ? a.Targets : [];

    /// <summary>What a hero power target kind ("enemy", "friendly", "enemyCard", "friendlyCard", "none") allows.</summary>
    public static IReadOnlyList<string> PowerTargets(string target) => target switch
    {
        "enemy" => EnemyTargets,
        "friendly" => FriendlyTargets,
        "enemyCard" or "friendlyCard" => [target],
        _ => [],
    };

    /// <summary>Race passives that work for spells (they never attack or die): Vampiric lifesteal, Lightbringer blessing.</summary>
    public static bool RaceWorksForSpells(int? raceId) => raceId is Races.Vampiric or Races.Lightbringer;

    public static readonly IReadOnlyDictionary<int, RuleText> RaceTexts = new Dictionary<int, RuleText>
    {
        [Races.Darkness] = new("Darkness", $"Death curse: when it dies, deals {DeathCurseDamage} damage to a random enemy."),
        [Races.Vampiric] = new("Vampiric", "Lifesteal: damage it deals heals your hero."),
        [Races.Lightbringer] = new("Lightbringer", $"Blessing: when played, restores {LightbringerBlessing} health to your hero. Its Heal restores {LightbringerHealBonus} more."),
        [Races.Ferocious] = new("Ferocious", "Frenzy: +1 attack when it attacks."),
    };

    /// <summary>A hero power of the class <paramref name="ClassId"/>. Target: see <see cref="PowerTargets"/>.</summary>
    public sealed record HeroPowerText(string Name, string Text, string Target, int ClassId);

    /// <summary>Hero power ids: 1-4 are the classes' first powers (id = class id), 5-8 their second ones.</summary>
    public static class Powers
    {
        public const int RabidBite = 1;
        public const int Drain = 2;
        public const int HolyLight = 3;
        public const int Fade = 4;
        public const int Ravage = 5;
        public const int BloodGift = 6;
        public const int Aegis = 7;
        public const int ThickHide = 8;
    }

    /// <summary>Damage Ravage deals to an enemy card, and what it costs its own hero.</summary>
    public const int RavageDamage = 2;
    public const int RavageSelfDamage = 1;

    /// <summary>Attack and health Blood Gift gives.</summary>
    public const int BloodGiftAttack = 1;
    public const int BloodGiftHealth = 2;

    /// <summary>Armor Thick Hide gives.</summary>
    public const int ThickHideArmor = 1;

    /// <summary>Hero powers by id: two per class; players pick one (the class's first is the default).</summary>
    public static readonly IReadOnlyDictionary<int, HeroPowerText> HeroPowers = new Dictionary<int, HeroPowerText>
    {
        [Powers.RabidBite] = new("Rabid Bite", "Deal 1 damage to an enemy card or hero.", "enemy", 1),
        [Powers.Drain] = new("Drain", "Deal 1 damage to an enemy card or hero and restore 1 health to your hero.", "enemy", 2),
        [Powers.HolyLight] = new("Holy Light", "Restore 2 health to a friendly card or your hero.", "friendly", 3),
        [Powers.Fade] = new("Fade", "Your hero gains 2 armor.", "none", 4),
        [Powers.Ravage] = new("Ravage", $"Deal {RavageDamage} damage to an enemy card. Your hero takes {RavageSelfDamage} damage.", "enemyCard", 1),
        [Powers.BloodGift] = new("Blood Gift", $"A friendly card gains +{BloodGiftAttack} attack and +{BloodGiftHealth} health.", "friendlyCard", 2),
        [Powers.Aegis] = new("Aegis", "A friendly card without a ward gains Ward.", "friendlyCard", 3),
        [Powers.ThickHide] = new("Thick Hide", $"A friendly card gains {ThickHideArmor} armor.", "friendlyCard", 4),
    };

    /// <summary>The hero powers a class can pick from, the default first.</summary>
    public static IReadOnlyList<int> PowersOf(int classId) => [.. HeroPowers.Where(p => p.Value.ClassId == classId).Select(p => p.Key).Order()];

    /// <summary>The power a hero of the class uses: <paramref name="chosen"/> if it is one of the class's, else the default (0: none).</summary>
    public static int PowerOf(int classId, int? chosen) =>
        chosen is { } id && HeroPowers.TryGetValue(id, out var power) && power.ClassId == classId ? id : PowersOf(classId).FirstOrDefault();

    /// <summary>Whether a player of the class may own and play a card of class <paramref name="cardClassId"/> (null: every class).</summary>
    public static bool CanUse(int? cardClassId, int classId) => cardClassId is null || cardClassId == classId;

    /// <summary>What players can say in a game (the Emote request sends the index): greeting, well played, thanks, oops, threaten, sorry.</summary>
    public static readonly IReadOnlyList<string> Emotes = ["Greetings!", "Well played!", "Thanks!", "Oops!", "Your soul is mine!", "Sorry!"];

    public static class Keywords
    {
        public const string Ward = "Ward: the next damage this card would take breaks the ward instead.";
        public const string SummoningSick = "Arrives exhausted: cards cannot attack or act the turn they are played (unless they have Charge).";
        public const string Paralyzed = "Paralyzed: cannot attack or act this turn.";
        public const string Armor = "Armor absorbs damage before health does.";
        public const string Fatigue = "When your deck is empty, each draw deals 1 more damage to your hero than the last.";
        public const string Burned = "Drawing with a full hand (10 cards) burns the drawn card.";
        public const string Spell = "Spell: cast it from your hand (on its target), then it is used up. It never takes a slot on the board.";
    }
}
