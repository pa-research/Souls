namespace Souls.Server.Network;

/// <summary>Handles the messages of one WebSocket endpoint. Called while holding the server state lock.</summary>
public interface IClientService
{
    Task ProcessAsync(Connection connection, Message message);

    Task OnDisconnectedAsync(Connection connection);
}
