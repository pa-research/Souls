using System.Text.Json.Nodes;
using Souls.Model.Localization;
using Souls.Server.Game;
using Souls.Server.Objects;

namespace Souls.Server.Network;

/// <summary>The <c>/ws/game</c> endpoint. With a <paramref name="store"/> the games a request changed are saved after it (in the background).</summary>
public sealed class GameService(ServerState state, GameEngine engine, PlayerRepository players, TimeProvider time, ILogger<GameService> logger, GameStore? store = null) : IClientService
{
    public async Task ProcessAsync(Connection connection, Message message)
    {
        if (state.ShuttingDown)
        {
            return;
        }

        await HandleAsync(connection, message);
        store?.Save();
    }

    private async Task HandleAsync(Connection connection, Message message)
    {
        if (connection.LoggedIn && state.GameClients.TryGetValue(connection, out var player))
        {
            switch ((GameRequest)message.Type)
            {
                case GameRequest.QueueNormal:
                    engine.RequestQueue(player, normal: true);
                    return;
                case GameRequest.QueuePractice:
                    engine.RequestQueue(player, normal: false, difficulty: message.Payload["difficulty"] is null ? 1 : message.GetInt("difficulty"));
                    return;
                case GameRequest.Attack:
                    await engine.RequestAttackAsync(player, message);
                    return;
                case GameRequest.UseCard:
                    await engine.RequestUseCardAsync(player, message);
                    return;
                case GameRequest.NextTurn:
                    await engine.RequestNextTurnAsync(player);
                    return;
                case GameRequest.Mulligan:
                    await engine.RequestMulliganAsync(player, message);
                    return;
                case GameRequest.MoveCard:
                    engine.RequestMoveCard(player, message);
                    return;
                case GameRequest.ReleaseCard:
                    engine.RequestReleaseCard(player, message);
                    return;
                case GameRequest.UseAbility:
                    await engine.RequestUseAbilityAsync(player, message);
                    return;
                case GameRequest.HeroPower:
                    await engine.RequestHeroPowerAsync(player, message);
                    return;
                case GameRequest.ListLiveGames:
                    engine.ListLiveGames(player);
                    return;
                case GameRequest.Spectate:
                    engine.Spectate(player, message.GetInt("gameId"));
                    return;
                case GameRequest.StopSpectating:
                    engine.StopSpectating(player);
                    return;
                case GameRequest.Emote:
                    engine.RequestEmote(player, message.GetInt("emote"));
                    return;
                case GameRequest.MuteEmotes:
                    GameEngine.MuteEmotes(player, message.GetBool("muted"));
                    return;
                case GameRequest.Challenge:
                    engine.RequestChallenge(player, message.GetString("name", 64));
                    return;
                case GameRequest.ChallengeAnswer:
                    engine.AnswerChallenge(player, message.GetBool("accept"));
                    return;
                case GameRequest.ChallengeCancel:
                    engine.CancelChallenge(player);
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
            connection.Send(new Response(ServiceResponse.LoginOk, new GameText("service.loggedIn", ("name", existing.Name))));
            return;
        }

        var player = await players.LoadPlayerAsync(user.Id);
        if (player is null)
        {
            connection.Send(new Response(ServiceResponse.LoginNotLoggedIn, new GameText("service.pleaseLogin")));
            connection.Close("Not logged in");
            return;
        }

        player.GameContext = connection;
        state.GameClients[connection] = player;
        connection.LoggedIn = true;
        connection.Send(new Response(ServiceResponse.LoginOk, new GameText("service.loggedIn", ("name", player.Name))));
        logger.LogInformation("{Player} logged in to the game server ({Online} online)", player.Name, state.GameClients.Count);
    }

    private async Task LogoutAsync(Connection connection)
    {
        if (!state.GameClients.TryGetValue(connection, out var player))
        {
            return;
        }

        engine.RemoveFromQueues(player);
        engine.DropChallenge(player, new GameText("challenge.left", ("name", player.Name)));
        await engine.ForfeitAsync(player);
        state.GameClients.Remove(connection);
        connection.LoggedIn = false;
        connection.Send(new Response(ServiceResponse.Disconnected, new GameText("service.loggedOut")));
    }

    public async Task OnDisconnectedAsync(Connection connection)
    {
        // A stopping server closes every socket; the players' games wait for them in the next instance.
        if (state.ShuttingDown || !state.GameClients.TryGetValue(connection, out var player) || player.GameContext != connection)
        {
            return;
        }

        engine.RemoveFromQueues(player);
        engine.StopSpectating(player);
        engine.DropChallenge(player, new GameText("challenge.left", ("name", player.Name)));
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
