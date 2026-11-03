using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Primitives;

namespace Souls.Web.Services;

/// <summary>
/// Souls as a Discord Activity: Discord shows the game in an iframe on <c>{client id}.discordsays.com</c> and proxies
/// it to <c>Souls:Discord:ActivityHost</c>, a host name of its own, so the rules an iframe needs (cookies
/// <c>SameSite=None; Partitioned</c>, framing by Discord) never apply to the site itself. Players sign in with Discord:
/// the Embedded App SDK gives the page an OAuth2 code, which is exchanged here with the client secret
/// (<c>Souls:Discord:ClientId</c>, <c>Souls:Discord:ClientSecret</c>).
/// </summary>
public sealed class DiscordActivity(IConfiguration configuration, IHttpClientFactory http)
{
    public const string HttpClientName = "discord";

    /// <summary>Who may frame the Activity: Discord's web and desktop clients and its Activity proxy.</summary>
    public const string FrameAncestors = "https://discord.com https://*.discord.com https://*.discordsays.com";

    public string? ClientId => configuration["Souls:Discord:ClientId"];

    private string? ActivityHost => configuration["Souls:Discord:ActivityHost"];

    public bool Enabled => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(configuration["Souls:Discord:ClientSecret"])
        && !string.IsNullOrWhiteSpace(ActivityHost);

    /// <summary>The page's origin inside Discord (the proxy's).</summary>
    public string? ProxyOrigin => Enabled ? $"https://{ClientId}.discordsays.com" : null;

    public bool IsActivityRequest(HttpContext context) =>
        Enabled && string.Equals(context.Request.Host.Host, ActivityHost, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The cookies of an Activity response, as an iframe needs them: <c>SameSite=None</c> (browsers drop stricter cookies
    /// in a cross-site iframe) and <c>Partitioned</c> (kept for Discord's iframes only).
    /// </summary>
    public static void RelaxCookies(IHeaderDictionary headers)
    {
        var cookies = headers.SetCookie;
        if (cookies.Count == 0)
        {
            return;
        }

        headers.SetCookie = new StringValues([.. cookies.Select(c => RelaxCookie(c!))]);
    }

    private static string RelaxCookie(string cookie)
    {
        var parts = cookie.Split(';', StringSplitOptions.TrimEntries)
            .Where(p => !p.StartsWith("samesite=", StringComparison.OrdinalIgnoreCase) && !p.Equals("partitioned", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (!parts.Any(p => p.Equals("secure", StringComparison.OrdinalIgnoreCase)))
        {
            parts.Add("secure");
        }

        parts.Add("samesite=none");
        parts.Add("partitioned");
        return string.Join("; ", parts);
    }

    /// <summary>Exchanges the SDK's authorization code for the Discord user; <c>null</c> if Discord refuses it.</summary>
    public async Task<DiscordUser?> SignInAsync(string code, CancellationToken ct)
    {
        var client = http.CreateClient(HttpClientName);
        using var tokenResponse = await client.PostAsync("oauth2/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = ClientId!,
            ["client_secret"] = configuration["Souls:Discord:ClientSecret"]!,
            ["grant_type"] = "authorization_code",
            ["code"] = code,
        }), ct);
        if (!tokenResponse.IsSuccessStatusCode || await tokenResponse.Content.ReadFromJsonAsync<TokenResponse>(ct) is not { AccessToken: { Length: > 0 } token })
        {
            return null;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, "users/@me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var userResponse = await client.SendAsync(request, ct);
        return userResponse.IsSuccessStatusCode && await userResponse.Content.ReadFromJsonAsync<DiscordUser>(ct) is { Id: { Length: > 0 } } user ? user : null;
    }

    private sealed record TokenResponse([property: JsonPropertyName("access_token")] string? AccessToken);
}

/// <summary>A Discord account (the fields of <c>GET /users/@me</c> the game uses).</summary>
public sealed record DiscordUser(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("global_name")] string? GlobalName);
