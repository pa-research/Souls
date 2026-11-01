using System.Threading.Channels;

namespace Souls.Server.Network;

/// <summary>In-memory connection used by the practice bot. Messages sent to it are delivered to the AI.</summary>
public sealed class BotConnection : Connection
{
    // Not SingleReader: that channel type cannot count its items, and the bot uses the count to know when it has
    // read everything the server sent.
    private readonly Channel<string> _inbox = Channel.CreateUnbounded<string>();

    public override bool IsOpen => !_inbox.Reader.Completion.IsCompleted;

    public ChannelReader<string> Inbox => _inbox.Reader;

    /// <summary>When set, every message sent to the bot is also added here (the simulator's --trace).</summary>
    public List<string>? Transcript { get; set; }

    public override void Send(Response response)
    {
        var json = response.ToJson();
        Transcript?.Add(json);
        _inbox.Writer.TryWrite(json);
    }

    public override void Close(string reason) => _inbox.Writer.TryComplete();
}
