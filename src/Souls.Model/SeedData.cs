using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>
/// Reference data seeded by the EF Core migrations. Based on the original 2014 game data and the 2015 database dump,
/// with the broken test rows fixed (negative card stats, too few starter cards).
/// </summary>
public static class SeedData
{
    public static readonly Ability[] Abilities = [.. GameRules.Abilities.Values.OrderBy(a => a.Id).Select(a => new Ability { Id = a.Id, Name = a.Name })];

    public static readonly Race[] Races =
    [
        new() { Id = 1, Name = "Darkness", CardUrl = "/Content/Images/Card/Texture/darkness.png" },
        new() { Id = 2, Name = "Vampiric", CardUrl = "/Content/Images/Card/Texture/vampiric.png" },
        new() { Id = 3, Name = "Lightbringer", CardUrl = "/Content/Images/Card/Texture/lightbringer.png" },
        new() { Id = 4, Name = "Ferocious", CardUrl = "/Content/Images/Card/Texture/ferocious.png" },
    ];

    private const int Darkness = GameRules.Races.Darkness;
    private const int Vampiric = GameRules.Races.Vampiric;
    private const int Lightbringer = GameRules.Races.Lightbringer;
    private const int Ferocious = GameRules.Races.Ferocious;
    private const int C = Rarity.Common;
    private const int R = Rarity.Rare;
    private const int E = Rarity.Epic;
    private const int L = Rarity.Legendary;

