using Microsoft.Extensions.Options;
using Souls.Model.Security;
using Souls.Server.Game;

namespace Souls.Server.Network;

public static class WebSocketEndpoints
{
    public static IEndpointRouteBuilder MapSoulsWebSockets(this IEndpointRouteBuilder endpoints)
    {
        endpoints.Map("/ws/game", context => HandleAsync(context, ServiceKind.Game));
        endpoints.Map("/ws/chat", context => HandleAsync(context, ServiceKind.Chat));
        endpoints.Map("/ws/admin", context => HandleAsync(context, ServiceKind.Admin));
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
        var stopping = services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping;

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var connection = new WebSocketConnection(socket, services.GetRequiredService<IOptions<WebSocketOptionsConfig>>().Value, logger)
        {
            Kind = kind,
            User = user,
            Principal = context.User,
        };
        using var aborted = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);

        registry.Add(connection);
        logger.LogDebug("{Connection} connected", connection);
        try
        {
            await connection.RunAsync(message => state.RunExclusiveAsync(() => ProcessAsync(service, connection, message, logger)), aborted.Token);
        }
        finally
        {
            registry.Remove(connection);
            await state.RunExclusiveAsync(() => service.OnDisconnectedAsync(connection));
            logger.LogDebug("{Connection} disconnected", connection);
        }
    }

    internal static async Task ProcessAsync(IClientService service, Connection connection, Message message, ILogger logger)
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
            connection.Send(new Response(ServiceResponse.Error, "Internal server error"));
        }
    }
}
