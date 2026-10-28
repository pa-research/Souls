using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>
/// Reference data seeded by the EF Core migrations. Based on the original 2015 database dump, with the
/// broken test rows fixed (negative card stats, too few starter cards, abilities that did not match the engine).
/// </summary>
public static class SeedData
{
    public static readonly Ability[] Abilities =
    [
        new() { Id = Ability.Heal, Name = "Heal" },
        new() { Id = Ability.Sacrifice, Name = "Sacrifice" },
    ];

    public static readonly Race[] Races =
    [
        new() { Id = 1, Name = "Darkness", CardUrl = "/Content/Images/Card/Texture/darkness.png" },
        new() { Id = 2, Name = "Vampiric", CardUrl = "/Content/Images/Card/Texture/vampiric.png" },
        new() { Id = 3, Name = "Lightbringer", CardUrl = "/Content/Images/Card/Texture/lightbringer.png" },
        new() { Id = 4, Name = "Ferocious", CardUrl = "/Content/Images/Card/Texture/ferocious.png" },
    ];

    public static readonly Card[] Cards =
    [
        Card(1, "Rhino", attack: 5, health: 7, armor: 3, cost: 6, Ability.Heal, race: 4, level: 1, price: 1),
        Card(2, "Zebra", attack: 1, health: 1, armor: 1, cost: 2, Ability.Sacrifice, race: 3, level: 1, price: 1),
        Card(3, "Per", attack: 6, health: 4, armor: 1, cost: 4, Ability.Sacrifice, race: 4, level: 1, price: 1),
        Card(4, "Christine", attack: 5, health: 5, armor: 2, cost: 4, Ability.Heal, race: 1, level: 2, price: 3),
        Card(5, "Anette", attack: 3, health: 6, armor: 2, cost: 5, Ability.Heal, race: 4, level: 1, price: 1),
        Card(6, "Bobby", attack: 2, health: 3, armor: 1, cost: 1, Ability.Sacrifice, race: 2, level: 1, price: 1),
    ];

    public static readonly PlayerType[] PlayerTypes =
    [
        new() { Id = 1, Name = "Rabid Soul", Attack = 5, Armor = 2, Health = 20, Mana = 0, AbilityId = Ability.Heal, RaceId = 1 },
        new() { Id = 2, Name = "Lurker", Attack = 2, Armor = 4, Health = 35, Mana = 1, AbilityId = Ability.Sacrifice, RaceId = 2 },
        new() { Id = 3, Name = "Harrison", Attack = 10, Armor = 0, Health = 10, Mana = 0, AbilityId = Ability.Heal, RaceId = 3 },
        new() { Id = 4, Name = "Fader", Attack = 1, Armor = 15, Health = 20, Mana = 2, AbilityId = Ability.Sacrifice, RaceId = 4 },
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
    ];

    public static readonly BotName[] BotNames =
    [
        new() { Id = 1, Name = "Hansel" },
        new() { Id = 2, Name = "Satan" },
        new() { Id = 3, Name = "Death" },
    ];

    /// <summary>Name of the system account the practice bot plays as.</summary>
    public const string BotPlayerName = "BOT";

    private static Card Card(int id, string name, int attack, int health, int armor, int cost, int ability, int race, int level, int price) => new()
    {
        Id = id,
        Name = name,
        Attack = attack,
        Health = health,
        Armor = armor,
        Cost = cost,
        AbilityId = ability,
        RaceId = race,
        Level = level,
        VendorPrice = price,
        Portrait = $"/Content/Images/Card/Portraits/{id}.png",
    };

    private static GameLogType LogType(GameLogKind kind, string description, string text) => new()
    {
        Id = (int)kind,
        Title = GameLogKinds.Title(kind),
        Description = description,
        Text = text,
    };
}
