namespace Souls.Model.Entities;

/// <summary>A ranked season. The current season is the one with the highest number (see <see cref="Seasons"/>).</summary>
public class Season
{
    public int Number { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset StartsAt { get; set; }

    /// <summary>When the season ends; after the rollover, when it actually ended.</summary>
    public DateTimeOffset EndsAt { get; set; }
}
