using Microsoft.Extensions.Options;
using Souls.Model.Security;
using Souls.Server.Game;

namespace Souls.Server.Network;

public static class WebSocketEndpoints
{
    public static IEndpointRouteBuilder MapSoulsWebSockets(this IEndpointRouteBuilder endpoints)
    {
        // A WebSocket request lasts as long as the connection; it would distort the HTTP request durations.
        endpoints.Map("/ws/game", context => HandleAsync(context, ServiceKind.Game)).DisableHttpMetrics();
        endpoints.Map("/ws/chat", context => HandleAsync(context, ServiceKind.Chat)).DisableHttpMetrics();
        endpoints.Map("/ws/admin", context => HandleAsync(context, ServiceKind.Admin)).DisableHttpMetrics();
        return endpoints;
    }

    private static async Task HandleAsync(HttpContext context, ServiceKind kind)
    {
        var services = context.RequestServices;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("Souls.Server.WebSockets");

        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        if (!services.GetRequiredService<OriginPolicy>().IsAllowed(context))
        {
            logger.LogWarning("Rejected WebSocket from origin {Origin}", context.Request.Headers.Origin.ToString());
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var user = await services.GetRequiredService<SessionService>().ValidateAsync(context.User, context.RequestAborted);
        if (user is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (kind == ServiceKind.Admin && !user.IsAdmin)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        IClientService service = kind switch
        {
            ServiceKind.Game => services.GetRequiredService<GameService>(),
            ServiceKind.Chat => services.GetRequiredService<ChatService>(),
            _ => services.GetRequiredService<AdminService>(),
        };
        var state = services.GetRequiredService<ServerState>();
        var registry = services.GetRequiredService<ConnectionRegistry>();
        var metrics = services.GetRequiredService<GameMetrics>();

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var connection = new WebSocketConnection(socket, services.GetRequiredService<IOptions<WebSocketOptionsConfig>>().Value, logger)
        {
            Kind = kind,
            User = user,
            Principal = context.User,
        };

        // A stopping server closes the connections itself (see Matchmaker.StoppingAsync), after saving the games, so
        // the connection does not end with the application; one that arrives while it stops is closed at once.
        registry.Add(connection);
        if (state.ShuttingDown)
        {
            connection.Close(Matchmaker.RestartReason);
        }

        metrics.ConnectionOpened(kind);
        logger.LogDebug("{Connection} connected", connection);
        try
        {
            await connection.RunAsync(message => state.RunExclusiveAsync(() => ProcessAsync(service, connection, message, logger, metrics)), context.RequestAborted);
        }
        finally
        {
            registry.Remove(connection);
            metrics.ConnectionClosed(kind);
            await state.RunExclusiveAsync(() => service.OnDisconnectedAsync(connection));
            logger.LogDebug("{Connection} disconnected", connection);
        }
    }

    internal static async Task ProcessAsync(IClientService service, Connection connection, Message message, ILogger logger, GameMetrics metrics)
    {
        try
        {
            await service.ProcessAsync(connection, message);
        }
        catch (ProtocolException e)
        {
            connection.Send(new Response(ServiceResponse.Error, e.Message));
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Failed to process message {Type} from {Connection}", message.Type, connection);
            metrics.Error("message");
            connection.Send(new Response(ServiceResponse.Error, "Internal server error"));
        }
    }
}
