namespace Souls.Model.Entities;

/// <summary>
/// A player's Discord Linked Roles connection: the OAuth2 tokens (protected with Data Protection) the web app shows the
/// player's Souls rank on Discord with, and what it last sent.
/// </summary>
public class DiscordConnection
{
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public required string AccessToken { get; set; }
    public required string RefreshToken { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>The role connection last sent (JSON): an unchanged one is not sent again.</summary>
    public string? Pushed { get; set; }
}
