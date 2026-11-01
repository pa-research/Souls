using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Model.Localization;
using AbilityIds = Souls.Model.Entities.Ability;
using CardKind = Souls.Model.Entities.CardKind;

namespace Souls.Server.Objects;

/// <summary>A card instance in a game. <see cref="Cid"/> identifies the instance, <see cref="Id"/> the card definition.</summary>
public sealed class Card
{
    private static int _cidCounter;

    /// <summary>
    /// What is printed on the card (name, cost, ability, race, base stats): shared by every copy of an instance and
    /// set only while the card is made, so a copy of the game (<see cref="Copy"/>) clones only the state below.
    /// </summary>
    private CardDefinition _definition = CardDefinition.Blank;

    public int Id { get => _definition.Id; init => _definition = _definition with { Id = value }; }
    public required string Name { get => _definition.Name; init => _definition = _definition with { Name = value }; }
    public int Cost { get => _definition.Cost; init => _definition = _definition with { Cost = value }; }
    public int VendorPrice { get => _definition.VendorPrice; init => _definition = _definition with { VendorPrice = value }; }
    public string? Portrait { get => _definition.Portrait; init => _definition = _definition with { Portrait = value }; }
    public int? AbilityId { get => _definition.AbilityId; init => _definition = _definition with { AbilityId = value }; }
    public string? AbilityName { get => _definition.AbilityName; init => _definition = _definition with { AbilityName = value }; }
    public string? AbilityParameter { get => _definition.AbilityParameter; init => _definition = _definition with { AbilityParameter = value }; }

    /// <summary>The card's ability value as given on the card (Burn 3), or <c>null</c> for the ability's default.</summary>
    public int? AbilityValueOverride { get => _definition.AbilityValueOverride; init => _definition = _definition with { AbilityValueOverride = value }; }
    public int Rarity { get => _definition.Rarity; init => _definition = _definition with { Rarity = value }; }
    public string? Flavor { get => _definition.Flavor; init => _definition = _definition with { Flavor = value }; }
    public CardKind Kind { get => _definition.Kind; init => _definition = _definition with { Kind = value }; }
    public int? RaceId { get => _definition.RaceId; init => _definition = _definition with { RaceId = value }; }
    public string? RaceName { get => _definition.RaceName; init => _definition = _definition with { RaceName = value }; }
    public string? RaceCardUrl { get => _definition.RaceCardUrl; init => _definition = _definition with { RaceCardUrl = value }; }

    /// <summary>Upgrade level of the owner's copy (1-3).</summary>
    public int Level { get => _definition.Level; init => _definition = _definition with { Level = value }; }

    /// <summary>Stats as printed on the card (including the level bonus); Haunt brings a card back with these.</summary>
    public int BaseAttack { get => _definition.BaseAttack; init => _definition = _definition with { BaseAttack = value }; }
    public int BaseHealth { get => _definition.BaseHealth; init => _definition = _definition with { BaseHealth = value }; }
    public int BaseArmor { get => _definition.BaseArmor; init => _definition = _definition with { BaseArmor = value }; }

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

    public bool IsToken { get => _definition.IsToken; init => _definition = _definition with { IsToken = value }; }

    /// <summary>Has an unbroken ward (Ward ability): the next damage it would take breaks the ward instead.</summary>
    public bool Ward { get; set; }

    /// <summary>Attacks made this turn (Fury cards attack twice).</summary>
    public int AttacksThisTurn { get; set; }

    public bool HasTaunt => AbilityId == AbilityIds.Taunt;
    public bool HasCharge => AbilityId == AbilityIds.Charge;
    public bool HasFury => AbilityId == AbilityIds.Fury;
    public bool HasVenom => AbilityId == AbilityIds.Venom;
    public bool IsSpell => Kind == CardKind.Spell;
    public bool CanAct => !HasAttacked && !Paralyzed && !IsDead;

    /// <summary>The value the ability works with (Burn 3 deals 3 damage).</summary>
    public int AbilityValue => AbilityId is { } id ? GameRules.AbilityValue(id, AbilityValueOverride) : 0;

