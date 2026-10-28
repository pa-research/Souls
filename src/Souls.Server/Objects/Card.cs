using System.Text.Json.Nodes;

namespace Souls.Server.Objects;

/// <summary>A card instance in a game. <see cref="Cid"/> identifies the instance, <see cref="Id"/> the card definition.</summary>
public sealed class Card
{
    private static int _cidCounter;

    public int Id { get; init; }
    public required string Name { get; init; }
    public int Attack { get; set; }
    public int Health { get; set; }
    public int Armor { get; set; }
    public int Cost { get; init; }
    public int VendorPrice { get; init; }
    public int Level { get; init; }
    public string? Portrait { get; init; }
    public int? AbilityId { get; init; }
    public string? AbilityName { get; init; }
    public string? AbilityParameter { get; init; }
    public int? RaceId { get; init; }
    public string? RaceName { get; init; }
    public string? RaceCardUrl { get; init; }

    public int Cid { get; set; }

    /// <summary>The board slot the card resides in.</summary>
    public int SlotId { get; set; }

    public bool IsDead { get; set; }
    public bool HasAttacked { get; set; }

    public static Card FromEntity(Model.Entities.Card c) => new()
    {
        Id = c.Id,
        Name = c.Name,
        Attack = c.Attack,
        Health = c.Health,
        Armor = c.Armor,
        Cost = c.Cost,
        VendorPrice = c.VendorPrice,
        Level = c.Level,
        Portrait = c.Portrait,
        AbilityId = c.Ability?.Id,
        AbilityName = c.Ability?.Name,
        AbilityParameter = c.Ability?.Parameter,
        RaceId = c.Race?.Id,
        RaceName = c.Race?.Name,
        RaceCardUrl = c.Race?.CardUrl,
    };

    /// <summary>Creates a new instance of this card definition with a fresh, unique <see cref="Cid"/>.</summary>
    public Card NewInstance()
    {
        var card = (Card)MemberwiseClone();
        card.Cid = Interlocked.Increment(ref _cidCounter);
        card.SlotId = 0;
        card.IsDead = false;
        card.HasAttacked = false;
        return card;
    }

    /// <summary>A card attacks another card; both take the other's attack as damage.</summary>
    public void AttackCard(Card defender)
    {
        defender.Health -= Attack;
        Health -= defender.Attack;
        if (Health < 1)
        {
            IsDead = true;
        }

        if (defender.Health < 1)
        {
            defender.IsDead = true;
        }

        HasAttacked = true;
    }

    public void AttackHero(GamePlayer defender)
    {
        defender.Health -= Attack;
        Health -= defender.Attack;
        if (Health < 1)
        {
            IsDead = true;
        }

        if (defender.Health < 1)
        {
            defender.IsDead = true;
        }

        HasAttacked = true;
    }

    /// <summary>The JSON shape the browser client expects (property names from the original Json.NET serialization).</summary>
    public JsonObject ToJson() => new()
    {
        ["isDead"] = IsDead,
        ["cid"] = Cid,
        ["slotId"] = SlotId,
        ["hasAttacked"] = HasAttacked,
        ["id"] = Id,
        ["ability"] = AbilityId is null ? null : new JsonObject
        {
            ["id"] = AbilityId,
            ["name"] = AbilityName,
            ["parameter"] = AbilityParameter,
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
        ["armor"] = Armor,
        ["cost"] = Cost,
        ["vendor_price"] = VendorPrice,
        ["level"] = Level,
        ["portrait"] = Portrait,
    };

    /// <summary>Reads a card sent by the server (used by the bot).</summary>
    public static Card FromJson(JsonNode node) => new()
    {
        Id = (int?)node["id"] ?? 0,
        Name = (string?)node["name"] ?? "?",
        Attack = (int?)node["attack"] ?? 0,
        Health = (int?)node["health"] ?? 0,
        Armor = (int?)node["armor"] ?? 0,
        Cost = (int?)node["cost"] ?? 0,
        AbilityId = (int?)node["ability"]?["id"],
        AbilityName = (string?)node["ability"]?["name"],
        RaceId = (int?)node["race"]?["id"],
        Cid = (int?)node["cid"] ?? 0,
        SlotId = (int?)node["slotId"] ?? 0,
        IsDead = (bool?)node["isDead"] ?? false,
        HasAttacked = (bool?)node["hasAttacked"] ?? false,
    };

    public override string ToString() => $"{Cid}, {Name}, {Attack}, {Health}, {Armor}, {AbilityId}, {RaceId}";
}
