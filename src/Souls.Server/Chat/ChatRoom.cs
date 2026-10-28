using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Chat;

public sealed class ChatRoom
{
    /// <summary>A dynamic room led by <paramref name="leader"/>, who may invite and kick.</summary>
    public ChatRoom(int id, ChatPlayer leader)
    {
        Id = id;
        Clients.AddFirst(leader);
    }

    /// <summary>A static room for the two players of a game. Nobody can be invited or kicked.</summary>
    public ChatRoom(int id, Pair<ChatPlayer> players)
    {
        Id = id;
        IsStatic = true;
        Clients.AddLast(players.First);
        Clients.AddLast(players.Second);
    }

    public int Id { get; }
    public bool IsStatic { get; }

    /// <summary>Members; the first one leads the room.</summary>
    public LinkedList<ChatPlayer> Clients { get; } = new();

    public bool AddClient(ChatPlayer client)
    {
        if (Clients.Contains(client))
        {
            return false;
        }

        Clients.AddLast(client);
        return true;
    }

    public bool RemoveClient(ChatPlayer client) => Clients.Remove(client);

    public bool IsLeader(ChatPlayer client) => Clients.First?.Value == client;

    public void Broadcast(Response response)
    {
        foreach (var client in Clients)
        {
            client.Send(response);
        }
    }
}
