namespace Souls.Model.Entities;

/// <summary>A player's final place in an ended season and the reward it paid.</summary>
public class SeasonStanding
{
    public int SeasonNumber { get; set; }
    public Season? Season { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public int Position { get; set; }
    public int Rating { get; set; }
    public int Rank { get; set; }

    /// <summary>Normal (ranked) games played in the season, and how many of them were won.</summary>
    public int Games { get; set; }
    public int Wins { get; set; }
    public int RewardCoins { get; set; }
    public int? RewardCardId { get; set; }
    public Card? RewardCard { get; set; }
}
