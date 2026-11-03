using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Chat;

/// <summary>The chat room of a game: its two players.</summary>
public sealed class ChatRoom(int id, Pair<ChatPlayer> players)
{
    public int Id { get; } = id;

    public IReadOnlyList<ChatPlayer> Clients { get; } = [players.First, players.Second];

    public void Broadcast(Response response)
    {
        foreach (var client in Clients)
        {
            client.Send(response);
        }
    }
}
