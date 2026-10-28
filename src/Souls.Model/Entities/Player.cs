namespace Souls.Model.Entities;

public class Player
{
    public int Id { get; set; }
    public int PlayerTypeId { get; set; }
    public PlayerType? PlayerType { get; set; }
    public required string Name { get; set; }

    /// <summary>Upper-cased name used to enforce case-insensitive uniqueness.</summary>
    public required string NormalizedName { get; set; }

    /// <summary>PBKDF2 password hash (ASP.NET Core Identity v3 format).</summary>
    public required string Password { get; set; }
    public int Money { get; set; }
    public int Rank { get; set; }
    public DateTimeOffset? Created { get; set; }
    public int PlayerPermissionId { get; set; } = Entities.PlayerPermission.Player;
    public PlayerPermission? PlayerPermission { get; set; }

    /// <summary>System accounts (the practice bot) can never log in.</summary>
    public bool IsSystem { get; set; }

    public bool IsAdmin => PlayerPermissionId == Entities.PlayerPermission.Admin;

    public static string Normalize(string name) => name.Trim().ToUpperInvariant();
}
