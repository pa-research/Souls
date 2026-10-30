namespace Souls.Model;

/// <summary>
/// Deck rules: <see cref="GameRules.DeckSize"/> cards, at most <see cref="Rarity.MaxCopies"/> copies of a card (4
/// common, 3 rare, 2 epic, 1 legendary).
/// </summary>
public static class Decks
{
    /// <summary>
    /// Checks a deck against the cards the player owns (card id to rarity). Returns an error message, or <c>null</c>
    /// if it is valid.
    /// </summary>
    public static string? Validate(IEnumerable<(int CardId, int Count)> deck, IReadOnlyDictionary<int, int> owned)
    {
        var total = 0;
        foreach (var (cardId, count) in deck)
        {
            if (count > 0 && !owned.ContainsKey(cardId))
            {
                return "You can only put cards you own in your deck.";
            }

            var max = owned.TryGetValue(cardId, out var rarity) ? Rarity.MaxCopies(rarity) : GameRules.MaxCopiesInDeck;
            if (count < 0 || count > max)
            {
                return $"A deck can hold at most {max} {(max == 1 ? "copy" : "copies")} of a {Rarity.Name(rarity).ToLowerInvariant()} card.";
            }

            total += count;
        }

        return total == GameRules.DeckSize ? null : $"A deck has exactly {GameRules.DeckSize} cards (this one has {total}).";
    }

    /// <summary>
    /// The deck a player plays with: the saved deck if it is still valid, otherwise the owned cards spread evenly
    /// (in the given order).
    /// </summary>
    public static List<T> Build<T>(IReadOnlyList<T> owned, Func<T, int> idOf, Func<T, int> rarityOf, IEnumerable<(int CardId, int Count)> saved)
    {
        var byId = owned.ToDictionary(idOf);
        var savedList = saved.Where(s => s.Count > 0).ToList();
        if (savedList.Count > 0 && Validate(savedList, owned.ToDictionary(idOf, rarityOf)) is null)
        {
            return [.. savedList.SelectMany(s => Enumerable.Repeat(byId[s.CardId], s.Count))];
        }

        var deck = new List<T>(GameRules.DeckSize);
        if (owned.Count == 0)
        {
            return deck;
        }

        var counts = new Dictionary<int, int>();
        for (var round = 0; deck.Count < GameRules.DeckSize; round++)
        {
            var added = false;
            foreach (var card in owned)
            {
                if (deck.Count == GameRules.DeckSize)
                {
                    break;
                }

                var id = idOf(card);
                if (counts.GetValueOrDefault(id) < Rarity.MaxCopies(rarityOf(card)))
                {
                    counts[id] = counts.GetValueOrDefault(id) + 1;
                    deck.Add(card);
                    added = true;
                }
            }

            if (!added)
            {
                break; // too few different cards: the deck stays smaller
            }
        }

        return deck;
    }

    /// <summary>
    /// A random deck of one or two races (the practice bot and the balance simulator): every copy is drawn with a
    /// weight that favours a mana curve peaking at cost 2-4, within the rarity limits.
    /// </summary>
    public static List<T> Themed<T>(IReadOnlyList<T> pool, Func<T, int> idOf, Func<T, int> rarityOf, Func<T, int?> raceOf, Func<T, int> costOf, Random random)
    {
        var races = pool.Select(raceOf).Distinct().OrderBy(_ => random.Next()).Take(random.Next(1, 3)).ToHashSet();
        var candidates = pool.Where(c => races.Contains(raceOf(c))).ToList();
        if (candidates.Select(idOf).Distinct().Count() < 8)
        {
            candidates = [.. pool];
        }

        static double Weight(int cost) => cost switch
        {
            <= 1 => 0.8,
            <= 4 => 1.2,
            <= 6 => 0.8,
            _ => 0.4,
        };

        var counts = new Dictionary<int, int>();
        var deck = new List<T>(GameRules.DeckSize);
        while (deck.Count < GameRules.DeckSize)
        {
            var open = candidates.Where(c => counts.GetValueOrDefault(idOf(c)) < Rarity.MaxCopies(rarityOf(c))).ToList();
            if (open.Count == 0)
            {
                break;
            }

            var roll = random.NextDouble() * open.Sum(c => Weight(costOf(c)));
            var pick = open[^1];
            foreach (var c in open)
            {
                roll -= Weight(costOf(c));
                if (roll <= 0)
                {
                    pick = c;
                    break;
                }
            }

            counts[idOf(pick)] = counts.GetValueOrDefault(idOf(pick)) + 1;
            deck.Add(pick);
        }

        return deck;
    }
}
