namespace Souls.Model.Entities;

/// <summary>
/// The active login session of a player. Only a SHA-256 hash of the session token is stored,
/// the token itself lives inside the encrypted authentication cookie.
/// </summary>
public class PlayerLogin
{
    public int Id { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
