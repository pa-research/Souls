using System.Security.Claims;
using Souls.Model.Security;

namespace Souls.Server.Network;

public enum ServiceKind
{
    Game,
    Chat,
    Admin,
}

/// <summary>A client connected to one of the services: a browser WebSocket or the in-process bot.</summary>
public abstract class Connection
{
    private static long _nextId;

    public long Id { get; } = Interlocked.Increment(ref _nextId);

    public required ServiceKind Kind { get; init; }

    /// <summary>The authenticated account, or <c>null</c> for the practice bot.</summary>
    public SessionPlayer? User { get; init; }

    /// <summary>The cookie principal the connection was opened with, re-validated periodically.</summary>
    public ClaimsPrincipal? Principal { get; init; }

    /// <summary>Set once the client sent its LOGIN message (kept for protocol compatibility).</summary>
    public bool LoggedIn { get; set; }

    public abstract bool IsOpen { get; }

    /// <summary>Queues a message for the client. Never blocks.</summary>
    public abstract void Send(Response response);

    /// <summary>Closes the connection after already queued messages are sent.</summary>
    public abstract void Close(string reason);

    public override string ToString() => $"{Kind}#{Id}({User?.Name ?? "bot"})";
}
