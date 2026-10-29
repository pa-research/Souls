using System.Text.Json.Nodes;
using Souls.Server.Chat;
using Souls.Server.Network;

namespace Souls.Server.Objects;

public sealed class ChatPlayer(string name)
{
    public Dictionary<int, ChatRoom> MemberRooms { get; } = [];
    public string Name { get; } = name;
    public Connection? ChatContext { get; set; }

    public void AddRoom(ChatRoom room) => MemberRooms[room.Id] = room;

    public void Send(Response response) => ChatContext?.Send(response);

    /// <summary>Announces to all of the player's rooms that they disconnected.</summary>
    public void AnnounceDisconnect()
    {
        foreach (var room in MemberRooms.Values)
        {
            room.Broadcast(new Response(ChatResponse.ChatClientDisconnect, $"Player \"{Name}\" disconnected!"));
        }
    }

    public void AnnounceConnect()
    {
        foreach (var room in MemberRooms)
        {
            room.Value.Broadcast(new Response(ChatResponse.ChatClientConnect, new JsonObject
            {
                ["name"] = Name,
                ["room"] = room.Key,
            }));
        }
    }
}
