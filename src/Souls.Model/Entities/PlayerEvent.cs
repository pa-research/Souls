namespace Souls.Model.Entities;

public enum PlayerEventKind
{
    /// <summary>Reached a new tier; <see cref="PlayerEvent.Value"/> is the rank.</summary>
    Tier = 1,

    /// <summary>Won games in a row; <see cref="PlayerEvent.Value"/> is how many.</summary>
    Streak = 2,

    /// <summary>Got a new card; <see cref="PlayerEvent.Value"/> is the card id.</summary>
    Card = 3,
}

/// <summary>A line of the activity feed on the home page: a player reached a tier, a persona won in a row or got a card.</summary>
public class PlayerEvent
{
    public int Id { get; set; }
    public DateTimeOffset Created { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public PlayerEventKind Kind { get; set; }
    public int Value { get; set; }
}
