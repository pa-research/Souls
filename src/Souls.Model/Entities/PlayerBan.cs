namespace Souls.Model.Entities;

public class PlayerBan
{
    public int Id { get; set; }
    public int PlayerId { get; set; }
    public Player? Player { get; set; }
    public DateTimeOffset Until { get; set; }
}
