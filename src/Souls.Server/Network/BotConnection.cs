using System.Threading.Channels;

namespace Souls.Server.Network;

/// <summary>In-memory connection used by the practice bot. Messages sent to it are delivered to the AI.</summary>
public sealed class BotConnection : Connection
{
    // Not SingleReader: that channel type cannot count its items, and the bot uses the count to know when it has
    // read everything the server sent.
    // The bot reads the messages themselves: no JSON text in between.
    private readonly Channel<Response> _inbox = Channel.CreateUnbounded<Response>();

    public override bool IsOpen => !_inbox.Reader.Completion.IsCompleted;

    public ChannelReader<Response> Inbox => _inbox.Reader;

    /// <summary>When set, every message sent to the bot is also added here (the simulator's --trace).</summary>
    public List<string>? Transcript { get; set; }

    public override void Send(Response response)
    {
        Transcript?.Add(response.ToJson());
        _inbox.Writer.TryWrite(response);
    }

    public override void Close(string reason) => _inbox.Writer.TryComplete();
}
