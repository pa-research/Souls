using System.Text;
using System.Text.Json.Nodes;
using Souls.Server.Game;
using Souls.Model.Localization;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Chat;

/// <summary>Chat rooms. Must be called while holding the <see cref="ServerState"/> lock.</summary>
public sealed class ChatEngine(ServerState state, ILogger<ChatEngine> logger)
{
    public const int MaxMessageLength = 500;

    /// <summary>Creates the chat room for the two players of a game.</summary>
    public ChatRoom RequestNewGameRoom(Pair<ChatPlayer> clients)
    {
        var room = new ChatRoom(state.ChatRoomCounter++, clients);
        state.ChatRooms[room.Id] = room;
        clients.First.AddRoom(room);
        clients.Second.AddRoom(room);

        var payload = new JsonObject { ["name"] = "Server" };
        new GameText("chat.roomCreated", ("room", room.Id)).WriteTo(payload, "message");
        payload["chRoomId"] = room.Id;
        clients.First.Send(new Response(ChatResponse.ChatRoomMade, payload.DeepClone()));
        clients.Second.Send(new Response(ChatResponse.ChatRoomMade, payload));
        logger.LogDebug("Game chat {Room} made for {First} and {Second}", room.Id, clients.First.Name, clients.Second.Name);
        return room;
    }

    /// <summary>
    /// Makes the chat room of a game restored after a restart again, with the same id. Its players are members, and
    /// are back in it when they log in to the chat (see <see cref="ChatPlayer.AnnounceConnect"/>).
    /// </summary>
    public void RestoreGameRoom(int id, Pair<Player> players)
    {
        var members = new Pair<ChatPlayer>(players.First.ChPlayer ??= new ChatPlayer(players.First.Name), players.Second.ChPlayer ??= new ChatPlayer(players.Second.Name));
        var room = new ChatRoom(id, members);
        state.ChatRooms[id] = room;
        state.ChatRoomCounter = Math.Max(state.ChatRoomCounter, id + 1);
        members.First.AddRoom(room);
        members.Second.AddRoom(room);
    }

    public void GetRoomAttendees(ChatPlayer client, Message message)
    {
        var roomId = message.GetInt("room");
        if (!client.MemberRooms.TryGetValue(roomId, out var room))
        {
            client.Send(new Response(ChatResponse.ChatNotMember, new GameText("chat.notMember")));
            return;
        }

        client.Send(new Response(ChatResponse.ChatListMembers, new JsonArray([.. room.Clients.Select(c => (JsonNode)c.Name)])));
    }

    /// <summary>Broadcasts a message to all members of a room the client is in.</summary>
    public void SendMessage(ChatPlayer client, Message message)
    {
        var roomId = message.GetInt("room");
        var text = Sanitize(message.GetString("message", MaxMessageLength * 4));
        if (text.Length == 0)
        {
            return;
        }

        if (!client.MemberRooms.TryGetValue(roomId, out var room))
        {
            client.Send(new Response(ChatResponse.ChatNotMember, new GameText("chat.notMember")));
            return;
        }

        room.Broadcast(new Response(ChatResponse.ChatMessage, new JsonObject
        {
            ["message"] = text,
            ["room"] = roomId,
            ["name"] = client.Name,
        }));
    }

    public void RemoveRoom(int roomId)
    {
        if (state.ChatRooms.Remove(roomId, out var room))
        {
            foreach (var member in room.Clients)
            {
                member.MemberRooms.Remove(roomId);
            }
        }
    }

    /// <summary>Strips control characters and limits the length. HTML is escaped by the client when rendering.</summary>
    internal static string Sanitize(string text)
    {
        var sb = new StringBuilder(Math.Min(text.Length, MaxMessageLength));
        foreach (var ch in text.Trim())
        {
            if (sb.Length == MaxMessageLength)
            {
                break;
            }

            if (!char.IsControl(ch) || ch == '\n')
            {
                sb.Append(ch);
            }
        }

        return sb.ToString();
    }
}
