namespace Souls.Server.Network;

/// <summary>
/// Protects against cross-site WebSocket hijacking: since connections are authenticated with the session
/// cookie, a browser handshake must come from the site itself. Configure <c>Souls:AllowedOrigins</c> (comma
/// separated) when the site is served from another origin than the game server sees in the Host header.
/// </summary>
public sealed class OriginPolicy(IConfiguration configuration)
{
    private readonly HashSet<string> _allowed = new(
        (configuration["Souls:AllowedOrigins"] ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(o => o.TrimEnd('/')),
        StringComparer.OrdinalIgnoreCase);

    public bool IsAllowed(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
        {
            // Not a browser: cross-site hijacking requires a browser, and the session cookie is still required.
            return true;
        }

        if (_allowed.Count > 0)
        {
            return _allowed.Contains(origin);
        }

        // Some proxies (e.g. Traefik) forward WebSocket upgrades with X-Forwarded-Proto ws/wss.
        var scheme = context.Request.Scheme switch
        {
            "ws" => "http",
            "wss" => "https",
            var other => other,
        };
        return string.Equals(origin, $"{scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase);
    }
}
