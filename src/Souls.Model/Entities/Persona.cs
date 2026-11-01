namespace Souls.Model.Entities;

/// <summary>
/// A persona of the community (see the game server's AiCommunity): a bot account with a strength and the hours it
/// plays. Its player is marked <see cref="Player.IsAi"/>; it plays the other personas and accepts challenges.
/// </summary>
public class Persona
{
    public int PlayerId { get; set; }
    public Player? Player { get; set; }

    /// <summary>How well it plays, 0 to 1 (see <c>BotSkill</c>).</summary>
    public double Skill { get; set; }

    /// <summary>Its time zone: minutes from UTC.</summary>
    public int UtcOffset { get; set; }

    /// <summary>The local hour it comes online, and for how many hours.</summary>
    public int PlayFrom { get; set; }
    public int PlayHours { get; set; }

    /// <summary>Games won in a row (0 after a loss or draw).</summary>
    public int Streak { get; set; }
}