    /// <summary>A card of the player's collection at its upgrade level (cards gain attack and health, spells value).</summary>
    public static Card FromEntity(Model.Entities.Card c, int level = 1)
    {
        var spell = c.Kind == CardKind.Spell;
        var bonus = spell ? 0 : GameRules.LevelBonus(level);
        var abilityId = c.Ability?.Id ?? c.AbilityId;
        return new Card
        {
            Id = c.Id,
            Name = c.Name,
            Cost = c.Cost,
            VendorPrice = c.VendorPrice,
            Portrait = c.Portrait,
            AbilityId = abilityId,
            AbilityName = c.Ability?.Name,
            AbilityParameter = c.Ability?.Parameter,
            AbilityValueOverride = spell && abilityId is { } id ? GameRules.SpellValue(id, c.AbilityValue, level) : c.AbilityValue,
            Rarity = c.Rarity,
            Flavor = c.Flavor,
            Kind = c.Kind,
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
    public static Card LostSoul() => LostSoulCard.NewInstance();

    private static readonly Card LostSoulCard = new()
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
    };

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

    /// <summary>New instances get cids above <paramref name="cid"/> (the cards of a restored game keep theirs).</summary>
    public static void ReserveCids(int cid)
    {
        int seen;
        while ((seen = Volatile.Read(ref _cidCounter)) < cid && Interlocked.CompareExchange(ref _cidCounter, cid, seen) != seen)
        {
        }
    }

    /// <summary>The same instance (same <see cref="Cid"/>) as a separate object, for a copy of the game.</summary>
    public Card Copy() => (Card)MemberwiseClone();

    /// <summary>Like <see cref="Copy"/>, into an existing object (a reused copy's card); returns it.</summary>
    public Card CopyTo(Card target)
    {
        target._definition = _definition;
        target.Attack = Attack;
        target.Health = Health;
        target.MaxHealth = MaxHealth;
        target.Armor = Armor;
        target.Cid = Cid;
        target.SlotId = SlotId;
        target.IsDead = IsDead;
        target.HasAttacked = HasAttacked;
        target.Paralyzed = Paralyzed;
        target.Haunted = Haunted;
        target.Ward = Ward;
        target.AttacksThisTurn = AttacksThisTurn;
        return target;
    }

    /// <summary>
    /// The JSON shape the browser clients expect (property names from the original Json.NET serialization). The texts
    /// (ability name, label and rules, race name, flavor) carry their keys for the clients' languages (see
    /// <see cref="GameText.WriteTo"/>); flavor keys of database cards are only in the tables of other languages.
    /// </summary>
    public JsonObject ToJson() => new()
    {
        ["isDead"] = IsDead,
        ["cid"] = Cid,
        ["slotId"] = SlotId,
        ["hasAttacked"] = HasAttacked,
        ["id"] = Id,
        // Both depend only on what is printed on the card: made once per definition (their texts take formatting),
        // a copy for each message.
        ["ability"] = AbilityId is null ? null : AbilityJsons.GetValue(_definition, AbilityJson).DeepClone(),
        ["race"] = RaceId is null ? null : RaceJsons.GetValue(_definition, RaceJson).DeepClone(),
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
        ["flavorKey"] = Flavor is null ? null : $"flavor.{Id}",
        ["kind"] = IsSpell ? "spell" : "minion",
    };

    private static readonly ConditionalWeakTable<CardDefinition, JsonObject> AbilityJsons = new();
    private static readonly ConditionalWeakTable<CardDefinition, JsonObject> RaceJsons = new();

    private static JsonObject AbilityJson(CardDefinition card)
    {
        var abilityId = card.AbilityId!.Value;
        var json = new JsonObject { ["id"] = abilityId };
        GameRules.AbilityName(abilityId).WriteTo(json, "name");
        if (card.AbilityName is not null && card.AbilityName != (string?)json["name"])
        {
            // An ability the database names differently: its name as it is, in every language.
            json["name"] = card.AbilityName;
            json.Remove("nameKey");
        }

        json["parameter"] = card.AbilityParameter;
        json["value"] = GameRules.AbilityValue(abilityId, card.AbilityValueOverride);
        GameRules.AbilityLabelText(abilityId, card.AbilityValueOverride).WriteTo(json, "label");
        GameRules.AbilityRules(abilityId, card.AbilityValueOverride, card.RaceId).WriteTo(json, "text");
        json["activated"] = GameRules.IsActivated(abilityId);
        return json;
    }

    private static JsonObject RaceJson(CardDefinition card)
    {
        var raceId = card.RaceId!.Value;
        var json = new JsonObject { ["id"] = raceId };
        GameRules.RaceName(raceId).WriteTo(json, "name");
        if (card.RaceName is not null && card.RaceName != (string?)json["name"])
        {
            json["name"] = card.RaceName;
            json.Remove("nameKey");
        }

        json["cardUrl"] = card.RaceCardUrl;
        return json;
    }

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
        Kind = (string?)node["kind"] == "spell" ? CardKind.Spell : CardKind.Minion,
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

/// <summary>The printed side of a <see cref="Card"/> (see its properties).</summary>
internal sealed record CardDefinition
{
    public static readonly CardDefinition Blank = new();

    public int Id { get; init; }
    public string Name { get; init; } = "";
    public int Cost { get; init; }
    public int VendorPrice { get; init; }
    public string? Portrait { get; init; }
    public int? AbilityId { get; init; }
    public string? AbilityName { get; init; }
    public string? AbilityParameter { get; init; }
    public int? AbilityValueOverride { get; init; }
    public int Rarity { get; init; } = Model.Rarity.Common;
    public string? Flavor { get; init; }
    public CardKind Kind { get; init; }
    public int? RaceId { get; init; }
    public string? RaceName { get; init; }
    public string? RaceCardUrl { get; init; }
    public int Level { get; init; } = 1;
    public int BaseAttack { get; init; }
    public int BaseHealth { get; init; }
    public int BaseArmor { get; init; }
    public bool IsToken { get; init; }
}
