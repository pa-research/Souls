using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Souls.Model;

namespace Souls.Server.Game;

/// <summary>
/// Keeps running games in PostgreSQL so they survive a restart of the game server: one <c>running_game</c> row per game
/// (<see cref="GameRoom.Snapshot"/>) plus its replay so far in <c>running_game_replay</c>, appended message by message.
/// The rooms that changed are serialized after every request and matchmaker tick, while the <see cref="ServerState"/>
/// lock is held, so a snapshot is always the state between two actions. A single background writer stores them, so a
/// slow database never holds up the games: the latest snapshot of a game wins, its replay messages are appended in
/// order. The engine deletes the rows when a game ends (<see cref="DeleteAsync"/>, after a write of that game still
/// running) and the server writes everything before it stops (<see cref="FlushAsync"/>).
/// </summary>
public sealed class GameStore
{
    /// <summary>A write that takes longer fails and is tried again.</summary>
    private static readonly TimeSpan SaveTimeout = TimeSpan.FromSeconds(2);

    /// <summary>After a failed write, the writer pauses this long so a database outage does not keep it busy.</summary>
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(5);

    private readonly ServerState _state;
    private readonly IServiceScopeFactory _scopes;
    private readonly TimeProvider _time;
    private readonly GameMetrics _metrics;
    private readonly ILogger<GameStore> _logger;

    /// <summary>What is waiting to be written, by game id; a game id is in <see cref="_queue"/> once for each entry.</summary>
    private readonly Dictionary<int, Work> _pending = [];
    private readonly Channel<int> _queue = Channel.CreateUnbounded<int>(new UnboundedChannelOptions { SingleReader = true });
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _writer;

    /// <summary>Games that ended while being written: a failed write of one is not tried again.</summary>
    private readonly HashSet<int> _ended = [];

    /// <summary>The game being written, and when that is done.</summary>
    private (int GameId, Task Done)? _writing;

    public GameStore(ServerState state, IServiceScopeFactory scopes, TimeProvider time, GameMetrics metrics, ILogger<GameStore> logger)
    {
        _state = state;
        _scopes = scopes;
        _time = time;
        _metrics = metrics;
        _logger = logger;
        _writer = Task.Run(WriteAllAsync);
    }

    /// <summary>The latest snapshot of a game and the replay messages after <see cref="FirstSeq"/> not written yet.</summary>
    private sealed record Work(string Snapshot, int FirstSeq, List<string> Entries);

    /// <summary>Hands the rooms that changed to the writer (<paramref name="all"/>: every room, when the server stops).</summary>
    public void Save(bool all = false)
    {
        foreach (var room in _state.Rooms.Values.Where(r => !r.IsEnded && (all || r.Dirty)))
        {
            string snapshot;
            try
            {
                snapshot = room.Snapshot();
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // A bug in one game must not keep the others from being saved.
                _logger.LogError(e, "Running game {GameId} cannot be saved", room.GameId);
                _metrics.Error("snapshot");
                continue;
            }

            var entries = room.Replay.Skip(room.SavedReplay).Select(r => r.ToJsonString()).ToList();
            Enqueue(room.GameId, new Work(snapshot, room.SavedReplay, entries));
            room.SavedReplay += entries.Count;
            room.Dirty = false;
        }
    }

    /// <summary>Adds work for a game: a newer snapshot replaces the waiting one, its replay messages follow the waiting ones.</summary>
    private void Enqueue(int gameId, Work work)
    {
        lock (_pending)
        {
            if (_pending.TryGetValue(gameId, out var waiting))
            {
                waiting.Entries.AddRange(work.Entries);
                _pending[gameId] = waiting with { Snapshot = work.Snapshot };
                return;
            }

            _pending[gameId] = work;
        }

        _queue.Writer.TryWrite(gameId);
    }

