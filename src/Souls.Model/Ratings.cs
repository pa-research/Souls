namespace Souls.Model;

/// <summary>
/// Glicko-2 ratings of normal games (Glickman, "Example of the Glicko-2 system", 2022), each game a rating period of its
/// own, and the rank shown on the site.
/// </summary>
public static class Ratings
{
    public const int Initial = 1000;
    public const int PointsPerRank = 50;

    /// <summary>A new player's deviation: the rating is a guess, so the first games move it a lot (about ±160).</summary>
    public const double InitialDeviation = 350;

    /// <summary>
    /// The smallest deviation: a settled player still moves about ±15 for a win or a loss against an equal opponent
    /// (as with the Elo K of 32 before), and the rating keeps following a player who gets better.
    /// </summary>
    public const double MinDeviation = 75;

    /// <summary>The deviation at a season's start is at least this, so the new season finds everyone's level quickly.</summary>
    public const double SeasonDeviation = 150;

    public const double InitialVolatility = 0.06;

    /// <summary>How much the volatility may change (Glickman suggests 0.3 to 1.2).</summary>
    private const double Tau = 0.5;

    /// <summary>The Glicko-2 scale: 400 / ln 10.</summary>
    private const double Scale = 173.7178;

    /// <summary>A player's Glicko-2 rating, its deviation (uncertainty) and its volatility.</summary>
    public readonly record struct Glicko(double Rating, double Deviation, double Volatility);

    /// <summary>The deviation after a time without rated games: one rating period a week, as Glicko-2 does between games.</summary>
    public static double Aged(double deviation, double volatility, TimeSpan idle)
    {
        var weeks = Math.Max(0, idle.TotalDays / 7);
        var phi = deviation / Scale;
        return Math.Min(InitialDeviation, Scale * Math.Sqrt(phi * phi + volatility * volatility * weeks));
    }

    /// <summary>
    /// The rating after one game (score: 1 win, 0.5 draw, 0 loss) against an opponent with the given rating and
    /// deviation (as it was before the game).
    /// </summary>
    public static Glicko Update(Glicko player, double opponentRating, double opponentDeviation, double score)
    {
        var mu = (player.Rating - Initial) / Scale;
        var phi = player.Deviation / Scale;
        var muJ = (opponentRating - Initial) / Scale;
        var g = 1 / Math.Sqrt(1 + 3 * Math.Pow(opponentDeviation / Scale, 2) / (Math.PI * Math.PI));
        var expected = 1 / (1 + Math.Exp(-g * (mu - muJ)));
        var v = 1 / (g * g * expected * (1 - expected));
        var delta = v * g * (score - expected);
        var sigma = Volatility(phi, player.Volatility, v, delta);
        var phiStar = Math.Sqrt(phi * phi + sigma * sigma);
        var phiNew = 1 / Math.Sqrt(1 / (phiStar * phiStar) + 1 / v);
        var muNew = mu + phiNew * phiNew * g * (score - expected);
        return new Glicko(Initial + Scale * muNew, Math.Clamp(Scale * phiNew, MinDeviation, InitialDeviation), sigma);
    }

    /// <summary>The new volatility: the root of Glickman's f(x), found with the Illinois algorithm (step 5).</summary>
    private static double Volatility(double phi, double sigma, double v, double delta)
    {
        var a = Math.Log(sigma * sigma);
        double F(double x)
        {
            var ex = Math.Exp(x);
            var d = phi * phi + v + ex;
            return ex * (delta * delta - d) / (2 * d * d) - (x - a) / (Tau * Tau);
        }

        // low and high are Glickman's A and B.
        double low = a, high;
        if (delta * delta > phi * phi + v)
        {
            high = Math.Log(delta * delta - phi * phi - v);
        }
        else
        {
            var k = 1;
            while (F(a - k * Tau) < 0)
            {
                k++;
            }

            high = a - k * Tau;
        }

        double fLow = F(low), fHigh = F(high);
        for (var i = 0; i < 100 && Math.Abs(high - low) > 1e-6; i++)
        {
            var c = low + (low - high) * fLow / (fHigh - fLow);
            var fC = F(c);
            if (fC * fHigh <= 0)
            {
                (low, fLow) = (high, fHigh);
            }
            else
            {
                fLow /= 2;
            }

            (high, fHigh) = (c, fC);
        }

        return Math.Exp(low / 2);
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

    /// <summary>The first rank of Champion, the top of the ladder (every rank above it is Champion too).</summary>
    public const int ChampionRank = 16;

    /// <summary>The lowest rating of a rank (rank 1 also holds every rating below it).</summary>
    public static int RatingOfRank(int rank) => Initial + (Math.Max(1, rank) - 1) * PointsPerRank;

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
