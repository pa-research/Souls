using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Souls.Server.Game;
using Souls.Web.Services;

namespace Souls.Tests.Integration;

/// <summary>
/// The Discord Activity: served only on its own host, with the cookies and framing an iframe in Discord needs; a
/// Discord account signs up (hero and starter cards, no password) and later signs straight in; the game server takes
/// sockets from Discord's proxy; the channel's players show with their Souls names. The league: Linked Roles (linking a
/// site player, then following its rank), the signed <c>/souls</c> command, their registration at start, and season
/// results posted to a channel.
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

    [Fact]
    public async Task TheChannelsPlayersShowWithTheirSoulsNames()
    {
        using var discord = app.CreateDiscordBrowser();
        Assert.Equal("/Game?mode=3d", await SignUpAsync(discord));
        var (id, name) = await NewestDiscordPlayerAsync();

        using var response = await discord.GetAsync($"/Discord/Players?ids={id},42");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var names = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.Equal(name, (string?)names[id]);
        Assert.False(names.ContainsKey("42"));

        // Not on the site, and not without a login.
        using var site = app.CreateBrowser();
        using var onSite = await site.GetAsync($"/Discord/Players?ids={id}");
        Assert.Equal(HttpStatusCode.NotFound, onSite.StatusCode);
        using var anonymous = app.CreateDiscordBrowser();
        using var withoutLogin = await anonymous.GetAsync($"/Discord/Players?ids={id}");
        Assert.Equal(HttpStatusCode.NotFound, withoutLogin.StatusCode);
    }

    [Fact]
    public async Task LinkedRolesShowASitePlayersRankAndFollowIt()
    {
        var name = "l" + Guid.NewGuid().ToString("N")[..10];
        using var site = app.CreateBrowser();
        await site.RegisterAsync(name, "CorrectHorse9!");
        using (await site.LoginAsync(name, "CorrectHorse9!"))
        {
        }

        // From a server's Linked Roles to Discord's consent page, and back with a code.
        using var start = await site.GetAsync("/Discord/LinkedRole");
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var authorize = start.Headers.Location!;
        Assert.StartsWith("https://discord.com/oauth2/authorize?", authorize.ToString(), StringComparison.Ordinal);
        var query = QueryHelpers.ParseQuery(authorize.Query);
        Assert.Equal("identify role_connections.write", query["scope"].ToString());
        var discordId = Random.Shared.NextInt64(1, long.MaxValue).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var code = FakeDiscord.Authorize(discordId, "linker");

        using var forged = await site.GetAsync($"/Discord/LinkedRoleCallback?code={code}&state=forged");
        Assert.Contains("did not confirm", await forged.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        using var again = await site.GetAsync("/Discord/LinkedRole");
        var state = QueryHelpers.ParseQuery(again.Headers.Location!.Query)["state"].ToString();
        using var back = await site.GetAsync($"/Discord/LinkedRoleCallback?code={code}&state={state}");
        Assert.Equal(HttpStatusCode.OK, back.StatusCode);
        Assert.Contains(name, await back.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var player = await app.WithDbAsync(db => db.Players.SingleAsync(p => p.Name == name));
        Assert.Equal(discordId, player.DiscordId);
        var pushed = RoleConnection(code);
        Assert.Equal(name, (string?)pushed["platform_username"]);
        Assert.Equal("1", (string?)pushed["metadata"]!["rank"]);

        // A better rating reaches Discord with the next sync.
        await app.WithDbAsync(db => db.Players.Where(p => p.Id == player.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.Rating, 1260)));
        await using (var scope = app.Web.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<DiscordLeague>().SyncAsync(CancellationToken.None);
        }

        pushed = RoleConnection(code);
        Assert.Equal("1260", (string?)pushed["metadata"]!["rating"]);
        Assert.Equal("6", (string?)pushed["metadata"]!["rank"]);
    }

    [Fact]
    public async Task TheSoulsCommandAnswersOnlyWhatDiscordSigned()
    {
        using var discord = app.CreateDiscordBrowser();
        Assert.Equal("/Game?mode=3d", await SignUpAsync(discord));
        var (id, name) = await NewestDiscordPlayerAsync();

        using var site = app.CreateBrowser();
        const string ping = "{\"type\":1}";
        using (var unsigned = await PostInteractionAsync(site, ping, signature: "00"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, unsigned.StatusCode);
        }

        Assert.Equal(1, (int)(await InteractAsync(site, ping))["type"]!);
        Assert.Equal(12, (int)(await InteractAsync(site, Command("play", id)))["type"]!);

        var profile = await InteractAsync(site, Command("profile", id));
        Assert.Equal(4, (int)profile["type"]!);
        Assert.Equal(name, (string?)profile["data"]!["embeds"]![0]!["title"]);

        var stranger = await InteractAsync(site, Command("profile", "77"));
        Assert.Equal(64, (int)stranger["data"]!["flags"]!);

        var leaderboard = await InteractAsync(site, Command("leaderboard", id));
        Assert.Contains("best players", (string?)leaderboard["data"]!["embeds"]![0]!["title"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheLinkedRolesAndTheCommandAreRegisteredAtStart()
    {
        // (DiscordSync registers them when the web app starts, with the bot token.)
        for (var i = 0; i < 50 && !FakeDiscord.Requests.Any(r => r.Path.EndsWith("/commands", StringComparison.Ordinal)); i++)
        {
            await Task.Delay(100);
        }

        var metadata = FakeDiscord.Requests.First(r => r.Method == "PUT" && r.Path.EndsWith($"/applications/{FakeDiscord.ClientId}/role-connections/metadata", StringComparison.Ordinal));
        Assert.Equal($"Bot {FakeDiscord.BotToken}", metadata.Authorization);
        Assert.Equal(["rank", "rating", "season_wins", "joined"], JsonNode.Parse(metadata.Body)!.AsArray().Select(m => (string)m!["key"]!));
        var command = FakeDiscord.Requests.First(r => r.Method == "POST" && r.Path.EndsWith($"/applications/{FakeDiscord.ClientId}/commands", StringComparison.Ordinal));
        Assert.Equal("souls", (string?)JsonNode.Parse(command.Body)!["name"]);
    }

    [Fact]
    public async Task TheEndOfASeasonIsPostedToTheChannel()
    {
        var season = await app.WithDbAsync(db => db.Seasons.AsNoTracking().OrderByDescending(s => s.Number).FirstAsync());
        await using (var scope = app.Server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Souls.Model.SoulsDbContext>();
            await scope.ServiceProvider.GetRequiredService<SeasonAnnouncer>().AnnounceAsync(db, season, CancellationToken.None);
        }

        var post = FakeDiscord.Requests.Last(r => r.Method == "POST" && r.Path == "/api/webhooks/1/season");
        Assert.Equal($"{season.Name} is over", (string?)JsonNode.Parse(post.Body)!["embeds"]![0]!["title"]);
    }

    private Task<(string Id, string Name)> NewestDiscordPlayerAsync() => app.WithDbAsync(async db =>
    {
        var p = await db.Players.Where(p => p.DiscordId != null).OrderByDescending(p => p.Id).Select(p => new { p.DiscordId, p.Name }).FirstAsync();
        return (p.DiscordId!, p.Name);
    });

    private static JsonNode RoleConnection(string code) => JsonNode.Parse(FakeDiscord.Requests
        .Last(r => r.Method == "PUT" && r.Authorization == $"Bearer token-{code}" && r.Path.EndsWith("/role-connection", StringComparison.Ordinal)).Body)!;

    private static string Command(string sub, string userId) =>
        "{\"type\":2,\"user\":{\"id\":\"" + userId + "\"},\"data\":{\"name\":\"souls\",\"options\":[{\"type\":1,\"name\":\"" + sub + "\"}]}}";

    private static async Task<JsonNode> InteractAsync(TestBrowser site, string body)
    {
        using var response = await PostInteractionAsync(site, body, signature: null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }

    private static async Task<HttpResponseMessage> PostInteractionAsync(TestBrowser site, string body, string? signature)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Discord/Interactions") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-Signature-Ed25519", signature ?? FakeDiscord.Sign(timestamp, body));
        request.Headers.Add("X-Signature-Timestamp", timestamp);
        return await site.SendAsync(request);
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
        var answer = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("token-" + code, answer.GetProperty("accessToken").GetString()); // for the SDK
        return answer.GetProperty("next").GetString()!;
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
