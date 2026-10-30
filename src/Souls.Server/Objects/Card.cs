using System.Text.Json.Nodes;
using Souls.Model;
using AbilityIds = Souls.Model.Entities.Ability;

namespace Souls.Server.Objects;

/// <summary>A card instance in a game. <see cref="Cid"/> identifies the instance, <see cref="Id"/> the card definition.</summary>
public sealed class Card
{
    private static int _cidCounter;

    public int Id { get; init; }
    public required string Name { get; init; }
    public int Cost { get; init; }
    public int VendorPrice { get; init; }
    public string? Portrait { get; init; }
    public int? AbilityId { get; init; }
    public string? AbilityName { get; init; }
    public string? AbilityParameter { get; init; }

    /// <summary>The card's ability value as given on the card (Burn 3), or <c>null</c> for the ability's default.</summary>
    public int? AbilityValueOverride { get; init; }
    public int Rarity { get; init; } = Model.Rarity.Common;
    public string? Flavor { get; init; }
    public int? RaceId { get; init; }
    public string? RaceName { get; init; }
    public string? RaceCardUrl { get; init; }

    /// <summary>Upgrade level of the owner's copy (1-3).</summary>
    public int Level { get; init; } = 1;

    /// <summary>Stats as printed on the card (including the level bonus); Haunt brings a card back with these.</summary>
    public int BaseAttack { get; init; }
    public int BaseHealth { get; init; }
    public int BaseArmor { get; init; }

    public int Attack { get; set; }
    public int Health { get; set; }
    public int MaxHealth { get; set; }
    public int Armor { get; set; }

    public int Cid { get; set; }

    /// <summary>The board slot the card resides in.</summary>
    public int SlotId { get; set; }

    public bool IsDead { get; set; }

    /// <summary>The card used its action this turn (attack or ability), or arrived this turn without Charge.</summary>
    public bool HasAttacked { get; set; }

    /// <summary>Cannot attack or act until the end of its owner's next turn.</summary>
    public bool Paralyzed { get; set; }

    /// <summary>Already returned to the hand once (Haunt).</summary>
    public bool Haunted { get; set; }

    public bool IsToken { get; init; }

    /// <summary>Has an unbroken ward (Ward ability): the next damage it would take breaks the ward instead.</summary>
    public bool Ward { get; set; }

    /// <summary>Attacks made this turn (Fury cards attack twice).</summary>
    public int AttacksThisTurn { get; set; }

    public bool HasTaunt => AbilityId == AbilityIds.Taunt;
    public bool HasCharge => AbilityId == AbilityIds.Charge;
    public bool HasFury => AbilityId == AbilityIds.Fury;
    public bool HasVenom => AbilityId == AbilityIds.Venom;
    public bool CanAct => !HasAttacked && !Paralyzed && !IsDead;

    /// <summary>The value the ability works with (Burn 3 deals 3 damage).</summary>
    public int AbilityValue => AbilityId is { } id ? GameRules.AbilityValue(id, AbilityValueOverride) : 0;

    public static Card FromEntity(Model.Entities.Card c, int level = 1)
    {
        var bonus = GameRules.LevelBonus(level);
        return new Card
        {
            Id = c.Id,
            Name = c.Name,
            Cost = c.Cost,
            VendorPrice = c.VendorPrice,
            Portrait = c.Portrait,
            AbilityId = c.Ability?.Id ?? c.AbilityId,
            AbilityName = c.Ability?.Name,
            AbilityParameter = c.Ability?.Parameter,
            AbilityValueOverride = c.AbilityValue,
            Rarity = c.Rarity,
            Flavor = c.Flavor,
            RaceId = c.Race?.Id ?? c.RaceId,
            RaceName = c.Race?.Name,
            RaceCardUrl = c.Race?.CardUrl,
            Level = level,
            BaseAttack = c.Attack + bonus,
            BaseHealth = c.Health + bonus,
            BaseArmor = c.Armor,
            Attack = c.Attack + bonus,
            Health = c.Health + bonus,
            MaxHealth = c.Health + bonus,
            Armor = c.Armor,
        };
    }

