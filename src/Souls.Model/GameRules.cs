using Souls.Model.Entities;
using Souls.Model.Localization;

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

    /// <summary>A rule's name and text, in the reader's language (see <see cref="GameText"/>).</summary>
    public sealed record RuleText(GameText Name, GameText Text);

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
    /// An ability. Its name and rules text are <c>ability.{id}.name</c> and <c>ability.{id}.text</c> in the string
    /// tables (<see cref="Strings"/>); <paramref name="HasValue"/> abilities have a number (<c>{n}</c>: Burn 3 deals
    /// 3 damage), and cards without one use <paramref name="DefaultValue"/>.
    /// </summary>
    public sealed record AbilityDefinition(int Id, Timing Timing, int DefaultValue, bool HasValue, IReadOnlyList<string> Targets)
    {
        /// <summary>The English name (the database's ability names).</summary>
        public string Name => AbilityName(Id).ToString();
    }

    private static readonly string[] FriendlyTargets = ["friendlyCard", "ownHero"];
    private static readonly string[] EnemyTargets = ["enemyCard", "enemyHero"];

    public static readonly IReadOnlyDictionary<int, AbilityDefinition> Abilities = new AbilityDefinition[]
    {
        new(Ability.Heal, Timing.Activated, HealAmount, true, FriendlyTargets),
        new(Ability.Sacrifice, Timing.Activated, 0, false, FriendlyTargets),
        new(Ability.Taunt, Timing.Passive, 0, false, []),
        new(Ability.Summon, Timing.OnPlay, 1, true, []),
        new(Ability.Paralyze, Timing.Activated, 0, false, ["enemyCard"]),
        new(Ability.Haunt, Timing.OnDeath, 0, false, []),
        new(Ability.Harden, Timing.Activated, HardenArmor, true, FriendlyTargets),
        new(Ability.Burn, Timing.Activated, BurnDamage, true, EnemyTargets),
        new(Ability.Charge, Timing.Passive, 0, false, []),
        new(Ability.Ward, Timing.Passive, 0, false, []),
        new(Ability.Fury, Timing.Passive, 0, false, []),
        new(Ability.Venom, Timing.Passive, 0, false, []),
        new(Ability.Rally, Timing.OnPlay, 1, true, []),
        new(Ability.Insight, Timing.OnPlay, 1, true, []),
        new(Ability.Inferno, Timing.OnPlay, 1, true, []),
        new(Ability.Regenerate, Timing.TurnStart, 2, true, []),
        new(Ability.Grow, Timing.TurnStart, 1, true, []),
        new(Ability.Drain, Timing.Activated, 2, true, EnemyTargets),
        new(Ability.Brood, Timing.OnDeath, 1, true, []),
        new(Ability.Empower, Timing.Activated, 1, true, ["friendlyCard"]),
    }.ToDictionary(a => a.Id);

    public static GameText AbilityName(int abilityId) => new($"ability.{abilityId}.name");

    /// <summary>The value an ability works with on a card (the card's own, or the ability's default).</summary>
    public static int AbilityValue(int abilityId, int? value) =>
        value ?? (Abilities.TryGetValue(abilityId, out var a) ? a.DefaultValue : 0);

    /// <summary>The ability as printed on the card face: "Burn 3", "Rally +1", "Taunt".</summary>
    public static string AbilityLabel(int abilityId, int? value) => AbilityLabelText(abilityId, value).ToString();

    /// <inheritdoc cref="AbilityLabel"/>
    public static GameText AbilityLabelText(int abilityId, int? value)
    {
        if (!Abilities.TryGetValue(abilityId, out var a))
        {
            return new GameText("?");
        }

        var v = AbilityValue(abilityId, value);
        return abilityId switch
        {
            Ability.Rally or Ability.Grow or Ability.Empower => new GameText("ability.label.plus", ("name", AbilityName(abilityId)), ("n", v)),
            Ability.Summon or Ability.Insight or Ability.Brood when v <= 1 => AbilityName(abilityId),
            _ when a.HasValue => new GameText("ability.label.value", ("name", AbilityName(abilityId)), ("n", v)),
            _ => AbilityName(abilityId),
        };
    }

    /// <summary>The rules text of a card's ability with its numbers filled in (Lightbringer heals restore 2 more).</summary>
    public static string AbilityText(int abilityId, int? value, int? raceId = null) =>
        Abilities.ContainsKey(abilityId) ? AbilityRules(abilityId, value, raceId).ToString() : "";

    /// <inheritdoc cref="AbilityText"/>
    public static GameText AbilityRules(int abilityId, int? value, int? raceId = null)
    {
        var key = $"ability.{abilityId}.text";
        if (!Abilities.TryGetValue(abilityId, out var a) || !a.HasValue)
        {
            return new GameText(key);
        }

        return new GameText(key, ("n", AbilityValue(abilityId, value) + (abilityId == Ability.Heal && raceId == Races.Lightbringer ? LightbringerHealBonus : 0)));
    }

    /// <summary>Generic rules text of every ability (with default values), for tooltips and the rules pages.</summary>
    public static readonly IReadOnlyDictionary<int, RuleText> AbilityTexts =
        Abilities.Values.ToDictionary(a => a.Id, a => new RuleText(AbilityName(a.Id), AbilityRules(a.Id, null)));

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
        level > 1 && Abilities.TryGetValue(abilityId, out var a) && a.HasValue
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
        [Races.Darkness] = new(RaceName(Races.Darkness), new GameText("race.1.text", ("n", DeathCurseDamage))),
        [Races.Vampiric] = new(RaceName(Races.Vampiric), new GameText("race.2.text")),
        [Races.Lightbringer] = new(RaceName(Races.Lightbringer), new GameText("race.3.text", ("n", LightbringerBlessing), ("bonus", LightbringerHealBonus))),
        [Races.Ferocious] = new(RaceName(Races.Ferocious), new GameText("race.4.text")),
    };

    public static GameText RaceName(int raceId) => new($"race.{raceId}.name");

    /// <summary>A hero power of the class <paramref name="ClassId"/>. Target: see <see cref="PowerTargets"/>.</summary>
    public sealed record HeroPowerText(GameText Name, GameText Text, string Target, int ClassId);

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
        [Powers.RabidBite] = Power(Powers.RabidBite, "enemy", 1),
        [Powers.Drain] = Power(Powers.Drain, "enemy", 2),
        [Powers.HolyLight] = Power(Powers.HolyLight, "friendly", 3),
        [Powers.Fade] = Power(Powers.Fade, "none", 4),
        [Powers.Ravage] = Power(Powers.Ravage, "enemyCard", 1, ("damage", RavageDamage), ("self", RavageSelfDamage)),
        [Powers.BloodGift] = Power(Powers.BloodGift, "friendlyCard", 2, ("attack", BloodGiftAttack), ("health", BloodGiftHealth)),
        [Powers.Aegis] = Power(Powers.Aegis, "friendlyCard", 3),
        [Powers.ThickHide] = Power(Powers.ThickHide, "friendlyCard", 4, ("n", ThickHideArmor)),
    };

    private static HeroPowerText Power(int id, string target, int classId, params (string Name, object Value)[] args) =>
        new(new GameText($"power.{id}.name"), new GameText($"power.{id}.text", args), target, classId);

    /// <summary>The hero powers a class can pick from, the default first.</summary>
    public static IReadOnlyList<int> PowersOf(int classId) => [.. HeroPowers.Where(p => p.Value.ClassId == classId).Select(p => p.Key).Order()];

    /// <summary>The power a hero of the class uses: <paramref name="chosen"/> if it is one of the class's, else the default (0: none).</summary>
    public static int PowerOf(int classId, int? chosen) =>
        chosen is { } id && HeroPowers.TryGetValue(id, out var power) && power.ClassId == classId ? id : PowersOf(classId).FirstOrDefault();

    /// <summary>Whether a player of the class may own and play a card of class <paramref name="cardClassId"/> (null: every class).</summary>
    public static bool CanUse(int? cardClassId, int classId) => cardClassId is null || cardClassId == classId;

    /// <summary>What players can say in a game (the Emote request sends the index): greeting, well played, thanks, oops, threaten, sorry.</summary>
    public static readonly IReadOnlyList<GameText> Emotes = [.. Enumerable.Range(0, 6).Select(i => new GameText($"emote.{i}"))];

    /// <summary>Rules explained in tooltips.</summary>
    public static class Keywords
    {
        public static readonly GameText Ward = new("keyword.ward");
        public static readonly GameText SummoningSick = new("keyword.summoningSick");
        public static readonly GameText Paralyzed = new("keyword.paralyzed");
        public static readonly GameText Armor = new("keyword.armor");
        public static readonly GameText Fatigue = new("keyword.fatigue");
        public static readonly GameText Burned = new("keyword.burned");
        public static readonly GameText Spell = new("keyword.spell");
    }
}
