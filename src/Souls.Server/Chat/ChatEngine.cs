using System.Text;
using System.Text.Json.Nodes;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Chat;

/// <summary>Chat rooms. Must be called while holding the <see cref="ServerState"/> lock.</summary>
public sealed class ChatEngine(ServerState state, ILogger<ChatEngine> logger)
{
    public const int MaxMessageLength = 500;

    /// <summary>Creates the static chat room for the two players of a game.</summary>
    public void RequestNewGameRoom(Pair<ChatPlayer> clients)
    {
        var room = new ChatRoom(state.ChatRoomCounter++, clients);
        state.ChatRooms[room.Id] = room;
        clients.First.AddRoom(room);
        clients.Second.AddRoom(room);

        var payload = new JsonObject
        {
            ["name"] = "Server",
            ["message"] = $"Made chatroom \"{room.Id}\"",
            ["chRoomId"] = room.Id,
        };
        clients.First.Send(new Response(ChatResponse.ChatRoomMade, payload.DeepClone()));
        clients.Second.Send(new Response(ChatResponse.ChatRoomMade, payload));
        logger.LogDebug("Game chat {Room} made for {First} and {Second}", room.Id, clients.First.Name, clients.Second.Name);
    }

    /// <summary>Creates a dynamic room led by the client.</summary>
    public void RequestNewRoom(ChatPlayer client)
    {
        var room = new ChatRoom(state.ChatRoomCounter++, client);
        state.ChatRooms[room.Id] = room;
        client.AddRoom(room);
        client.Send(new Response(ChatResponse.ChatRoomMade, $"You made a new chat room with id {room.Id}"));
    }

    public void Invite(ChatPlayer inviter, Message message)
    {
        var roomId = message.GetInt("room");
        var name = message.GetString("name", 64);

        if (!state.ChatRooms.TryGetValue(roomId, out var room) || !room.IsLeader(inviter) || room.IsStatic)
        {
            inviter.Send(new Response(ChatResponse.NotLeader, $"You are not the leader of room {roomId}"));
            return;
        }

        var toInvite = state.GameClients.Values.FirstOrDefault(p => !p.IsBot && p.Name == name)?.ChPlayer;
        if (toInvite?.ChatContext is null)
        {
            inviter.Send(new Response(ChatResponse.ClientNotFound, $"Problem adding {name} to room {roomId}. Is the player online?"));
            return;
        }

        if (room.AddClient(toInvite))
        {
            toInvite.AddRoom(room);
            inviter.Send(new Response(ChatResponse.InvitedClient, $"You invited {toInvite.Name} to room {roomId}"));
            toInvite.Send(new Response(ChatResponse.GotInvited, $"You got invited to room {roomId} by {inviter.Name}"));
        }
        else
        {
            inviter.Send(new Response(ChatResponse.ClientNotFound, $"{name} is already in room {roomId}"));
        }
    }

    public void Kick(ChatPlayer kicker, Message message)
    {
        var roomId = message.GetInt("room");
        var name = message.GetString("name", 64);

        if (!state.ChatRooms.TryGetValue(roomId, out var room) || !room.IsLeader(kicker) || room.IsStatic)
        {
            kicker.Send(new Response(ChatResponse.NotLeader, $"You are not leader of room {roomId}"));
            return;
        }

        var toKick = room.Clients.FirstOrDefault(c => c.Name == name);
        if (toKick is not null && toKick != kicker && room.RemoveClient(toKick))
        {
            toKick.MemberRooms.Remove(roomId);
            kicker.Send(new Response(ChatResponse.KickedClient, $"You kicked {toKick.Name} from room {roomId}"));
            toKick.Send(new Response(ChatResponse.GotKicked, $"You got kicked from room {roomId} by {kicker.Name}"));
        }
        else
        {
            kicker.Send(new Response(ChatResponse.ClientNotFound, $"{name} is not in room {roomId}"));
        }
    }

    public void LeaveRoom(ChatPlayer client, Message message)
    {
        var roomId = message.GetInt("room");
        if (!state.ChatRooms.TryGetValue(roomId, out var room) || !room.Clients.Contains(client))
        {
            client.Send(new Response(ChatResponse.ChatNotMember, "You are not a member of that room!"));
            return;
        }

        var wasLeader = room.IsLeader(client);
        room.RemoveClient(client);
        client.MemberRooms.Remove(roomId);
        client.Send(new Response(ChatResponse.LeftRoom, $"You left room {roomId}"));

        if (room.Clients.Count == 0)
        {
            state.ChatRooms.Remove(roomId);
            return;
        }

        room.Broadcast(new Response(ChatResponse.ChatMessage, new JsonObject
        {
            ["message"] = $"{client.Name} left the room",
            ["room"] = roomId,
            ["name"] = "Server",
        }));
        if (wasLeader)
        {
            room.Clients.First!.Value.Send(new Response(ChatResponse.MadeLeader, $"You are now the leader of room {roomId}"));
        }
    }

    public void GetRoomAttendees(ChatPlayer client, Message message)
    {
        var roomId = message.GetInt("room");
        if (!client.MemberRooms.TryGetValue(roomId, out var room))
        {
            client.Send(new Response(ChatResponse.ChatNotMember, "You are not a member of that room!"));
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
            client.Send(new Response(ChatResponse.ChatNotMember, "You are not a member of that room!"));
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
