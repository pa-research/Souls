namespace Souls.Model.Entities;

public class Game
{
    public int Id { get; set; }
    public int Player1Id { get; set; }
    public Player? Player1 { get; set; }
    public int Player2Id { get; set; }
    public Player? Player2 { get; set; }
    public DateTimeOffset? Created { get; set; }
}
