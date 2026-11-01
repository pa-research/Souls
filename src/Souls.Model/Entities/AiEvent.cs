namespace Souls.Model.Entities;

public enum AiEventKind
{
    /// <summary>Reached a new tier; <see cref="AiEvent.Value"/> is the rank.</summary>
    Tier = 1,

    /// <summary>Won games in a row; <see cref="AiEvent.Value"/> is how many.</summary>
    Streak = 2,

    /// <summary>Got a new card; <see cref="AiEvent.Value"/> is the card id.</summary>
    Card = 3,
}

/// <summary>A line of the AI community's activity feed (see the game server's AiCommunity).</summary>
public class AiEvent
{
    public int Id { get; set; }
    public DateTimeOffset Created { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public AiEventKind Kind { get; set; }
    public int Value { get; set; }
}
