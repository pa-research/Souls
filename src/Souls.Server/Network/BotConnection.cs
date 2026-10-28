using System.Threading.Channels;

namespace Souls.Server.Network;

/// <summary>In-memory connection used by the practice bot. Messages sent to it are delivered to the AI.</summary>
public sealed class BotConnection : Connection
{
    private readonly Channel<string> _inbox = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    public override bool IsOpen => !_inbox.Reader.Completion.IsCompleted;

    public ChannelReader<string> Inbox => _inbox.Reader;

    public override void Send(Response response) => _inbox.Writer.TryWrite(response.ToJson());

    public override void Close(string reason) => _inbox.Writer.TryComplete();
}
