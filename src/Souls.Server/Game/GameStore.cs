using Microsoft.EntityFrameworkCore;
using Souls.Model;

namespace Souls.Server.Game;

/// <summary>
/// Keeps running games in PostgreSQL so they survive a restart of the game server: one <c>running_game</c> row per game
/// (<see cref="GameRoom.Snapshot"/>) plus its replay so far in <c>running_game_replay</c>, appended message by message.
/// The rooms that changed are saved after every request and matchmaker tick, while the <see cref="ServerState"/> lock
/// is held, so a snapshot is always the state between two actions. The engine deletes the rows when a game ends.
/// </summary>
public sealed class GameStore(ServerState state, IServiceScopeFactory scopes, TimeProvider time, GameMetrics metrics, ILogger<GameStore> logger)
{
    /// <summary>A save holds the lock; when the database does not answer in time the rooms stay dirty for the next one.</summary>
    private static readonly TimeSpan SaveTimeout = TimeSpan.FromSeconds(2);

    /// <summary>After a failed save, saving pauses this long so a database outage does not slow down every action.</summary>
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(5);

    private DateTimeOffset _retryAt;

    /// <summary>Saves the rooms that changed (<paramref name="all"/>: every room, when the server stops).</summary>
    public async Task SaveAsync(bool all = false)
    {
        if (!all && time.GetUtcNow() < _retryAt)
        {
            return;
        }

        foreach (var room in state.Rooms.Values.Where(r => !r.IsEnded && (all || r.Dirty)).ToList())
        {
            try
            {
                await SaveAsync(room);
            }
            catch (Exception e)
            {
                logger.LogError(e, "Failed to save running game {GameId}", room.GameId);
                metrics.Error("snapshot");
                _retryAt = time.GetUtcNow() + RetryDelay;
                return;
            }
        }
    }

    /// <summary>Upserts the game row and appends the new replay messages in one statement (atomic, safe to repeat).</summary>
    private async Task SaveAsync(GameRoom room)
    {
        using var timeout = new CancellationTokenSource(SaveTimeout);
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var replay = room.Replay;
        var count = replay.Count;
        var entries = "[" + string.Join(',', replay.Skip(room.SavedReplay).Select(r => r.ToJsonString())) + "]";
        await db.Database.ExecuteSqlAsync($"""
            WITH game AS (
                INSERT INTO running_game (game_id, state, updated_at) VALUES ({room.GameId}, {room.Snapshot()}::jsonb, {time.GetUtcNow()})
                ON CONFLICT (game_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at)
            INSERT INTO running_game_replay (fk_running_game, seq, entry)
            SELECT {room.GameId}, {room.SavedReplay} + e.n - 1, e.entry FROM jsonb_array_elements({entries}::jsonb) WITH ORDINALITY AS e(entry, n)
            ON CONFLICT DO NOTHING
            """, timeout.Token);
        room.SavedReplay = count;
        room.Dirty = false;
    }

    /// <summary>The saved games, restored (see <see cref="GameRoom.Restore"/>). Games that cannot be read are deleted.</summary>
    public async Task<List<GameRoom>> LoadAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
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
                rooms.Add(GameRoom.Restore(game.State, replays[game.GameId], time));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Running game {GameId} cannot be restored and is dropped", game.GameId);
                metrics.Error("restore");
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
