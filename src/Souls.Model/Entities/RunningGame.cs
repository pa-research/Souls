namespace Souls.Model.Entities;

/// <summary>
/// A game in progress, saved by the game server after every action so the game survives a restart. <see cref="State"/>
/// is the game as JSON (heroes, hands, decks, board, turn, log); the replay so far is in <see cref="RunningGameReplay"/>.
/// The row is deleted when the game ends, in the transaction that stores the finished game.
/// </summary>
public class RunningGame
{
    /// <summary>The game server's id of the running game (not a <see cref="Game"/> id).</summary>
    public int GameId { get; set; }
    public required string State { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>One recorded replay message of a running game, appended as the game goes so the state row stays small.</summary>
public class RunningGameReplay
{
    public int GameId { get; set; }

    /// <summary>Position in the replay, from 0.</summary>
    public int Seq { get; set; }
    public required string Entry { get; set; }
}
