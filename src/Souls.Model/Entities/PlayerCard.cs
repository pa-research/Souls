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

    /// <summary>Upgrade level (1-3): buying a card you own levels it up, each level adds +1 attack and +1 health.</summary>
    public int Level { get; set; } = 1;
}
