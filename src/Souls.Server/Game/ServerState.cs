using Souls.Server.Chat;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

/// <summary>
/// All mutable game and chat state. Every read or write happens inside <see cref="RunExclusiveAsync(Func{Task})"/>,
/// which serializes message handling across connections (the original server mutated shared collections from
/// many threads without synchronization).
/// </summary>
public sealed class ServerState
{
    private readonly SemaphoreSlim _lock = new(1, 1);

    /// <summary>Logged in game connections.</summary>
    public Dictionary<Connection, Player> GameClients { get; } = [];

    /// <summary>Logged in chat connections.</summary>
    public Dictionary<Connection, Player> ChatClients { get; } = [];

    /// <summary>Running games keyed by their in-memory id.</summary>
    public Dictionary<int, GameRoom> Rooms { get; } = [];

    public LinkedList<Player> NormalQueue { get; } = new();
    public LinkedList<Player> PracticeQueue { get; } = new();

    public Dictionary<int, ChatRoom> ChatRooms { get; } = [];
    public int ChatRoomCounter { get; set; }

    public async Task RunExclusiveAsync(Func<Task> action)
    {
        await _lock.WaitAsync();
        try
        {
            await action();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<T> RunExclusiveAsync<T>(Func<T> action)
    {
        await _lock.WaitAsync();
        try
        {
            return action();
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Finds the (human) player with the given account id.</summary>
    public Player? FindPlayer(int playerId) => GameClients.Values.FirstOrDefault(p => p.Id == playerId && !p.IsBot);

    public Connection? FindGameConnection(Player player) => GameClients.FirstOrDefault(x => x.Value == player).Key;
}
