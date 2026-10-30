using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Souls.Server;

namespace Souls.Tests.Integration;

/// <summary>A test client for the game server's WebSocket endpoints.</summary>
public sealed class GameSocket : IAsyncDisposable
{
    private readonly WebSocket _socket;

    private GameSocket(WebSocket socket) => _socket = socket;

    public List<JsonNode> Received { get; } = [];

    public WebSocketState State => _socket.State;

    public static async Task<GameSocket> ConnectAsync(WebApplicationFactory<ServerAssemblyMarker> server, string path, string? cookie, string? origin = null)
    {
        var client = server.Server.CreateWebSocketClient();
        client.ConfigureRequest = request =>
        {
            if (cookie is not null)
            {
                request.Headers.Cookie = cookie;
            }

            if (origin is not null)
            {
                request.Headers.Origin = origin;
            }
        };
        var socket = await client.ConnectAsync(new Uri(server.Server.BaseAddress, path), CancellationToken.None);
        return new GameSocket(socket);
    }

    public Task SendAsync(int type, JsonObject? payload = null) =>
        SendRawAsync(new JsonObject { ["Type"] = type, ["Payload"] = payload ?? [] }.ToJsonString());

    public Task SendRawAsync(string text) =>
        _socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

    /// <summary>Reads messages until one matches; fails after <paramref name="seconds"/>.</summary>
    public async Task<JsonNode> ReceiveAsync(Func<JsonNode, bool> match, int seconds = 15)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var length = 0;
            ValueWebSocketReceiveResult result;
            do
            {
                result = await _socket.ReceiveAsync(buffer.AsMemory(length), timeout.Token);
                length += result.Count;
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new WebSocketException($"Closed by server: {_socket.CloseStatusDescription}");
            }

            var message = JsonNode.Parse(Encoding.UTF8.GetString(buffer, 0, length))!;
            Received.Add(message);
            if (match(message))
            {
                return message;
            }
        }
    }

    public Task<JsonNode> ReceiveTypeAsync(params int[] types) => ReceiveAsync(m => types.Contains((int)m["Type"]!));

    /// <summary>Waits until the server closes the connection.</summary>
    public async Task<bool> WaitForCloseAsync(int seconds = 15)
    {
        try
        {
            await ReceiveAsync(_ => false, seconds);
        }
        catch (WebSocketException)
        {
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }

        return false;
    }

    public async ValueTask DisposeAsync()
    {
        if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch (WebSocketException)
            {
            }
        }

        _socket.Dispose();
    }
}