    /// <summary>The writer: one game at a time, in the order they changed.</summary>
    private async Task WriteAllAsync()
    {
        await foreach (var gameId in _queue.Reader.ReadAllAsync())
        {
            Work? work;
            var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_pending)
            {
                if (!_pending.Remove(gameId, out work))
                {
                    continue;
                }

                _writing = (gameId, done.Task);
            }

            var failed = false;
            try
            {
                await WriteAsync(gameId, work);
            }
            catch (Exception e)
            {
                // The database is unavailable or too slow (including the timeout): the work waits for the next try,
                // before anything newer of the game (unless the game ended meanwhile).
                _logger.LogError(e, "Failed to save running game {GameId}", gameId);
                _metrics.Error("snapshot");
                failed = true;
                lock (_pending)
                {
                    if (!_ended.Contains(gameId))
                    {
                        if (_pending.Remove(gameId, out var newer))
                        {
                            work.Entries.AddRange(newer.Entries);
                            work = work with { Snapshot = newer.Snapshot };
                        }
                        else
                        {
                            _queue.Writer.TryWrite(gameId);
                        }

                        _pending[gameId] = work;
                    }
                }
            }
            finally
            {
                lock (_pending)
                {
                    _writing = null;
                }

                done.SetResult();
            }

            if (failed)
            {
                if (_stopping.IsCancellationRequested)
                {
                    // Stopping: FlushAsync tries what is left once more.
                    break;
                }

                try
                {
                    await Task.Delay(RetryDelay, _time, _stopping.Token);
                }
                catch (OperationCanceledException)
                {
                }
            }
        }
    }

    /// <summary>Upserts the game row and appends the new replay messages in one statement (atomic, safe to repeat).</summary>
    private async Task WriteAsync(int gameId, Work work)
    {
        using var timeout = new CancellationTokenSource(SaveTimeout);
        await using var scope = _scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var entries = "[" + string.Join(',', work.Entries) + "]";
        await db.Database.ExecuteSqlAsync($"""
            WITH game AS (
                INSERT INTO running_game (game_id, state, updated_at) VALUES ({gameId}, {work.Snapshot}::jsonb, {_time.GetUtcNow()})
                ON CONFLICT (game_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at)
            INSERT INTO running_game_replay (fk_running_game, seq, entry)
            SELECT {gameId}, {work.FirstSeq} + e.n - 1, e.entry FROM jsonb_array_elements({entries}::jsonb) WITH ORDINALITY AS e(entry, n)
            ON CONFLICT DO NOTHING
            """, timeout.Token);
    }

    /// <summary>
    /// Deletes a game that ended: what still waits to be written for it is dropped, and a write of it that is running
    /// finishes first, so the finished game cannot come back.
    /// </summary>
    public async Task DeleteAsync(int gameId)
    {
        Task? writing;
        lock (_pending)
        {
            _pending.Remove(gameId);
            _ended.Add(gameId);
            writing = _writing is { } w && w.GameId == gameId ? w.Done : null;
        }

        try
        {
            if (writing is not null)
            {
                await writing;
            }

            await using var scope = _scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
            await db.RunningGames.Where(g => g.GameId == gameId).ExecuteDeleteAsync();
        }
        finally
        {
            lock (_pending)
            {
                _ended.Remove(gameId);
            }
        }
    }

    /// <summary>
    /// Writes everything handed over so far, without the pause after a failure, and stops the writer. Called when the
    /// server stops. What fails then (a write that was already failing, say) is tried once more; when that fails
    /// too, the database is taken to be down and the rest is not saved.
    /// </summary>
    public async Task FlushAsync()
    {
        _queue.Writer.TryComplete();
        await _stopping.CancelAsync();
        await _writer;
        List<KeyValuePair<int, Work>> left;
        lock (_pending)
        {
            left = [.. _pending];
            _pending.Clear();
        }

        for (var i = 0; i < left.Count; i++)
        {
            try
            {
                await WriteAsync(left[i].Key, left[i].Value);
            }
            catch (Exception e)
            {
                _logger.LogError(e, "Failed to save running game {GameId}", left[i].Key);
                _metrics.Error("snapshot");
                _logger.LogError("{Count} running games could not be saved before stopping", left.Count - i);
                return;
            }
        }
    }

    /// <summary>The saved games, restored (see <see cref="GameRoom.Restore"/>). Games that cannot be read are deleted.</summary>
    public async Task<List<GameRoom>> LoadAsync(CancellationToken ct)
    {
        await using var scope = _scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var games = await db.RunningGames.AsNoTracking().OrderBy(g => g.GameId).ToListAsync(ct);
        var replays = (await db.RunningGameReplays.AsNoTracking().OrderBy(r => r.GameId).ThenBy(r => r.Seq).ToListAsync(ct))
            .ToLookup(r => r.GameId, r => r.Entry);

        var rooms = new List<GameRoom>();
        var broken = new List<int>();
        foreach (var game in games)
        {
            GameRoom.ReserveIds(game.GameId);
            try
            {
                rooms.Add(GameRoom.Restore(game.State, replays[game.GameId], _time));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _logger.LogError(e, "Running game {GameId} cannot be restored and is dropped", game.GameId);
                _metrics.Error("restore");
                broken.Add(game.GameId);
            }
        }

        if (broken.Count > 0)
        {
            await db.RunningGames.Where(g => broken.Contains(g.GameId)).ExecuteDeleteAsync(ct);
        }

        return rooms;
    }
}
