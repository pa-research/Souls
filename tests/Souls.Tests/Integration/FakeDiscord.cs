using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;

namespace Souls.Tests.Integration;

/// <summary>
/// Discord's API as the Activity's sign-in uses it (<c>POST oauth2/token</c>, <c>GET users/@me</c>), for codes the
/// tests hand out with <see cref="Authorize"/>.
/// </summary>
public sealed class FakeDiscord : HttpMessageHandler
{
    public const string ClientId = "1100000000000000001";
    public const string ClientSecret = "test-client-secret";
    public const string ActivityHost = "discord.souls.test";

    private static readonly ConcurrentDictionary<string, (string Id, string Username)> Users = new();

    /// <summary>An authorization code for the Discord account <paramref name="id"/>, as the Embedded App SDK would get one.</summary>
    public static string Authorize(string id, string username)
    {
        var code = "code-" + Guid.NewGuid().ToString("N");
        Users[code] = (id, username);
        return code;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (request.Method == HttpMethod.Post && path.EndsWith("/oauth2/token", StringComparison.Ordinal))
        {
            var form = (await request.Content!.ReadAsStringAsync(cancellationToken)).Split('&').Select(p => p.Split('=', 2))
                .ToDictionary(p => Uri.UnescapeDataString(p[0]), p => Uri.UnescapeDataString(p[1]));
            return form["client_id"] == ClientId && form["client_secret"] == ClientSecret && Users.ContainsKey(form["code"])
                ? Json(new { access_token = "token-" + form["code"], token_type = "Bearer" })
                : new HttpResponseMessage(HttpStatusCode.BadRequest);
        }

        if (request.Method == HttpMethod.Get && path.EndsWith("/users/@me", StringComparison.Ordinal)
            && request.Headers.Authorization is { Scheme: "Bearer", Parameter: { } token } && token.StartsWith("token-", StringComparison.Ordinal)
            && Users.TryGetValue(token["token-".Length..], out var user))
        {
            return Json(new { id = user.Id, username = user.Username, global_name = (string?)null });
        }

        return new HttpResponseMessage(HttpStatusCode.Unauthorized);
    }

    private static HttpResponseMessage Json(object value) =>
        new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json") };
}
