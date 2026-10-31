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

    public sealed record Tier(string Name, string Division, string Css)
    {
        /// <summary>"Bronze" (without the division) in the reader's language.</summary>
        public Localization.GameText NameText => new("tier." + Name.ToLowerInvariant());

        /// <summary>"Bronze III", "Champion" in the reader's language.</summary>
        public Localization.GameText Text =>
            Division.Length == 0 ? NameText : new Localization.GameText("tier.division", ("tier", NameText), ("division", Division));

        public override string ToString() => Text.ToString();
    }

    private static readonly string[] TierNames = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
    private static readonly string[] Divisions = ["III", "II", "I"];

    /// <summary>Three ranks per tier: Bronze III (rank 1) up to Diamond I (rank 15), then Champion.</summary>
    public static Tier TierOf(int rank)
    {
        var index = Math.Max(0, rank - 1);
        if (index >= TierNames.Length * Divisions.Length)
        {
            return new Tier("Champion", string.Empty, "tier-champion");
        }

        var name = TierNames[index / Divisions.Length];
        return new Tier(name, Divisions[index % Divisions.Length], "tier-" + name.ToLowerInvariant());
    }

    /// <summary>How far the rating is towards the next rank (0-1).</summary>
    public static double RankProgress(int rating) => rating < Initial ? 0 : (rating - Initial) % PointsPerRank / (double)PointsPerRank;

    /// <summary>Largest rating difference matchmaking accepts after waiting this long.</summary>
    public static int MatchWindow(TimeSpan waited) => 150 + (int)(waited.TotalSeconds * 25);
}
