using Souls.Model;

namespace Souls.Tests.Unit;

public class PackTests
{
    [Fact]
    public void PacksHoldARareOrBetterAndCostLessThanTheirCards()
    {
        Assert.All(Packs.DropRates, rates => Assert.Equal(100, rates.Values.Sum()));
        Assert.DoesNotContain(Rarity.Common, Packs.DropRates[^1].Keys);
        Assert.True(Packs.ExpectedValue > Packs.Price, $"A pack's cards are worth {Packs.ExpectedValue:0.##} coins for a price of {Packs.Price}");

        // Even with every card at the highest level, the duplicates pay back less than the pack costs.
        var refunds = Packs.DropRates.Sum(rates => rates.Sum(r => r.Value * Packs.Refund(CardPower.Price(r.Key))) / 100.0);
        Assert.True(refunds < Packs.Price, $"Refunds of {refunds:0.##} coins for a price of {Packs.Price}");

        var random = new Random(7);
        var rarities = new Dictionary<int, int>();
        for (var i = 0; i < 2000; i++)
        {
            var pack = Packs.Open(SeedData.Cards, random);
            Assert.Equal(5, pack.Count);
            Assert.True(pack[^1].Rarity >= Rarity.Rare, $"Pack {i} has no rare or better card");
            foreach (var card in pack)
            {
                rarities[card.Rarity] = rarities.GetValueOrDefault(card.Rarity) + 1;
            }
        }

        Assert.Equal(4, rarities.Count);

        // Without legendary cards, the guaranteed card is still rare or epic.
        var noLegendaries = SeedData.Cards.Where(c => c.Rarity != Rarity.Legendary).ToList();
        Assert.All(Enumerable.Range(0, 200), _ => Assert.InRange(Packs.Open(noLegendaries, random)[^1].Rarity, Rarity.Rare, Rarity.Epic));
    }
}
