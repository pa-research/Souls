namespace Souls.Model;

/// <summary>Deck rules: <see cref="GameRules.DeckSize"/> cards, at most <see cref="GameRules.MaxCopiesInDeck"/> copies of a card.</summary>
public static class Decks
{
    /// <summary>Checks a deck against the cards the player owns. Returns an error message, or <c>null</c> if it is valid.</summary>
    public static string? Validate(IEnumerable<(int CardId, int Count)> deck, IReadOnlySet<int> owned)
    {
        var total = 0;
        foreach (var (cardId, count) in deck)
        {
            if (count < 0 || count > GameRules.MaxCopiesInDeck)
            {
                return $"A deck can hold at most {GameRules.MaxCopiesInDeck} copies of a card.";
            }

            if (count > 0 && !owned.Contains(cardId))
            {
                return "You can only put cards you own in your deck.";
            }

            total += count;
        }

        return total == GameRules.DeckSize ? null : $"A deck has exactly {GameRules.DeckSize} cards (this one has {total}).";
    }

    /// <summary>
    /// The deck a player plays with: the saved deck if it is still valid, otherwise the owned cards spread evenly
    /// (in the given order).
    /// </summary>
    public static List<T> Build<T>(IReadOnlyList<T> owned, Func<T, int> idOf, IEnumerable<(int CardId, int Count)> saved)
    {
        var byId = owned.ToDictionary(idOf);
        var savedList = saved.Where(s => s.Count > 0).ToList();
        if (savedList.Count > 0 && Validate(savedList, byId.Keys.ToHashSet()) is null)
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
                if (counts.GetValueOrDefault(id) < GameRules.MaxCopiesInDeck)
                {
                    counts[id] = counts.GetValueOrDefault(id) + 1;
                    deck.Add(card);
                    added = true;
                }
            }

            if (!added)
            {
                break; // fewer than 5 different cards: the deck stays smaller
            }
        }

        return deck;
    }
}
