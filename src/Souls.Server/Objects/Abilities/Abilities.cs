using System.Globalization;
using System.Text.Json.Nodes;
using Souls.Model.Entities;
using Souls.Server.Network;

namespace Souls.Server.Objects.Abilities;

/// <summary>Card abilities. <c>type</c> values are what the browser client expects for each ability.</summary>
public static class AbilityEffects
{
    /// <summary>Heals a friendly card for 2 + rank.</summary>
    public static void Heal(Player p, Card src, Card target)
    {
        src.HasAttacked = true;
        target.Health += 2 + p.Rank;
        Broadcast(p, Ability.Heal, type: 0, src.Cid, target.Cid, target.Health);
        p.GPlayer!.GameRoom!.Logger.Add(GameLogKind.AbilityHeal, src.Id, target.Id, "Card", "Card");
    }

    /// <summary>Heals the own hero for 2 + rank.</summary>
    public static void Heal(Player p, Card src, Player target)
    {
        src.HasAttacked = true;
        target.GPlayer!.Health += 2 + p.Rank;
        Broadcast(p, Ability.Heal, type: 1, src.Cid, target.Id, target.GPlayer.Health);
        p.GPlayer!.GameRoom!.Logger.Add(GameLogKind.AbilityHeal, src.Id, target.Id, "Card", "Player");
    }

    /// <summary>Kills the card and gives its stats to another friendly card.</summary>
    public static void Sacrifice(Player p, Card src, Card target)
    {
        src.IsDead = true;
        p.GPlayer!.RemoveBoardCard(src);
        target.Health += src.Health;
        target.Attack += src.Attack;
        target.Armor += src.Armor;
        Broadcast(p, Ability.Sacrifice, type: 1, src.Cid, target.Cid, string.Create(CultureInfo.InvariantCulture, $"{target.Health}:{target.Attack}:{target.Armor}"));
        p.GPlayer.GameRoom!.Logger.Add(GameLogKind.AbilitySacrifice, src.Id, target.Id, "Card", "Card");
    }

    /// <summary>Kills the card and gives its stats to the own hero.</summary>
    public static void Sacrifice(Player p, Card src, Player target)
    {
        src.IsDead = true;
        p.GPlayer!.RemoveBoardCard(src);
        target.GPlayer!.Health += src.Health;
        target.GPlayer.Attack += src.Attack;
        Broadcast(p, Ability.Sacrifice, type: 2, src.Cid, target.Id, string.Create(CultureInfo.InvariantCulture, $"{target.GPlayer.Health}:{target.GPlayer.Attack}"));
        p.GPlayer.GameRoom!.Logger.Add(GameLogKind.AbilitySacrifice, src.Id, target.Id, "Card", "Player");
    }

    private static void Broadcast(Player p, int abilityId, int type, int source, int target, JsonNode parameter)
    {
        JsonObject Payload(bool wasOpponent) => new()
        {
            ["abilityId"] = abilityId,
            ["type"] = type,
            ["wasOpponent"] = wasOpponent,
            ["source"] = source,
            ["target"] = target,
            ["parameter"] = parameter.DeepClone(),
        };

        p.Send(new Response(GameResponse.GameUseAbility, Payload(false)));
        p.GetOpponent()?.Send(new Response(GameResponse.GameUseAbility, Payload(true)));
    }
}
