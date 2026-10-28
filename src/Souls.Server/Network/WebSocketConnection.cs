using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;
using System.Threading.RateLimiting;

namespace Souls.Server.Network;

public sealed class WebSocketOptionsConfig
{
    /// <summary>Largest accepted client message. Legacy messages are well below 1 KB.</summary>
    public int MaxMessageBytes { get; set; } = 16 * 1024;

    /// <summary>Outbound messages buffered per client before it is considered too slow and dropped.</summary>
    public int MaxQueuedMessages { get; set; } = 1024;

    /// <summary>Sustained messages per second a client may send (card drags send ~5/s).</summary>
    public int MessagesPerSecond { get; set; } = 30;

    public int MessageBurst { get; set; } = 60;
}

/// <summary>
/// A browser connection. Reads are processed one at a time; writes go through a bounded queue drained by a
/// single writer task, because <see cref="WebSocket"/> does not allow concurrent sends.
/// </summary>
public sealed class WebSocketConnection : Connection, IDisposable
{
    private readonly WebSocket _socket;
    private readonly ILogger _logger;
    private readonly WebSocketOptionsConfig _options;
    private readonly Channel<string> _outbox;
    private readonly TokenBucketRateLimiter _rateLimiter;
    private string _closeReason = "Closed by server";

    public WebSocketConnection(WebSocket socket, WebSocketOptionsConfig options, ILogger logger)
    {
        _socket = socket;
        _options = options;
        _logger = logger;
        _outbox = Channel.CreateBounded<string>(new BoundedChannelOptions(options.MaxQueuedMessages)
        {
            SingleReader = true,
            FullMode = BoundedChannelFullMode.Wait,
        });
        _rateLimiter = new TokenBucketRateLimiter(new TokenBucketRateLimiterOptions
        {
            TokenLimit = options.MessageBurst,
            TokensPerPeriod = options.MessagesPerSecond,
            ReplenishmentPeriod = TimeSpan.FromSeconds(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        });
    }

    public override bool IsOpen => _socket.State == WebSocketState.Open;

    public override void Send(Response response)
    {
        if (!_outbox.Writer.TryWrite(response.ToJson()))
        {
            // Either closed already or the client is not reading: drop it rather than buffering forever.
            if (_outbox.Writer.TryComplete())
            {
                _closeReason = "Client too slow";
                _logger.LogWarning("Dropping {Connection}: outbound queue is full", this);
            }
        }
    }

    public override void Close(string reason)
    {
        _closeReason = reason;
        _outbox.Writer.TryComplete();
    }

    /// <summary>Runs until the client disconnects. Each complete text message is handed to <paramref name="onMessage"/>.</summary>
    public async Task RunAsync(Func<Message, Task> onMessage, CancellationToken ct)
    {
        var writer = WriteLoopAsync(ct);
        var buffer = ArrayPool<byte>.Shared.Rent(_options.MaxMessageBytes);
        try
        {
            while (_socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var length = 0;
                ValueWebSocketReceiveResult result;
                do
                {
                    if (length == _options.MaxMessageBytes)
                    {
                        await CloseAsync(WebSocketCloseStatus.MessageTooBig, "Message too big");
                        return;
                    }

                    result = await _socket.ReceiveAsync(buffer.AsMemory(length, _options.MaxMessageBytes - length), ct);
                    length += result.Count;
                }
                while (!result.EndOfMessage && result.MessageType != WebSocketMessageType.Close);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                if (result.MessageType != WebSocketMessageType.Text)
                {
                    await CloseAsync(WebSocketCloseStatus.InvalidMessageType, "Text messages only");
                    return;
                }

                using var lease = _rateLimiter.AttemptAcquire();
                if (!lease.IsAcquired)
                {
                    _logger.LogDebug("Rate limit exceeded by {Connection}, message dropped", this);
                    continue;
                }

                Message message;
                try
                {
                    message = Message.Parse(Encoding.UTF8.GetString(buffer, 0, length));
                }
                catch (ProtocolException e)
                {
                    Send(new Response(ServiceResponse.Error, e.Message));
                    continue;
                }

                await onMessage(message);
            }
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
            _logger.LogDebug(e, "{Connection} dropped", this);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
            _outbox.Writer.TryComplete();
            await writer;
        }
    }

    private async Task WriteLoopAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var json in _outbox.Reader.ReadAllAsync(ct))
            {
                if (_socket.State != WebSocketState.Open)
                {
                    break;
                }

                await _socket.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, endOfMessage: true, ct);
            }

            await CloseAsync(WebSocketCloseStatus.NormalClosure, _closeReason);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
            _logger.LogDebug(e, "Write to {Connection} failed", this);
        }
    }

    private async Task CloseAsync(WebSocketCloseStatus status, string reason)
    {
        if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await _socket.CloseOutputAsync(status, reason, timeout.Token);
            }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException)
            {
                _logger.LogDebug(e, "Closing {Connection} failed", this);
            }
        }
    }

    public void Dispose() => _rateLimiter.Dispose();
}
