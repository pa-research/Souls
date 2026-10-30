using Souls.Model;
using Souls.Model.Entities;

namespace Souls.Server.Game;

/// <summary>Collects the events of a game (starting with <paramref name="records"/> of a restored game) and stores them when the game ends.</summary>
public sealed class GameLogger(IEnumerable<GameLog>? records = null)
{
    private readonly List<GameLog> _records = [.. records ?? []];

    public IReadOnlyList<GameLog> Records => _records;

    public void Add(GameLogKind kind, int obj1Id, int obj2Id, string obj1Type, string obj2Type, string? text = null) => _records.Add(new GameLog
    {
        GameLogTypeId = (int)kind,
        Obj1Id = obj1Id,
        Obj2Id = obj2Id,
        Obj1Type = obj1Type,
        Obj2Type = obj2Type,
        Text = text is { Length: > 500 } ? text[..500] : text,
    });

    public void AddTo(SoulsDbContext db, Model.Entities.Game game)
    {
        foreach (var record in _records)
        {
            record.Game = game;
            db.GameLogs.Add(record);
        }
    }
}
