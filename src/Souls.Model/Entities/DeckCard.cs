namespace Souls.Model.Entities;

/// <summary>One card of a player's deck: <see cref="Count"/> copies of an owned card.</summary>
public class DeckCard
{
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public int CardId { get; set; }
    public Card? Card { get; set; }
    public int Count { get; set; }
}
