using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;

namespace Souls.Server.Game;

/// <summary>
/// Posts the end of a season to a Discord channel (<c>Souls:Discord:SeasonWebhookUrl</c>, a channel webhook): the
/// season's podium and when the next one ends. Without a webhook it does nothing; a failed post is only logged.
/// </summary>
public sealed class SeasonAnnouncer(IHttpClientFactory http, IConfiguration configuration, ILogger<SeasonAnnouncer> logger)
{
    public const string HttpClientName = "discord-webhook";

    public async Task AnnounceAsync(SoulsDbContext db, Season ended, CancellationToken ct)
    {
        var webhook = configuration["Souls:Discord:SeasonWebhookUrl"];
        if (string.IsNullOrWhiteSpace(webhook))
        {
            return;
        }

        try
        {
            var podium = await db.SeasonStandings.AsNoTracking().Where(s => s.SeasonNumber == ended.Number).OrderBy(s => s.Position).Take(3)
                .Select(s => new { s.Position, s.Player!.Name, s.Rating, s.Wins, s.Games }).ToListAsync(ct);
            var next = await Seasons.CurrentAsync(db, ct);
            var lines = podium.Select(s => string.Create(CultureInfo.InvariantCulture,
                $"**{s.Position}.** {s.Name} · {Ratings.TierOf(Ratings.RankOf(s.Rating))} ({s.Rating}) · {s.Wins}/{s.Games} won"));
            var embed = new JsonObject
            {
                ["title"] = $"{ended.Name} is over",
                ["color"] = 0xD4A73C,
                ["description"] = podium.Count == 0 ? "Nobody played a ranked game this season." : string.Join('\n', lines),
            };
            if (next is not null)
            {
                embed["footer"] = new JsonObject { ["text"] = $"{next.Name} has begun and ends {next.EndsAt.ToString("d MMMM yyyy", CultureInfo.InvariantCulture)}. Ratings are halved toward the start." };
            }

            var body = new JsonObject { ["username"] = "Souls", ["embeds"] = new JsonArray(embed), ["allowed_mentions"] = new JsonObject { ["parse"] = new JsonArray() } };
            using var response = await http.CreateClient(HttpClientName).PostAsync(webhook, new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"), ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Discord answered {Status} to the season announcement", (int)response.StatusCode);
            }
        }
        catch (HttpRequestException e)
        {
            logger.LogWarning(e, "Could not announce the end of {Season} on Discord", ended.Name);
        }
    }
}
