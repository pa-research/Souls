namespace Souls.Model.Entities;

public class News
{
    public int Id { get; set; }
    public required string Title { get; set; }

    /// <summary>Sanitized HTML.</summary>
    public required string Text { get; set; }
    public required string Author { get; set; }
    public DateTimeOffset Date { get; set; }
    public bool Enabled { get; set; }
}
