using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>
/// The stat budget cards are designed against: a card of cost <c>n</c> is worth about <c>2n + 1</c> points (one point
/// per attack or health, armor 0.75, abilities as below), plus a little for rarer cards. Simulations
/// (tools/Souls.Sim) then correct what the formula gets wrong; see docs/balance.md.
/// </summary>
public static class CardPower
{
    /// <summary>Points a card of this cost and rarity should be worth.</summary>
    public static double Budget(int cost, int rarity) => 2 * cost + 1 + rarity switch
    {
        Rarity.Rare => 0.5,
        Rarity.Epic => 1,
        Rarity.Legendary => 2,
        _ => 0,
    };

    public static double Budget(Card card) => Budget(card.Cost, card.Rarity);

    /// <summary>Points the card's stats and ability are worth.</summary>
    public static double Value(Card card) =>
        card.Attack + card.Health + 0.75 * card.Armor + AbilityWorth(card.AbilityId, card.AbilityValue, card.Attack, card.Health);

    /// <summary>What an ability adds, depending on its value and (for some) the card's stats.</summary>
    public static double AbilityWorth(int? abilityId, int? value, int attack, int health)
    {
        if (abilityId is not { } id)
        {
            return 0;
        }

        double v = GameRules.AbilityValue(id, value);
        return id switch
        {
            Ability.Heal => v + 0.5,
            Ability.Sacrifice => 0.5,
            Ability.Taunt => 1,
            Ability.Summon or Ability.Brood => 2 * v,
            Ability.Paralyze => 3.5,
            Ability.Haunt => 0.4 * (attack + health) + 0.5,
            Ability.Harden => 0.8 * v,
            Ability.Burn => 1.6 * v,
            Ability.Charge => 0.5 * attack + 0.5,
            Ability.Ward => 2 + 0.3 * attack,
            Ability.Fury => 0.8 * attack,
            Ability.Venom => 2,
            Ability.Rally => 1.5 * v,
            Ability.Insight or Ability.Inferno => 2.5 * v,
            Ability.Regenerate => 1.2 * v,
            Ability.Grow => 3 * v,
            Ability.Drain => 2 * v,
            _ => 0,
        };
    }

    /// <summary>Shop price in soul coins.</summary>
    public static int Price(int rarity) => rarity switch
    {
        Rarity.Rare => 4,
        Rarity.Epic => 6,
        Rarity.Legendary => 10,
        _ => 2,
    };
}
