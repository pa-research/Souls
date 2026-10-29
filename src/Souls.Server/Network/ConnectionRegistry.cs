using System.Collections.Concurrent;

namespace Souls.Server.Network;

/// <summary>All open browser connections, used to re-validate sessions periodically.</summary>
public sealed class ConnectionRegistry
{
    private readonly ConcurrentDictionary<long, Connection> _connections = new();

    public void Add(Connection connection) => _connections[connection.Id] = connection;

    public void Remove(Connection connection) => _connections.TryRemove(connection.Id, out _);

    public IReadOnlyCollection<Connection> Snapshot() => [.. _connections.Values];
}
