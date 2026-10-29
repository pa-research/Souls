namespace Souls.Web.Services;

/// <summary>
/// Adds a strict Content-Security-Policy and the usual hardening headers. Pages contain no inline scripts,
/// so scripts are limited to this origin.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next, IConfiguration configuration)
{
    private readonly string? _gameServerOrigin = GetOrigin(configuration["Souls:GameServerUrl"]);
    private readonly string? _githubApi = string.IsNullOrWhiteSpace(configuration["Souls:GitHubRepository"]) ? null : "https://api.github.com";

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            var host = context.Request.Host.Value;
            var connect = $"'self' wss://{host}" + (context.Request.IsHttps ? string.Empty : $" ws://{host}")
                + (_gameServerOrigin is null ? string.Empty : $" {_gameServerOrigin}")
                + (_githubApi is null ? string.Empty : $" {_githubApi}");

            headers.ContentSecurityPolicy =
                "default-src 'self'; " +
                "script-src 'self'; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob:; " +
                "font-src 'self'; " +
                "media-src 'self' data: blob:; " +
                $"connect-src {connect}; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "frame-ancestors 'none'" +
                (context.Request.IsHttps ? "; upgrade-insecure-requests" : string.Empty);
            headers.XContentTypeOptions = "nosniff";
            headers.XFrameOptions = "DENY";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            return Task.CompletedTask;
        });

        return next(context);
    }

    private static string? GetOrigin(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "ws" or "wss" ? $"{uri.Scheme}://{uri.Authority}" : null;
}
