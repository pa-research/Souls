using Souls.Model.Localization;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Objects;

namespace Souls.Server.Network;

/// <summary>The <c>/ws/chat</c> endpoint. A chat connection is linked to the player's game connection.</summary>
public sealed class ChatService(ServerState state, ChatEngine chat) : IClientService
{
    private const int MaxOwnedRooms = 5;

    public Task ProcessAsync(Connection connection, Message message)
    {
        if (connection.LoggedIn && state.ChatClients.TryGetValue(connection, out var player) && player.ChPlayer is { } ch)
        {
            switch ((ChatRequest)message.Type)
            {
                case ChatRequest.Message:
                    chat.SendMessage(ch, message);
                    return Task.CompletedTask;
                case ChatRequest.NewRoom:
                    if (ch.MemberRooms.Values.Count(r => r.IsLeader(ch) && !r.IsStatic) < MaxOwnedRooms)
                    {
                        chat.RequestNewRoom(ch);
                    }

                    return Task.CompletedTask;
                case ChatRequest.NewGameRoom:
                    if (player.GPlayer?.GameRoom is { } game && player.GetOpponent()?.ChPlayer is { } opponent && !ch.MemberRooms.Values.Any(r => r.IsStatic && r.Clients.Contains(opponent)))
                    {
                        // Saved with the game: the room comes back after a restart (see GameEngine.Resume).
                        game.ChatRoomId = chat.RequestNewGameRoom(new Pair<ChatPlayer>(ch, opponent)).Id;
                        game.Dirty = true;
                    }

                    return Task.CompletedTask;
                case ChatRequest.Invite:
                    chat.Invite(ch, message);
                    return Task.CompletedTask;
                case ChatRequest.Kick:
                    chat.Kick(ch, message);
                    return Task.CompletedTask;
                case ChatRequest.Leave:
                    chat.LeaveRoom(ch, message);
                    return Task.CompletedTask;
                case ChatRequest.ListClients:
                    chat.GetRoomAttendees(ch, message);
                    return Task.CompletedTask;
            }
        }

        if ((ServiceRequest)message.Type == ServiceRequest.Login)
        {
            Login(connection);
        }

        return Task.CompletedTask;
    }

    private void Login(Connection connection)
    {
        if (connection.User is not { } user)
        {
            return;
        }

        // The chat is only available to players logged in to the game service.
        var player = state.FindPlayer(user.Id);
        if (player is null)
        {
            connection.Send(new Response(ServiceResponse.LoginNotLoggedIn, new GameText("service.chatLogin")));
            return;
        }

        if (player.ChatContext is { } old && old != connection)
        {
            state.ChatClients.Remove(old);
            old.Close("Logged in from another window");
        }

        player.ChatContext = connection;
        state.ChatClients[connection] = player;
        connection.LoggedIn = true;

        if (player.ChPlayer is null)
        {
            player.ChPlayer = new ChatPlayer(player.Name) { ChatContext = connection };
        }
        else
        {
            player.ChPlayer.ChatContext = connection;
            player.ChPlayer.AnnounceConnect();
        }
    }

    public Task OnDisconnectedAsync(Connection connection)
    {
        if (state.ChatClients.Remove(connection, out var player) && player.ChatContext == connection)
        {
            player.ChatContext = null;
            if (player.ChPlayer is { } ch)
            {
                ch.ChatContext = null;
                ch.AnnounceDisconnect();
            }
        }

        return Task.CompletedTask;
    }
}