    /// <summary>
    /// The card set: the eight cards of the original game (ids 1-7 and 18, with their original art) and the 2026
    /// expansion. Stats follow the budget in <see cref="CardPower"/> and were tuned with bot-versus-bot simulations
    /// (tools/Souls.Sim, docs/balance.md). Starter cards (all common, so five of them fill a deck) can be picked on
    /// registration.
    /// </summary>
    public static readonly Card[] Cards =
    [
        // ---- Darkness: death curse ----------------------------------------------------------------------------------
        Card(20, "Gloom Imp", Darkness, C, cost: 1, attack: 1, health: 2, armor: 0, null, starter: true,
            flavor: "Small, spiteful and always grinning at a funeral."),
        Card(21, "Grave Rat", Darkness, C, cost: 2, attack: 1, health: 2, armor: 0, Ability.Venom,
            flavor: "It has eaten better men than you. Mostly afterwards."),
        Card(22, "Shade", Darkness, C, cost: 2, attack: 2, health: 2, armor: 0, Ability.Burn, value: 1,
            flavor: "What the lantern misses, the Shade remembers."),
        Card(23, "Draugr", Darkness, C, cost: 3, attack: 2, health: 3, armor: 0, Ability.Haunt, starter: true,
            flavor: "Barrow-kings never stay buried for long."),
        Card(24, "Mara", Darkness, R, cost: 3, attack: 2, health: 4, armor: 0, Ability.Paralyze,
            flavor: "She rides the chest of the sleeper until dawn."),
        // Christine's ability as the 2015 database assigned it.
        Card(4, "Christine", Darkness, E, cost: 4, attack: 3, health: 4, armor: 1, Ability.Paralyze, portrait: "/Content/Images/Card/Portraits/4.png",
            flavor: "One look, and you forget how to move."),
        Card(25, "Gravecaller", Darkness, R, cost: 4, attack: 2, health: 5, armor: 0, Ability.Brood, value: 2,
            flavor: "Every grave is a door, if you know how to knock."),
        Card(26, "Bone Colossus", Darkness, C, cost: 5, attack: 4, health: 5, armor: 0, Ability.Taunt, starter: true,
            flavor: "Built from a thousand fallen champions. None of them agreed to it."),
        Card(27, "Pesta", Darkness, E, cost: 6, attack: 4, health: 5, armor: 0, Ability.Inferno, value: 2,
            flavor: "Where she rakes, a few survive. Where she sweeps, nobody does."),
        Card(28, "The Pale Reaper", Darkness, L, cost: 7, attack: 6, health: 6, armor: 0, Ability.Drain, value: 3,
            flavor: "Every soul in the arena is already on his list."),

        // ---- Vampiric: lifesteal ------------------------------------------------------------------------------------
        Card(6, "Bobby", Vampiric, C, cost: 1, attack: 1, health: 3, armor: 0, Ability.Taunt, starter: true, portrait: "/Content/Images/Card/Portraits/6.png",
            flavor: "Bobby holds the line. Bobby has always held the line."),
        Card(30, "Blood Bat", Vampiric, C, cost: 1, attack: 2, health: 1, armor: 0, Ability.Charge,
            flavor: "The first drop is always the sweetest."),
        Card(31, "Blood Thrall", Vampiric, C, cost: 2, attack: 2, health: 3, armor: 0, null, starter: true,
            flavor: "He serves the count. He no longer remembers why."),
        Card(32, "Vampire Bride", Vampiric, R, cost: 3, attack: 3, health: 2, armor: 0, Ability.Fury,
            flavor: "Hers is the last kiss they ever feel twice."),
        Card(33, "Blood Priest", Vampiric, C, cost: 3, attack: 2, health: 3, armor: 0, Ability.Heal, value: 3, starter: true,
            flavor: "Drink, and be whole again."),
        Card(34, "Crimson Duelist", Vampiric, R, cost: 4, attack: 3, health: 3, armor: 0, Ability.Ward,
            flavor: "First blood is a matter of honour. Hers."),
        Card(35, "Blood Ritualist", Vampiric, R, cost: 4, attack: 3, health: 3, armor: 0, Ability.Summon, value: 2,
            flavor: "A circle of salt, a cup of blood, and something answers."),
        Card(36, "Sanguine Knight", Vampiric, C, cost: 5, attack: 4, health: 4, armor: 1, Ability.Regenerate, value: 2,
            flavor: "His wounds close before his enemies can boast of them."),
        Card(37, "Lord Varga", Vampiric, L, cost: 6, attack: 4, health: 5, armor: 0, Ability.Grow, value: 1,
            flavor: "Every night the count grows older. And stronger."),
        Card(38, "Nosferatu", Vampiric, E, cost: 7, attack: 5, health: 5, armor: 0, Ability.Fury,
            flavor: "The plague follows him like a loyal dog."),

        // ---- Lightbringer: blessing ---------------------------------------------------------------------------------
        Card(40, "Acolyte of Dawn", Lightbringer, C, cost: 1, attack: 1, health: 1, armor: 0, Ability.Rally, value: 1, starter: true,
            flavor: "One horn call, and the faithful stand taller."),
        // Card 2 carries its original April 2014 art (Dr. Robotnik) and the 2014 ability.
        Card(2, "Dr. Robotnik", Lightbringer, L, cost: 2, attack: 2, health: 2, armor: 1, Ability.Sacrifice, portrait: "/Content/Images/Card/Portraits/2.png",
            flavor: "Every great plan needs a volunteer."),
        Card(41, "Shieldmaiden", Lightbringer, C, cost: 2, attack: 2, health: 2, armor: 0, Ability.Taunt, starter: true,
            flavor: "Behind her shield, the line does not break."),
        Card(42, "Lantern Bearer", Lightbringer, C, cost: 2, attack: 1, health: 1, armor: 0, Ability.Insight, value: 1,
            flavor: "Follow the lantern and you find what you were looking for."),
        Card(43, "Templar", Lightbringer, C, cost: 3, attack: 2, health: 3, armor: 0, Ability.Ward, starter: true,
            flavor: "Faith is the first shield. Steel is the second."),
        Card(44, "Sun Cleric", Lightbringer, R, cost: 3, attack: 2, health: 3, armor: 0, Ability.Heal, value: 3,
            flavor: "The sun asks nothing in return. The cleric does."),
        // "Spirit wolf coming to Souls" (news banner, May 2014): card 18 of the live database.
        Card(18, "Spirit Wolf", Lightbringer, L, cost: 4, attack: 4, health: 4, armor: 0, Ability.Charge, portrait: "/Content/Images/Card/Portraits/18.png",
            flavor: "Promised in 2014. Worth the wait."),
        Card(45, "Valkyrie", Lightbringer, E, cost: 5, attack: 4, health: 5, armor: 0, Ability.Fury,
            flavor: "She chooses who falls. Today she chose your army."),
        Card(46, "Bastion Guardian", Lightbringer, R, cost: 6, attack: 4, health: 6, armor: 2, Ability.Harden, value: 3,
            flavor: "Mountains move before the Bastion does."),
        Card(47, "Archangel", Lightbringer, L, cost: 8, attack: 5, health: 5, armor: 1, Ability.Inferno, value: 2,
            flavor: "Judgement comes on burning wings."),

        // ---- Ferocious: frenzy --------------------------------------------------------------------------------------
        Card(50, "Wolf Pup", Ferocious, C, cost: 1, attack: 1, health: 2, armor: 0, Ability.Charge, starter: true,
            flavor: "Small teeth, big ambitions."),
        Card(51, "Raging Boar", Ferocious, C, cost: 2, attack: 3, health: 3, armor: 0, null, starter: true,
            flavor: "It does not stop. It does not turn. It does not care."),
        Card(52, "Huldra", Ferocious, R, cost: 3, attack: 2, health: 3, armor: 0, Ability.Venom,
            flavor: "Lovely from the front. Never look behind her."),
        // Per's ability as the 2015 database assigned it.
        Card(3, "Per", Ferocious, R, cost: 4, attack: 4, health: 4, armor: 1, Ability.Summon, value: 1, portrait: "/Content/Images/Card/Portraits/3.png",
            flavor: "Per never fights alone."),
        Card(53, "Forest Troll", Ferocious, C, cost: 4, attack: 4, health: 5, armor: 0, Ability.Regenerate, value: 2,
            flavor: "Cut it down and it grows back meaner."),
        // "Huy" in the 2014 game data; the 2015 dump renamed it "Anette" (with test stats), restored here.
        Card(5, "Huy", Ferocious, C, cost: 5, attack: 4, health: 6, armor: 1, Ability.Heal, value: 2, starter: true, portrait: "/Content/Images/Card/Portraits/5.png",
            flavor: "Big hands, gentle heart."),
        // Anette (the 2015 card 5) as a card of her own: almost no attack or health, a wall of armor, Haunt.
        Card(7, "Anette", Ferocious, E, cost: 5, attack: 3, health: 2, armor: 8, Ability.Haunt, portrait: "/Content/Images/Card/Portraits/16.jpg",
            flavor: "Death is only a short break for Anette."),
        Card(54, "Troll Chieftain", Ferocious, R, cost: 5, attack: 4, health: 6, armor: 1, Ability.Rally, value: 1,
            flavor: "When the chieftain roars, the whole mountain answers."),
        // Card 1 carries its original April 2014 art (a wolf) and the name of the early test card, "Snokulv".
        Card(1, "Snokulv", Ferocious, R, cost: 6, attack: 6, health: 7, armor: 1, Ability.Heal, value: 2, portrait: "/Content/Images/Card/Portraits/1.png",
            flavor: "The snow wolf of the north: the first card ever drawn in Souls."),
        Card(55, "Frost Jotun", Ferocious, E, cost: 8, attack: 7, health: 7, armor: 1, Ability.Taunt,
            flavor: "Older than the mountains, and twice as patient."),
        Card(56, "Fenrir", Ferocious, L, cost: 9, attack: 7, health: 8, armor: 0, Ability.Fury,
            flavor: "No chain forged by gods or men holds him for long."),

        // ---- Spells: cast from the hand, they never take a board slot. Lightbringer spells bless their hero and
        // Vampiric spells heal it by the damage they deal, like the cards of their race. ---------------------------
        Spell(60, "Soul Rend", Darkness, C, cost: 4, Ability.Burn, value: 4,
            flavor: "It does not cut the flesh. It cuts what lives inside."),
        Spell(61, "Death Grip", Darkness, R, cost: 3, Ability.Drain, value: 2,
            flavor: "Cold fingers close, and something warm flows the other way."),
        Spell(62, "Plague Wind", Darkness, E, cost: 2, Ability.Inferno, value: 2,
            flavor: "It blows from the barrows, and the fields go quiet behind it."),
        Spell(63, "Blood Lance", Vampiric, C, cost: 2, Ability.Burn, value: 3,
            flavor: "Forged from a single drop, and thirsty for the rest."),
        Spell(64, "Blood Pact", Vampiric, R, cost: 3, Ability.Empower, value: 2,
            flavor: "Drink deep, and rise stronger than you fell."),
        Spell(65, "Blood Moon", Vampiric, E, cost: 2, Ability.Inferno, value: 2,
            flavor: "When the moon turns red, every wound bleeds for the count."),
        Spell(66, "Sacred Shield", Lightbringer, C, cost: 1, Ability.Harden, value: 8,
            flavor: "The light does not ask whether you deserve it."),
        Spell(67, "Revelation", Lightbringer, R, cost: 2, Ability.Insight, value: 3,
            flavor: "For one blinding moment, every path is clear."),
        Spell(68, "Troll Blood", Ferocious, C, cost: 2, Ability.Heal, value: 4,
            flavor: "Troll blood closes any wound. The taste is another matter."),
        Spell(69, "Frostbite", Ferocious, R, cost: 0, Ability.Paralyze,
            flavor: "The cold of the high passes does not kill. It waits."),

        // ---- Class cards: only heroes of their class can own and play them (two per class, of the class's race). ---
        Card(70, "Rabid Ghoul", Darkness, C, cost: 2, attack: 3, health: 1, armor: 0, Ability.Charge, classId: RabidSoul,
            flavor: "It smelled the battle three graveyards away."),
        Card(71, "Night Terror", Darkness, R, cost: 4, attack: 4, health: 3, armor: 0, Ability.Fury, classId: RabidSoul,
            flavor: "It strikes twice: once in the dark, once in your dreams."),
        Card(72, "Night Stalker", Vampiric, C, cost: 3, attack: 2, health: 3, armor: 0, Ability.Paralyze, classId: Lurker,
            flavor: "You never see the Lurker's hunters. You only stop moving."),
        Spell(73, "Crimson Feast", Vampiric, R, cost: 3, Ability.Drain, value: 2, classId: Lurker,
            flavor: "The Lurker drinks twice: once from the wound, once from the fear."),
        Spell(74, "Sunlance", Lightbringer, C, cost: 2, Ability.Burn, value: 2, classId: Harrison,
            flavor: "Harrison throws it like he swings his sword: straight and without mercy."),
        Card(75, "Dawn Paladin", Lightbringer, E, cost: 5, attack: 4, health: 5, armor: 0, Ability.Drain, value: 2, classId: Harrison,
            flavor: "Every blow he lands closes one of Harrison's wounds."),
        Card(76, "Phantom Wolf", Ferocious, C, cost: 3, attack: 3, health: 2, armor: 0, Ability.Haunt, classId: Fader,
            flavor: "Kill it and it fades. Turn around and it is back."),
        Card(77, "Ironhide Bear", Ferocious, R, cost: 4, attack: 3, health: 5, armor: 0, Ability.Harden, value: 3, classId: Fader,
            flavor: "Fader's bears sleep in armor. They wake up in more."),
    ];

