namespace Souls.Model.Entities;

public class PlayerPermission
{
    public const int Admin = 1;
    public const int Player = 2;

    public int Id { get; set; }
    public required string Name { get; set; }
}
