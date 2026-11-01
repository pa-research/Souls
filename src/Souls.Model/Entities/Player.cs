namespace Souls.Model.Entities;

public class Player
{
    public int Id { get; set; }
    public int PlayerTypeId { get; set; }
    public PlayerType? PlayerType { get; set; }

    /// <summary>The hero power the player picked (see <see cref="GameRules.HeroPowers"/>); <c>null</c>: the class's default.</summary>
    public int? HeroPowerId { get; set; }
    public required string Name { get; set; }

    /// <summary>Upper-cased name used to enforce case-insensitive uniqueness.</summary>
    public required string NormalizedName { get; set; }

    /// <summary>PBKDF2 password hash (ASP.NET Core Identity v3 format).</summary>
    public required string Password { get; set; }
    public int Money { get; set; }

    /// <summary>Derived from <see cref="Rating"/> (see <see cref="Ratings.RankOf"/>).</summary>
    public int Rank { get; set; }

    /// <summary>Glicko-2 rating (see <see cref="Ratings"/>), changed by normal (not practice) games.</summary>
    public int Rating { get; set; } = Ratings.Initial;

    /// <summary>How uncertain <see cref="Rating"/> is (Glicko-2 rating deviation).</summary>
    public double RatingDeviation { get; set; } = Ratings.InitialDeviation;

    /// <summary>How erratic the player's results are (Glicko-2 volatility).</summary>
    public double RatingVolatility { get; set; } = Ratings.InitialVolatility;

    /// <summary>When the rating last changed; the deviation grows from then until the next rated game.</summary>
    public DateTimeOffset? RatedAt { get; set; }
    public DateTimeOffset? Created { get; set; }
    public int PlayerPermissionId { get; set; } = Entities.PlayerPermission.Player;
    public PlayerPermission? PlayerPermission { get; set; }

    /// <summary>System accounts (the practice bot) can never log in.</summary>
    public bool IsSystem { get; set; }

    public bool IsAdmin => PlayerPermissionId == Entities.PlayerPermission.Admin;

    public static string Normalize(string name) => name.Trim().ToUpperInvariant();
}