    /// <summary>The 1/1 token created by Summon.</summary>
    public static Card LostSoul() => new Card
    {
        Id = GameRules.LostSoulId,
        Name = "Lost Soul",
        Cost = 0,
        Portrait = GameRules.LostSoulPortrait,
        Flavor = "A soul that lost its way to the afterlife.",
        BaseAttack = 1,
        BaseHealth = 1,
        Attack = 1,
        Health = 1,
        MaxHealth = 1,
        IsToken = true,
    }.NewInstance();

    /// <summary>Creates a new instance of this card definition with a fresh, unique <see cref="Cid"/> and printed stats.</summary>
    public Card NewInstance()
    {
        var card = (Card)MemberwiseClone();
        card.Cid = Interlocked.Increment(ref _cidCounter);
        card.SlotId = 0;
        card.IsDead = false;
        card.HasAttacked = false;
        card.Paralyzed = false;
        card.Haunted = false;
        card.AttacksThisTurn = 0;
        card.Ward = AbilityId == AbilityIds.Ward;
        card.Attack = BaseAttack;
        card.Health = BaseHealth;
        card.MaxHealth = BaseHealth;
        card.Armor = BaseArmor;
        return card;
    }

    /// <summary>The JSON shape the browser clients expect (property names from the original Json.NET serialization).</summary>
    public JsonObject ToJson() => new()
    {
        ["isDead"] = IsDead,
        ["cid"] = Cid,
        ["slotId"] = SlotId,
        ["hasAttacked"] = HasAttacked,
        ["id"] = Id,
        ["ability"] = AbilityId is not { } abilityId ? null : new JsonObject
        {
            ["id"] = abilityId,
            ["name"] = AbilityName ?? (GameRules.AbilityTexts.TryGetValue(abilityId, out var t) ? t.Name : null),
            ["parameter"] = AbilityParameter,
            ["value"] = AbilityValue,
            ["label"] = GameRules.AbilityLabel(abilityId, AbilityValueOverride),
            ["text"] = GameRules.AbilityText(abilityId, AbilityValueOverride, RaceId),
            ["activated"] = GameRules.IsActivated(abilityId),
        },
        ["race"] = RaceId is null ? null : new JsonObject
        {
            ["id"] = RaceId,
            ["name"] = RaceName,
            ["cardUrl"] = RaceCardUrl,
        },
        ["name"] = Name,
        ["attack"] = Attack,
        ["health"] = Health,
        ["maxHealth"] = MaxHealth,
        ["armor"] = Armor,
        ["cost"] = Cost,
        ["vendor_price"] = VendorPrice,
        ["level"] = Level,
        ["portrait"] = Portrait,
        ["paralyzed"] = Paralyzed,
        ["taunt"] = HasTaunt,
        ["token"] = IsToken,
        ["ward"] = Ward,
        ["rarity"] = Rarity,
        ["flavor"] = Flavor,
    };

    /// <summary>Reads a card sent by the server (used by the bot).</summary>
    public static Card FromJson(JsonNode node) => new()
    {
        Id = (int?)node["id"] ?? 0,
        Name = (string?)node["name"] ?? "?",
        Attack = (int?)node["attack"] ?? 0,
        Health = (int?)node["health"] ?? 0,
        MaxHealth = (int?)node["maxHealth"] ?? (int?)node["health"] ?? 0,
        Armor = (int?)node["armor"] ?? 0,
        Cost = (int?)node["cost"] ?? 0,
        Level = (int?)node["level"] ?? 1,
        AbilityId = (int?)node["ability"]?["id"],
        AbilityName = (string?)node["ability"]?["name"],
        AbilityValueOverride = (int?)node["ability"]?["value"],
        Rarity = (int?)node["rarity"] ?? Model.Rarity.Common,
        Ward = (bool?)node["ward"] ?? false,
        RaceId = (int?)node["race"]?["id"],
        Cid = (int?)node["cid"] ?? 0,
        SlotId = (int?)node["slotId"] ?? 0,
        IsDead = (bool?)node["isDead"] ?? false,
        HasAttacked = (bool?)node["hasAttacked"] ?? false,
        Paralyzed = (bool?)node["paralyzed"] ?? false,
        IsToken = (bool?)node["token"] ?? false,
    };

    public override string ToString() => $"{Cid}, {Name}, {Attack}/{Health}+{Armor}, {AbilityId}, {RaceId}";
}
