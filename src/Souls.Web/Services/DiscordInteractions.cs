using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Souls.Model;
using Souls.Model.Localization;

namespace Souls.Web.Services;

/// <summary>
/// The <c>/souls</c> command (registered by <see cref="DiscordLeague"/>), answered over HTTP: Discord posts each use to
/// <c>/Discord/Interactions</c>, signed with the application's Ed25519 key (<c>Souls:Discord:PublicKey</c>).
/// <c>profile</c> shows a player's rank and season, <c>leaderboard</c> the season's best, <c>play</c> opens the Activity.
/// Answers are in the user's Discord language (Norwegian or English).
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
        // Discord's Norwegian is "no".
        var lang = ((string?)interaction["locale"] ?? string.Empty) is var l && (l.StartsWith("no", StringComparison.Ordinal) || l.StartsWith("nb", StringComparison.Ordinal)) ? "nb" : Strings.Default;
        return (string?)data?["name"] == "souls" ? (string?)sub?["name"] switch
        {
            "play" => new JsonObject { ["type"] = 12 }, // LAUNCH_ACTIVITY
            "leaderboard" => await LeaderboardAsync(site, lang, ct),
            "profile" => await ProfileAsync(interaction, sub!, site, lang, ct),
            _ => Message(T(lang, "discord.unknown"), ephemeral: true),
        } : Message(T(lang, "discord.unknown"), ephemeral: true);
    }

    private static string T(string lang, string key, params (string, object)[] args) => new GameText(key, args).In(lang);

    private static string SeasonName(Model.Entities.Season season, string lang) => Seasons.NameText(season)?.In(lang) ?? season.Name;

    private async Task<JsonObject> ProfileAsync(JsonNode interaction, JsonNode sub, string site, string lang, CancellationToken ct)
    {
        // The chosen player, else whoever used the command (in a server: the member; elsewhere: the user).
        var target = (string?)sub["options"]?[0]?["value"];
        var self = (string?)(interaction["member"]?["user"]?["id"] ?? interaction["user"]?["id"]);
        var discordId = target ?? self;
        var player = await db.Players.AsNoTracking().Include(p => p.PlayerType)
            .SingleOrDefaultAsync(p => p.DiscordId == discordId && !p.IsSystem && !p.IsAi, ct);
        if (player is null)
        {
            return Message(target is null || target == self ? T(lang, "discord.notLinkedSelf") : T(lang, "discord.notLinkedOther", ("user", $"<@{target}>")), ephemeral: true);
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
            ["description"] = $"**{Ratings.TierOf(rank).Text.In(lang)}** · {T(lang, "discord.rating", ("rating", player.Rating))}",
            ["thumbnail"] = new JsonObject { ["url"] = $"{site}/Content/Images/Player/Portraits/{player.PlayerTypeId}.jpg" },
            ["fields"] = new JsonArray(
                Field(T(lang, "discord.hero"), player.PlayerType?.Name ?? "-"),
                Field(season is null ? "-" : SeasonName(season, lang), games == 0 ? T(lang, "discord.noRanked") : T(lang, "discord.record", ("wins", wins), ("losses", games - wins))),
                Field(T(lang, "discord.since"), player.Created is { } created ? $"<t:{created.ToUnixTimeSeconds()}:D>" : "-")),
        };
        return Message(null, embed);
    }

    private async Task<JsonObject> LeaderboardAsync(string site, string lang, CancellationToken ct)
    {
        var season = await Seasons.CurrentAsync(db, ct);
        if (season is null)
        {
            return Message(T(lang, "discord.noSeason"), ephemeral: true);
        }

        var top = await Seasons.Standings(db, season.StartsAt).Take(10).ToListAsync(ct); // (best rating first)
        var lines = top.Select((s, i) => string.Create(CultureInfo.InvariantCulture,
            $"**{i + 1}.** {s.Name} · {Ratings.TierOf(Ratings.RankOf(s.Rating)).Text.In(lang)} ({s.Rating}) · {T(lang, "discord.won", ("wins", s.Wins), ("games", s.Games))}"));
        var embed = new JsonObject
        {
            ["title"] = T(lang, "discord.best", ("season", SeasonName(season, lang))),
            ["url"] = $"{site}/Season",
            ["color"] = Gold,
            ["description"] = top.Count == 0 ? T(lang, "discord.nobodyRanked") : string.Join('\n', lines),
            ["footer"] = new JsonObject { ["text"] = T(lang, "discord.seasonEnds", ("date", season.EndsAt.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo(lang == "nb" ? "nb-NO" : "en-GB")))) },
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
