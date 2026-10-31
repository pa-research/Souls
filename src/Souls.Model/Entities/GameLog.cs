namespace Souls.Model.Entities;

/// <summary>
/// One event of a finished game. Obj1/Obj2 reference either a player or a card, as given by the type columns.
/// </summary>
public class GameLog
{
    public int Id { get; set; }
    public int GameLogTypeId { get; set; }
    public GameLogType? GameLogType { get; set; }
    public int GameId { get; set; }
    public Game? Game { get; set; }
    public int Obj1Id { get; set; }
    public int Obj2Id { get; set; }
    public required string Obj1Type { get; set; }
    public required string Obj2Type { get; set; }

    /// <summary>The line as the players saw it in the battle log, in English (older games have none).</summary>
    public string? Text { get; set; }

    /// <summary>The line's key in the string tables (<see cref="Localization.Strings"/>), to show it in any language (older games have none).</summary>
    public string? TextKey { get; set; }

    /// <summary>The arguments of <see cref="TextKey"/> as a JSON object.</summary>
    public string? TextArgs { get; set; }
}