    private const int RabidSoul = 1;
    private const int Lurker = 2;
    private const int Harrison = 3;
    private const int Fader = 4;

    /// <summary>
    /// Hero classes. Their identities come from the 2015 database (Harrison hits hard but is frail, Fader hides behind
    /// armor and gets the most mana); the numbers were tuned with tools/Souls.Sim until every class wins 47-53% of
    /// bot-versus-bot games.
    /// </summary>
    public static readonly PlayerType[] PlayerTypes =
    [
        new() { Id = 1, Name = "Rabid Soul", Attack = 3, Armor = 0, Health = 33, Mana = 0, AbilityId = Ability.Heal, RaceId = 1 },
        new() { Id = 2, Name = "Lurker", Attack = 2, Armor = 2, Health = 33, Mana = 1, AbilityId = Ability.Sacrifice, RaceId = 2 },
        new() { Id = 3, Name = "Harrison", Attack = 5, Armor = 0, Health = 22, Mana = 0, AbilityId = Ability.Heal, RaceId = 3 },
        new() { Id = 4, Name = "Fader", Attack = 1, Armor = 6, Health = 44, Mana = 2, AbilityId = Ability.Sacrifice, RaceId = 4 },
    ];

    public static readonly PlayerPermission[] PlayerPermissions =
    [
        new() { Id = PlayerPermission.Admin, Name = "Admin" },
        new() { Id = PlayerPermission.Player, Name = "Player" },
    ];

