using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Souls.Tests.Integration;

/// <summary>
/// The Discord Activity: served only on its own host, with the cookies and framing an iframe in Discord needs; a
/// Discord account signs up (hero and starter cards, no password) and later signs straight in; the game server takes
/// sockets from Discord's proxy.
/// </summary>
[Collection(SoulsCollection.Name)]
public partial class DiscordActivityTests(SoulsAppFixture app)
{
    [Fact]
    public async Task TheActivityIsOnlyOnItsHost()
    {
        using var site = app.CreateBrowser();
        using var notHere = await site.GetAsync("/Discord");
        Assert.Equal(HttpStatusCode.NotFound, notHere.StatusCode);
        Assert.Contains("frame-ancestors 'none'", notHere.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);

        using var discord = app.CreateDiscordBrowser();
        // Discord opens the Activity at the root, with its launch parameters.
        using var launch = await discord.GetAsync("/?frame_id=f1&instance_id=i1&platform=desktop");
        Assert.Equal(HttpStatusCode.Redirect, launch.StatusCode);
        Assert.Equal("/Discord?frame_id=f1&instance_id=i1&platform=desktop", launch.Headers.Location!.ToString());

        using var start = await discord.GetAsync("/Discord");
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
        var csp = start.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com", csp, StringComparison.Ordinal);
        Assert.Contains($"wss://{FakeDiscord.ClientId}.discordsays.com", csp, StringComparison.Ordinal);
        Assert.False(start.Headers.Contains("X-Frame-Options"));
        Assert.Contains($"data-client-id=\"{FakeDiscord.ClientId}\"", await start.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // The antiforgery cookie, as an iframe on another site needs it.
        var cookie = start.Headers.GetValues("Set-Cookie").Single(c => c.Contains("csrf", StringComparison.Ordinal));
        Assert.Contains("samesite=none", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("partitioned", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ADiscordAccountSignsUpThenSignsIn()
    {
        var discordId = Random.Shared.NextInt64(1, long.MaxValue).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var username = "d" + Guid.NewGuid().ToString("N")[..8] + ".x";

        // First time: no player yet, so the page goes on to the sign-up.
        using (var discord = app.CreateDiscordBrowser())
        {
            var next = await SignInAsync(discord, FakeDiscord.Authorize(discordId, username));
            Assert.Equal("/Discord/Join", next);

            using var join = await discord.GetAsync(next);
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            var html = await join.Content.ReadAsStringAsync();
            var suggested = username.Replace('.', '_');
            Assert.Contains($"value=\"{suggested}\"", html, StringComparison.Ordinal);
            Assert.DoesNotContain("Form_Password", html, StringComparison.Ordinal);

            using var created = await discord.PostFormAsync("/Discord/Join", "/Discord/Join",
            [
                new("Form.Username", suggested),
                new("Form.PlayerType", "1"),
                .. new[] { 5, 6, 20, 23, 31 }.Select(c => new KeyValuePair<string, string>("Form.Cards", c.ToString(System.Globalization.CultureInfo.InvariantCulture))),
            ]);
            Assert.Equal(HttpStatusCode.Redirect, created.StatusCode);
            Assert.Equal("/Game?mode=3d", created.Headers.Location!.ToString());
            Assert.NotNull(discord.AuthCookie);
            Assert.Contains("partitioned", created.Headers.GetValues("Set-Cookie").Single(c => c.Contains("souls=", StringComparison.Ordinal)), StringComparison.OrdinalIgnoreCase);

            using var game = await discord.GetAsync("/Game?mode=3d");
            Assert.Equal(HttpStatusCode.OK, game.StatusCode);

            var player = await app.WithDbAsync(db => db.Players.SingleAsync(p => p.DiscordId == discordId));
            Assert.Equal(suggested, player.Name);
            Assert.Equal(5, await app.WithDbAsync(db => db.PlayerCards.CountAsync(c => c.PlayerId == player.Id)));
        }

        // Next time: straight into the game.
        using (var discord = app.CreateDiscordBrowser())
        {
            var next = await SignInAsync(discord, FakeDiscord.Authorize(discordId, username));
            Assert.Equal("/Game?mode=3d", next);
            Assert.NotNull(discord.AuthCookie);
        }
    }

    [Fact]
    public async Task ACodeDiscordRefusesSignsNobodyIn()
    {
        using var discord = app.CreateDiscordBrowser();
        using var response = await PostTokenAsync(discord, "not-a-code");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(discord.AuthCookie);
    }

    [Fact]
    public async Task TheGameServerTakesSocketsFromDiscordsProxy()
    {
        using var discord = app.CreateDiscordBrowser();
        Assert.Equal("/Game?mode=3d", await SignUpAsync(discord));
        await using var socket = await GameSocket.ConnectAsync(app.Server, "ws/game", discord.AuthCookie, origin: $"https://{FakeDiscord.ClientId}.discordsays.com");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            GameSocket.ConnectAsync(app.Server, "ws/game", discord.AuthCookie, origin: "https://999.discordsays.com"));
        Assert.Contains("403", error.Message, StringComparison.Ordinal);
    }

    /// <summary>A new Discord account through the sign-up; the page the sign-up sends it to.</summary>
    private async Task<string> SignUpAsync(TestBrowser discord)
    {
        var id = Random.Shared.NextInt64(1, long.MaxValue).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var name = "d" + Guid.NewGuid().ToString("N")[..10];
        Assert.Equal("/Discord/Join", await SignInAsync(discord, FakeDiscord.Authorize(id, name)));
        using var created = await discord.PostFormAsync("/Discord/Join", "/Discord/Join",
        [
            new("Form.Username", name),
            new("Form.PlayerType", "1"),
            .. new[] { 5, 6, 20, 23, 31 }.Select(c => new KeyValuePair<string, string>("Form.Cards", c.ToString(System.Globalization.CultureInfo.InvariantCulture))),
        ]);
        return created.Headers.Location!.ToString();
    }

    /// <summary>What the start page's script does with the SDK's code; the page it goes to next.</summary>
    private static async Task<string> SignInAsync(TestBrowser discord, string code)
    {
        using var response = await PostTokenAsync(discord, code);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("next").GetString()!;
    }

    private static async Task<HttpResponseMessage> PostTokenAsync(TestBrowser discord, string code)
    {
        using var start = await discord.GetAsync("/Discord");
        var csrf = CsrfPattern().Match(await start.Content.ReadAsStringAsync()).Groups[1].Value;
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Discord/Token")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { code }), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf);
        return await discord.SendAsync(request);
    }

    [GeneratedRegex("data-csrf=\"([^\"]+)\"")]
    private static partial Regex CsrfPattern();
}
