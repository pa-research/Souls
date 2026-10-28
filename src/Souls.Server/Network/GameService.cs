using System.Text.Json.Nodes;
using Souls.Server.Game;
using Souls.Server.Objects;

namespace Souls.Server.Network;

/// <summary>The <c>/ws/game</c> endpoint.</summary>
public sealed class GameService(ServerState state, GameEngine engine, PlayerRepository players, TimeProvider time, ILogger<GameService> logger) : IClientService
{
    public async Task ProcessAsync(Connection connection, Message message)
    {
        if (connection.LoggedIn && state.GameClients.TryGetValue(connection, out var player))
        {
            switch ((GameRequest)message.Type)
            {
                case GameRequest.QueueNormal:
                    engine.RequestQueue(player, normal: true);
                    return;
                case GameRequest.QueuePractice:
                    engine.RequestQueue(player, normal: false);
                    return;
                case GameRequest.Attack:
                    await engine.RequestAttackAsync(player, message);
                    return;
                case GameRequest.UseCard:
                    engine.RequestUseCard(player, message);
                    return;
                case GameRequest.NextTurn:
                    engine.RequestNextTurn(player);
                    return;
                case GameRequest.MoveCard:
                    engine.RequestMoveCard(player, message);
                    return;
                case GameRequest.ReleaseCard:
                    engine.RequestReleaseCard(player, message);
                    return;
                case GameRequest.UseAbility:
                    engine.RequestUseAbility(player, message);
                    return;
            }
        }

        switch ((ServiceRequest)message.Type)
        {
            case ServiceRequest.Login:
                await LoginAsync(connection);
                break;
            case ServiceRequest.Logout:
                await LogoutAsync(connection);
                break;
            case ServiceRequest.Heartbeat:
                connection.Send(Heartbeat(message));
                break;
        }
    }

    /// <summary>
    /// The connection is already authenticated by the session cookie; LOGIN attaches it to the player, or
    /// re-attaches it to a running game after a reconnect. The "hash" sent by old clients is ignored.
    /// </summary>
    private async Task LoginAsync(Connection connection)
    {
        if (connection.User is not { } user || connection.LoggedIn)
        {
            return;
        }

        var existing = state.FindPlayer(user.Id);
        if (existing is not null)
        {
            if (existing.GameContext is { } old && old != connection)
            {
                state.GameClients.Remove(old);
                old.Close("Logged in from another window");
            }

            existing.GameContext = connection;
            existing.DisconnectedAt = null;
            state.GameClients[connection] = existing;
            connection.LoggedIn = true;
            connection.Send(new Response(ServiceResponse.LoginOk, $"Logged in as {existing.Name}"));
            return;
        }

        var player = await players.LoadPlayerAsync(user.Id);
        if (player is null)
        {
            connection.Send(new Response(ServiceResponse.LoginNotLoggedIn, "Please Login!"));
            connection.Close("Not logged in");
            return;
        }

        player.GameContext = connection;
        state.GameClients[connection] = player;
        connection.LoggedIn = true;
        connection.Send(new Response(ServiceResponse.LoginOk, $"Logged in as {player.Name}"));
        logger.LogInformation("{Player} logged in to the game server ({Online} online)", player.Name, state.GameClients.Count);
    }

    private async Task LogoutAsync(Connection connection)
    {
        if (!state.GameClients.TryGetValue(connection, out var player))
        {
            return;
        }

        engine.RemoveFromQueues(player);
        await engine.ForfeitAsync(player);
        state.GameClients.Remove(connection);
        connection.LoggedIn = false;
        connection.Send(new Response(ServiceResponse.Disconnected, "You are now logged out!"));
    }

    public async Task OnDisconnectedAsync(Connection connection)
    {
        if (!state.GameClients.TryGetValue(connection, out var player) || player.GameContext != connection)
        {
            return;
        }

        engine.RemoveFromQueues(player);
        if (player.GPlayer?.GameRoom is { IsEnded: false })
        {
            if (player.IsBot || player.GetOpponent()?.IsBot == true)
            {
                await engine.ForfeitAsync(player);
            }
            else
            {
                // Give the player a grace period to reconnect, see Matchmaker.
                player.DisconnectedAt = time.GetUtcNow();
                return;
            }
        }

        state.GameClients.Remove(connection);
    }

    private static Response Heartbeat(Message message)
    {
        static JsonNode? Number(Message m, string name) => m.Payload[name] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : 0;

        return new Response(ServiceResponse.HeartbeatReply, new JsonObject
        {
            ["first"] = Number(message, "heartbeat"),
            ["last"] = Number(message, "last"),
        });
    }
}
