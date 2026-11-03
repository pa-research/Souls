using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;

namespace Souls.Web.Services;

/// <summary>
/// Souls' ranked league on Discord. Linked Roles: a player connects their Discord account (OAuth2 with
/// <c>role_connections.write</c>) and servers can give roles by Souls rank, rating, season wins and time in Souls; the
/// connection is updated as these change (<see cref="DiscordSync"/>). With a bot token (<c>Souls:Discord:BotToken</c>)
/// the web app also registers what servers can ask for and the <c>/souls</c> command (<see cref="RegisterAsync"/>).
/// </summary>
public sealed class DiscordLeague(DiscordActivity discord, SoulsDbContext db, IHttpClientFactory http, IDataProtectionProvider protection, IConfiguration configuration, TimeProvider time, ILogger<DiscordLeague> logger)
{
    private readonly IDataProtector _tokens = protection.CreateProtector("Souls.Discord.Tokens");

    /// <summary>What a server can require for a linked role (Discord: application role connection metadata).</summary>
    public static readonly object[] Requirements =
    [
        new { key = "rank", name = "Rank", description = "Souls rank at least: 1 is Bronze III, 16 is Champion", type = 2 },
        new { key = "rating", name = "Rating", description = "Souls rating at least", type = 2 },
        new { key = "season_wins", name = "Season wins", description = "Ranked wins this season at least", type = 2 },
        new { key = "joined", name = "Days in Souls", description = "Days since the Souls account was made", type = 5 },
    ];

    /// <summary>The <c>/souls</c> command (see <see cref="DiscordInteractions"/>): guild and user installs, anywhere.</summary>
    public static readonly object Command = new
    {
        name = "souls",
        description = "Souls, the card battler",
        type = 1,
        integration_types = new[] { 0, 1 },
        contexts = new[] { 0, 1, 2 },
        options = new object[]
        {
            new { type = 1, name = "profile", description = "A player's Souls rank and season", options = new[] { new { type = 6, name = "player", description = "Whose profile (yours if empty)", required = false } } },
            new { type = 1, name = "leaderboard", description = "The best players of the season" },
            new { type = 1, name = "play", description = "Play Souls here, in the Discord Activity" },
        },
    };

    public bool CanRegister => discord.Enabled && !string.IsNullOrWhiteSpace(configuration["Souls:Discord:BotToken"]);

    /// <summary>Registers the linked roles' requirements and the <c>/souls</c> command (both idempotent).</summary>
    public async Task RegisterAsync(CancellationToken ct)
    {
        var client = http.CreateClient(DiscordActivity.HttpClientName);
        await SendAsync(client, HttpMethod.Put, $"applications/{discord.ClientId}/role-connections/metadata", Requirements, ct);
        // (Created or updated by name: the Activity's entry point command stays.)
        await SendAsync(client, HttpMethod.Post, $"applications/{discord.ClientId}/commands", Command, ct);
        logger.LogInformation("Registered the Discord linked roles and the /souls command");
    }

