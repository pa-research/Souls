namespace Souls.Model.Entities;

public class Race
{
    public int Id { get; set; }
    public required string Name { get; set; }

    /// <summary>Relative URL of the card background texture for this race.</summary>
    public string? CardUrl { get; set; }
}
