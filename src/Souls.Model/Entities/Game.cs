namespace Souls.Model.Entities;

public class Game
{
    public int Id { get; set; }
    public int Player1Id { get; set; }
    public Player? Player1 { get; set; }
    public int Player2Id { get; set; }
    public Player? Player2 { get; set; }
    public DateTimeOffset? Created { get; set; }

    /// <summary>A practice game against the bot (does not change ratings).</summary>
    public bool IsPractice { get; set; }

    /// <summary>The winner, or <c>null</c> for a draw.</summary>
    public int? WinnerId { get; set; }
    public int Player1RatingChange { get; set; }
    public int Player2RatingChange { get; set; }
    public int Turns { get; set; }
}