    private async Task SendAsync(HttpClient client, HttpMethod method, string path, object body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bot", configuration["Souls:Discord:BotToken"]);
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Discord answered {(int)response.StatusCode} to {method} {path}: {await response.Content.ReadAsStringAsync(ct)}");
        }
    }

    /// <summary>Keeps <paramref name="signIn"/>'s tokens for <paramref name="player"/> and sends the player's standing.</summary>
    public async Task ConnectAsync(Player player, DiscordSignIn signIn, CancellationToken ct)
    {
        var connection = await db.DiscordConnections.SingleOrDefaultAsync(c => c.PlayerId == player.Id, ct);
        if (connection is null)
        {
            connection = new DiscordConnection { PlayerId = player.Id, AccessToken = string.Empty, RefreshToken = string.Empty };
            db.DiscordConnections.Add(connection);
        }

        connection.Player = player;
        Store(connection, signIn.AccessToken, signIn.RefreshToken ?? string.Empty, signIn.ExpiresIn);
        connection.Pushed = null;
        await db.SaveChangesAsync(ct);
        await PushAsync(connection, ct);
    }

    /// <summary>Sends every connection whose standing changed since it was last sent.</summary>
    public async Task SyncAsync(CancellationToken ct)
    {
        foreach (var connection in await db.DiscordConnections.Include(c => c.Player).ToListAsync(ct))
        {
            try
            {
                await PushAsync(connection, ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                logger.LogWarning(e, "Could not update the Discord linked role of {Name}", connection.Player?.Name);
            }
        }
    }

    /// <summary>The role connection Discord shows for a player: name and the values servers' requirements are checked on.</summary>
    public async Task<string> RoleConnectionAsync(Player player, CancellationToken ct)
    {
        var season = await Seasons.CurrentAsync(db, ct);
        var wins = season is null ? 0 : await Seasons.Standings(db, season.StartsAt).Where(s => s.PlayerId == player.Id).Select(s => s.Wins).FirstOrDefaultAsync(ct);
        return JsonSerializer.Serialize(new
        {
            platform_name = "Souls",
            platform_username = player.Name,
            metadata = new Dictionary<string, string>
            {
                ["rank"] = Ratings.RankOf(player.Rating).ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["rating"] = player.Rating.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["season_wins"] = wins.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["joined"] = (player.Created ?? time.GetUtcNow()).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture),
            },
        });
    }

    private async Task PushAsync(DiscordConnection connection, CancellationToken ct)
    {
        var player = connection.Player ?? await db.Players.SingleAsync(p => p.Id == connection.PlayerId, ct);
        var body = await RoleConnectionAsync(player, ct);
        if (body == connection.Pushed)
        {
            return;
        }

        var client = http.CreateClient(DiscordActivity.HttpClientName);
        if (connection.ExpiresAt <= time.GetUtcNow().AddMinutes(1) && !await RefreshAsync(client, connection, ct))
        {
            // Revoked on Discord (or the refresh token is gone): the player connects again to show their rank.
            db.DiscordConnections.Remove(connection);
            await db.SaveChangesAsync(ct);
            return;
        }

        using var request = new HttpRequestMessage(HttpMethod.Put, $"users/@me/applications/{discord.ClientId}/role-connection")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _tokens.Unprotect(connection.AccessToken));
        using var response = await client.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            db.DiscordConnections.Remove(connection);
        }
        else if (response.IsSuccessStatusCode)
        {
            connection.Pushed = body;
        }
        else
        {
            logger.LogWarning("Discord answered {Status} to the linked role of {Name}", (int)response.StatusCode, player.Name);
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<bool> RefreshAsync(HttpClient client, DiscordConnection connection, CancellationToken ct)
    {
        if (connection.RefreshToken.Length == 0)
        {
            return false;
        }

        using var response = await client.PostAsync("oauth2/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = discord.ClientId!,
            ["client_secret"] = configuration["Souls:Discord:ClientSecret"]!,
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = _tokens.Unprotect(connection.RefreshToken),
        }), ct);
        if (!response.IsSuccessStatusCode || await response.Content.ReadFromJsonAsync<Refreshed>(ct) is not { AccessToken: { Length: > 0 } access } refreshed)
        {
            return false;
        }

        Store(connection, access, refreshed.RefreshToken ?? _tokens.Unprotect(connection.RefreshToken), refreshed.ExpiresIn);
        return true;
    }

    private void Store(DiscordConnection connection, string accessToken, string refreshToken, int expiresIn)
    {
        connection.AccessToken = _tokens.Protect(accessToken);
        connection.RefreshToken = refreshToken.Length == 0 ? string.Empty : _tokens.Protect(refreshToken);
        connection.ExpiresAt = time.GetUtcNow().AddSeconds(expiresIn);
    }

    private sealed record Refreshed(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);
}
