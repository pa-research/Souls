namespace Souls.Model.Entities;

/// <summary>
/// The spectator's view of a finished game: a JSON array of <c>{"t": ms, "m": message}</c> as the server sent them
/// to spectators, played back by the 3D client.
/// </summary>
public class GameReplay
{
    public int GameId { get; set; }
    public Game? Game { get; set; }
    public required string Data { get; set; }
}
