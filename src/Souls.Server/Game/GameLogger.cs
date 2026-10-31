using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Localization;

namespace Souls.Server.Game;

/// <summary>Collects the events of a game (starting with <paramref name="records"/> of a restored game) and stores them when the game ends.</summary>
public sealed class GameLogger(IEnumerable<GameLog>? records = null)
{
    private readonly List<GameLog> _records = [.. records ?? []];

    public IReadOnlyList<GameLog> Records => _records;

    /// <summary>
    /// Records an event. <paramref name="text"/> is stored in English with its key and arguments, so the statistics
    /// page can show it in the reader's language.
    /// </summary>
    public void Add(GameLogKind kind, int obj1Id, int obj2Id, string obj1Type, string obj2Type, GameText? text = null)
    {
        var english = text?.ToString();
        _records.Add(new GameLog
        {
            GameLogTypeId = (int)kind,
            Obj1Id = obj1Id,
            Obj2Id = obj2Id,
            Obj1Type = obj1Type,
            Obj2Type = obj2Type,
            Text = english is { Length: > 500 } ? english[..500] : english,
            TextKey = text?.Key,
            TextArgs = text?.ArgsJson()?.ToJsonString(),
        });
    }

    public void AddTo(SoulsDbContext db, Model.Entities.Game game)
    {
        foreach (var record in _records)
        {
            record.Game = game;
            db.GameLogs.Add(record);
        }
    }
}
