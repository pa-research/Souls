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

    /// <summary>Friendly challenges waiting for an answer. A player is in at most one, on either side.</summary>
    public List<Challenge> Challenges { get; } = [];

    /// <summary>Rate limit of challenges by account id (survives reconnects), see <see cref="GameEngine.Throttle"/>.</summary>
    public Dictionary<int, DateTimeOffset> ChallengeClocks { get; } = [];

    /// <summary>
    /// The personas of the AI community who are online now, by normalized name (see <see cref="Ai.AiCommunity"/>); one
    /// in a game stays here.
    /// </summary>
    public Dictionary<string, Player> Personas { get; } = [];

    /// <summary>Personas playing each other away from the server (<see cref="Ai.AiCommunity"/>), by id: busy here.</summary>
    public HashSet<int> PersonasAway { get; } = [];

    /// <summary>
    /// A persona that can start a game now. A game restored after a restart has its own player for the persona, so the
    /// rooms are checked by id.
    /// </summary>
    public bool IsFree(Player persona) => persona.GPlayer is null && !PersonasAway.Contains(persona.Id) && ChallengeOf(persona) is null
        && !Rooms.Values.Any(r => r.Players.First.Id == persona.Id || r.Players.Second.Id == persona.Id);

    public Dictionary<int, ChatRoom> ChatRooms { get; } = [];
    public int ChatRoomCounter { get; set; }

    /// <summary>
    /// The server is stopping: the games are saved and stay as they are for the next instance, so nothing may change
    /// them any more (requests are ignored, disconnects forfeit nothing). Set under the lock, read anywhere.
    /// </summary>
    public bool ShuttingDown
    {
        get => Volatile.Read(ref _shuttingDown);
        set => Volatile.Write(ref _shuttingDown, value);
    }

    private bool _shuttingDown;

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

    /// <summary>The pending challenge a player sent or received.</summary>
    public Challenge? ChallengeOf(Player player) => Challenges.FirstOrDefault(c => c.From == player || c.To == player);
}

/// <summary>A friendly challenge from one online player to another, open until it expires.</summary>
public sealed record Challenge(Player From, Player To, DateTimeOffset ExpiresAt, DateTimeOffset Sent = default);
