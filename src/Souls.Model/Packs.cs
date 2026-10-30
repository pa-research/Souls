using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>
/// Card packs in the shop: five random cards, the last one rare or better. A card the player already owns levels up
/// instead, like an upgrade; a duplicate of a card at the highest level pays back half its shop price.
/// </summary>
public static class Packs
{
    /// <summary>Price in soul coins, below what the cards of a pack cost on average (<see cref="ExpectedValue"/>).</summary>
    public const int Price = 12;

    private static readonly Dictionary<int, int> AnyCard = new() { [Rarity.Common] = 70, [Rarity.Rare] = 20, [Rarity.Epic] = 7, [Rarity.Legendary] = 3 };
    private static readonly Dictionary<int, int> RareOrBetter = new() { [Rarity.Rare] = 75, [Rarity.Epic] = 18, [Rarity.Legendary] = 7 };

    /// <summary>Drop rates in percent by rarity, for each card of a pack in order.</summary>
    public static readonly IReadOnlyList<IReadOnlyDictionary<int, int>> DropRates = [AnyCard, AnyCard, AnyCard, AnyCard, RareOrBetter];

    /// <summary>What the cards of a pack cost in the shop on average.</summary>
    public static double ExpectedValue => DropRates.Sum(rates => rates.Sum(r => r.Value * CardPower.Price(r.Key)) / 100.0);

    /// <summary>Coins paid for a duplicate of a card that is already at the highest level.</summary>
    public static int Refund(int vendorPrice) => vendorPrice / 2;

    /// <summary>Rolls a pack: for each card a rarity by its drop rate, then any card of that rarity.</summary>
    public static List<Card> Open(IReadOnlyList<Card> pool, Random random) => [.. DropRates.Select(rates =>
    {
        // Rarities without cards (the card editor can change rarities) drop out of the roll.
        var open = rates.Where(r => pool.Any(c => c.Rarity == r.Key)).ToList();
        var roll = random.Next(open.Sum(r => r.Value));
        var rarity = open[^1].Key;
        foreach (var (key, weight) in open)
        {
            if (roll < weight)
            {
                rarity = key;
                break;
            }

            roll -= weight;
        }

        var cards = pool.Where(c => c.Rarity == rarity).ToList();
        return cards[random.Next(cards.Count)];
    })];
}