    public static readonly GameLogType[] GameLogTypes =
    [
        LogType(GameLogKind.Won, "Player Won", "{0} wins against {1}"),
        LogType(GameLogKind.Defeat, "Player defeat", "{0} loses against {1}"),
        LogType(GameLogKind.Draw, "Draw between players", "{0} plays a draw against {1}"),
        LogType(GameLogKind.CardAttackPlayer, "A card attacks a player (opponent)", "{0} attacks {1} for {2} damage."),
        LogType(GameLogKind.CardAttackCard, "A card attacks a card", "{0} attacks {1} for {2} damage."),
        LogType(GameLogKind.PlayerAttackPlayer, "A player attack the opponent", "{0} attacks {1} for {2} damage."),
        LogType(GameLogKind.PlayerAttackCard, "A player attack a card", "{0} attacks {1} for {2} damage."),
        LogType(GameLogKind.GameCreated, "A game was created where X player begins", "The battle begins, {0} starts the game against {1}"),
        LogType(GameLogKind.UseCard, "A player uses a card", "{0} uses {1}"),
        LogType(GameLogKind.NextTurn, "a player initiates next turn", "{0} gives turn to {1}"),
        LogType(GameLogKind.NewCard, "a player draws a new card", "{0} draws a card. The card was {1}"),
        LogType(GameLogKind.Kicked, "a player is kicked", "{0} was kicked from the game by [ADMIN]"),
        LogType(GameLogKind.AbilityHeal, "A card heals X", "{0} heals {1} for {2} hp"),
        LogType(GameLogKind.AbilitySacrifice, "A card sacrifices itself to X", "{0} sacrifices itself, strengthening {1} for {2}."),
        LogType(GameLogKind.AbilityParalyze, "A card paralyzes X", "{0} paralyzes {1}"),
        LogType(GameLogKind.AbilityHarden, "A card gives X armor", "{0} hardens {1}"),
        LogType(GameLogKind.AbilityBurn, "A card burns X", "{0} burns {1}"),
        LogType(GameLogKind.HeroPower, "A player uses the hero power", "{0} uses the hero power"),
        LogType(GameLogKind.Fatigue, "A player takes fatigue damage", "{0} takes fatigue damage"),
        LogType(GameLogKind.TurnTimedOut, "A player ran out of time", "{0} ran out of time"),
        LogType(GameLogKind.Summon, "A card summons a token", "{0} summons a Lost Soul"),
        LogType(GameLogKind.Haunt, "A card returns to the hand", "{0} returns to the hand"),
        LogType(GameLogKind.CardBurned, "A drawn card burns (hand full)", "{0} burns a card, the hand is full"),
        LogType(GameLogKind.DeathCurse, "A Darkness card curses X", "{0} curses {1}"),
        LogType(GameLogKind.AbilityTriggered, "A card ability triggers on its own", "{0}: {1}"),
        LogType(GameLogKind.AbilityDrain, "A card drains X", "{0} drains {1}"),
    ];

