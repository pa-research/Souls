using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Souls.Tests.Integration;

/// <summary>
/// Discord's API as Souls uses it: OAuth2 codes the tests hand out with <see cref="Authorize"/> (token, refresh, the
/// user), the linked role, the registration of the linked roles and the command, and channel webhooks. Every request
/// is recorded in <see cref="Requests"/>; <see cref="Sign"/> signs interactions with the application's key.
/// </summary>
public sealed class FakeDiscord : HttpMessageHandler
{
    public const string ClientId = "1100000000000000001";
    public const string ClientSecret = "test-client-secret";
    public const string BotToken = "test-bot-token";
    public const string ActivityHost = "discord.souls.test";
    public const string SeasonWebhook = "https://discord.test/api/webhooks/1/season";

    private static readonly Ed25519PrivateKeyParameters Key = new(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray(), 0);
    public static readonly string PublicKey = Convert.ToHexString(Key.GeneratePublicKey().GetEncoded()).ToLowerInvariant();

    private static readonly ConcurrentDictionary<string, (string Id, string Username)> Users = new();

    public sealed record Request(string Method, string Path, string? Authorization, string Body);

    public static ConcurrentQueue<Request> Requests { get; } = new();

    /// <summary>An authorization code for the Discord account <paramref name="id"/>, as the SDK or OAuth2 would get one.</summary>
    public static string Authorize(string id, string username)
    {
        var code = "code-" + Guid.NewGuid().ToString("N");
        Users[code] = (id, username);
        return code;
    }

    /// <summary>The <c>X-Signature-Ed25519</c> Discord sends with an interaction.</summary>
    public static string Sign(string timestamp, string body)
    {
        var signer = new Ed25519Signer();
        signer.Init(true, Key);
        var message = Encoding.UTF8.GetBytes(timestamp + body);
        signer.BlockUpdate(message, 0, message.Length);
        return Convert.ToHexString(signer.GenerateSignature()).ToLowerInvariant();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Enqueue(new Request(request.Method.Method, path, request.Headers.Authorization?.ToString(), body));

        if (request.Method == HttpMethod.Post && path.EndsWith("/oauth2/token", StringComparison.Ordinal))
        {
            var form = body.Split('&').Select(p => p.Split('=', 2)).ToDictionary(p => Uri.UnescapeDataString(p[0]), p => Uri.UnescapeDataString(p[1].Replace('+', ' ')));
            if (form["client_id"] != ClientId || form["client_secret"] != ClientSecret)
            {
                return new HttpResponseMessage(HttpStatusCode.Unauthorized);
            }

            var code = form["grant_type"] == "refresh_token" ? form["refresh_token"]["refresh-".Length..] : form["code"];
            return Users.ContainsKey(code)
                ? Json(new { access_token = "token-" + code, refresh_token = "refresh-" + code, expires_in = 604800, token_type = "Bearer" })
                : new HttpResponseMessage(HttpStatusCode.BadRequest);
        }

        if (request.Headers.Authorization is { Scheme: "Bearer", Parameter: { } token } && token.StartsWith("token-", StringComparison.Ordinal)
            && Users.TryGetValue(token["token-".Length..], out var user))
        {
            if (request.Method == HttpMethod.Get && path.EndsWith("/users/@me", StringComparison.Ordinal))
            {
                return Json(new { id = user.Id, username = user.Username, global_name = (string?)null });
            }

            if (request.Method == HttpMethod.Put && path.EndsWith($"/users/@me/applications/{ClientId}/role-connection", StringComparison.Ordinal))
            {
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            }
        }

        if (request.Headers.Authorization?.ToString() == $"Bot {BotToken}" && path.Contains($"/applications/{ClientId}/", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }

        if (request.Method == HttpMethod.Post && request.RequestUri.ToString() == SeasonWebhook)
        {
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }

        return new HttpResponseMessage(HttpStatusCode.Unauthorized);
    }

    private static HttpResponseMessage Json(object value) =>
        new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };
}
