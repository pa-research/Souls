namespace Souls.Model;

/// <summary>Elo ratings of normal games and the rank shown on the site.</summary>
public static class Ratings
{
    public const int Initial = 1000;
    public const int K = 32;
    public const int PointsPerRank = 50;

    /// <summary>Rating change of player A after a game (score: 1 win, 0.5 draw, 0 loss).</summary>
    public static int Change(int ratingA, int ratingB, double scoreA)
    {
        var expected = 1 / (1 + Math.Pow(10, (ratingB - ratingA) / 400.0));
        return (int)Math.Round(K * (scoreA - expected), MidpointRounding.AwayFromZero);
    }

    /// <summary>Rank 1 at the initial rating and below, one rank more for each 50 points above it.</summary>
    public static int RankOf(int rating) => Math.Max(1, 1 + (rating - Initial) / PointsPerRank);

    /// <summary>Largest rating difference matchmaking accepts after waiting this long.</summary>
    public static int MatchWindow(TimeSpan waited) => 150 + (int)(waited.TotalSeconds * 25);
}
