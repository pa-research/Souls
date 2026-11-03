using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Souls.Model;

namespace Souls.Web.Services;

/// <summary>
/// The <c>/souls</c> command (registered by <see cref="DiscordLeague"/>), answered over HTTP: Discord posts each use to
/// <c>/Discord/Interactions</c>, signed with the application's Ed25519 key (<c>Souls:Discord:PublicKey</c>).
/// <c>profile</c> shows a player's rank and season, <c>leaderboard</c> the season's best, <c>play</c> opens the Activity.
/// </summary>
public sealed class DiscordInteractions(SoulsDbContext db, IConfiguration configuration)
{
    private const int Gold = 0xD4A73C;
    private const int Ephemeral = 64;

    /// <summary>Whether Discord signed <paramref name="body"/> (sent at <paramref name="timestamp"/>).</summary>
    public bool IsSigned(string? signature, string? timestamp, string body)
    {
        var key = configuration["Souls:Discord:PublicKey"];
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrEmpty(signature) || string.IsNullOrEmpty(timestamp))
        {
            return false;
        }

        try
        {
            var verifier = new Ed25519Signer();
            verifier.Init(false, new Ed25519PublicKeyParameters(Convert.FromHexString(key), 0));
            var message = Encoding.UTF8.GetBytes(timestamp + body);
            verifier.BlockUpdate(message, 0, message.Length);
            return verifier.VerifySignature(Convert.FromHexString(signature));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>The answer to an interaction; <paramref name="site"/> is the site's address, for links and pictures.</summary>
    public async Task<JsonObject> AnswerAsync(JsonNode interaction, string site, CancellationToken ct)
    {
        if ((int?)interaction["type"] == 1)
        {
            return new JsonObject { ["type"] = 1 }; // PING: PONG
        }

        var data = interaction["data"];
        var sub = data?["options"]?[0];
        return (string?)data?["name"] == "souls" ? (string?)sub?["name"] switch
        {
            "play" => new JsonObject { ["type"] = 12 }, // LAUNCH_ACTIVITY
            "leaderboard" => await LeaderboardAsync(site, ct),
            "profile" => await ProfileAsync(interaction, sub!, site, ct),
            _ => Message("Unknown command.", ephemeral: true),
        } : Message("Unknown command.", ephemeral: true);
    }

    private async Task<JsonObject> ProfileAsync(JsonNode interaction, JsonNode sub, string site, CancellationToken ct)
    {
        // The chosen player, else whoever used the command (in a server: the member; elsewhere: the user).
        var target = (string?)sub["options"]?[0]?["value"];
        var self = (string?)(interaction["member"]?["user"]?["id"] ?? interaction["user"]?["id"]);
        var discordId = target ?? self;
        var player = await db.Players.AsNoTracking().Include(p => p.PlayerType)
            .SingleOrDefaultAsync(p => p.DiscordId == discordId && !p.IsSystem && !p.IsAi, ct);
        if (player is null)
        {
            return Message(target is null || target == self
                ? "You have not linked Souls yet. Play the Souls Activity in a voice channel, or link your account in a server's Linked Roles."
                : $"<@{target}> has not linked Souls yet.", ephemeral: true);
        }

        var season = await Seasons.CurrentAsync(db, ct);
        var ranked = db.Games.Where(g => season != null && !g.IsPractice && g.Created >= season.StartsAt);
        var games = await ranked.CountAsync(g => g.Player1Id == player.Id || g.Player2Id == player.Id, ct);
        var wins = await ranked.CountAsync(g => g.WinnerId == player.Id, ct);
        var rank = Ratings.RankOf(player.Rating);
        var embed = new JsonObject
        {
            ["title"] = player.Name,
            ["url"] = $"{site}/Player/Profile/{Uri.EscapeDataString(player.Name)}",
            ["color"] = Gold,
            ["description"] = $"**{Ratings.TierOf(rank)}** · rating {player.Rating}",
            ["thumbnail"] = new JsonObject { ["url"] = $"{site}/Content/Images/Player/Portraits/{player.PlayerTypeId}.jpg" },
            ["fields"] = new JsonArray(
                Field("Hero", player.PlayerType?.Name ?? "-"),
                Field(season?.Name ?? "Season", games == 0 ? "No ranked games yet" : $"{wins} wins, {games - wins} losses"),
                Field("In Souls since", player.Created is { } created ? $"<t:{created.ToUnixTimeSeconds()}:D>" : "-")),
        };
        return Message(null, embed);
    }

    private async Task<JsonObject> LeaderboardAsync(string site, CancellationToken ct)
    {
        var season = await Seasons.CurrentAsync(db, ct);
        if (season is null)
        {
            return Message("No season is running.", ephemeral: true);
        }

        var top = await Seasons.Standings(db, season.StartsAt).Take(10).ToListAsync(ct); // (best rating first)
        var lines = top.Select((s, i) => string.Create(CultureInfo.InvariantCulture,
            $"**{i + 1}.** {s.Name} · {Ratings.TierOf(Ratings.RankOf(s.Rating))} ({s.Rating}) · {s.Wins}/{s.Games} won"));
        var embed = new JsonObject
        {
            ["title"] = $"{season.Name}: the best players",
            ["url"] = $"{site}/Season",
            ["color"] = Gold,
            ["description"] = top.Count == 0 ? "Nobody has played a ranked game this season yet." : string.Join('\n', lines),
            ["footer"] = new JsonObject { ["text"] = $"The season ends {season.EndsAt:d MMMM yyyy}" },
        };
        return Message(null, embed);
    }

    private static JsonObject Field(string name, string value) => new() { ["name"] = name, ["value"] = value, ["inline"] = true };

    private static JsonObject Message(string? content, JsonObject? embed = null, bool ephemeral = false)
    {
        var data = new JsonObject { ["allowed_mentions"] = new JsonObject { ["parse"] = new JsonArray() } };
        if (content is not null)
        {
            data["content"] = content;
        }

        if (embed is not null)
        {
            data["embeds"] = new JsonArray(embed);
        }

        if (ephemeral)
        {
            data["flags"] = Ephemeral;
        }

        return new JsonObject { ["type"] = 4, ["data"] = data }; // CHANNEL_MESSAGE_WITH_SOURCE
    }
}