    public static readonly BotName[] BotNames =
    [
        new() { Id = 1, Name = "Hansel" },
        new() { Id = 2, Name = "Satan" },
        new() { Id = 3, Name = "Death" },
    ];

    /// <summary>Name of the system account the practice bot plays as.</summary>
    public const string BotPlayerName = "BOT";

    private static Card Card(int id, string name, int race, int rarity, int cost, int attack, int health, int armor, int? ability, int? value = null,
        bool starter = false, string? portrait = null, string? flavor = null, int? classId = null) => new()
    {
        Id = id,
        Name = name,
        ClassId = classId,
        Attack = attack,
        Health = health,
        Armor = armor,
        Cost = cost,
        AbilityId = ability,
        AbilityValue = value,
        RaceId = race,
        Rarity = rarity,
        Level = starter ? 1 : 2,
        VendorPrice = CardPower.Price(rarity),
        Portrait = portrait ?? $"/Content/Images/Card/Portraits/{id}.jpg",
        Flavor = flavor,
    };

    private static Card Spell(int id, string name, int race, int rarity, int cost, int ability, int? value = null, string? flavor = null, int? classId = null)
    {
        var card = Card(id, name, race, rarity, cost, attack: 0, health: 0, armor: 0, ability, value, flavor: flavor, classId: classId);
        card.Kind = CardKind.Spell;
        return card;
    }

    private static GameLogType LogType(GameLogKind kind, string description, string text) => new()
    {
        Id = (int)kind,
        Title = GameLogKinds.Title(kind),
        Description = description,
        Text = text,
    };
}
