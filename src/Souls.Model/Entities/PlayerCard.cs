namespace Souls.Model.Entities;

/// <summary>A card owned by a player.</summary>
public class PlayerCard
{
    public int Id { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public int CardId { get; set; }
    public Card? Card { get; set; }
    public DateTimeOffset ObtainedAt { get; set; }
}
