using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Hosting;
using Souls.Model.Localization;
using Souls.Model.Security;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

[AllowAnonymous]
public sealed class HomeController(SoulsDbContext db, IHttpClientFactory httpClients, IConfiguration configuration, TimeProvider time, ILogger<HomeController> logger, IStringLocalizer<SharedResource> localizer) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = localizer["Home"].Value;
        ViewData["GitHubRepository"] = configuration["Souls:GitHubRepository"];

        IReadOnlyList<QuestView>? quests = null;
        HomeProfile? profile = null;
        SeasonProfile? season = null;
        if (User.Identity?.IsAuthenticated == true && User.GetPlayerId() is { } playerId)
        {
            profile = await db.Players.AsNoTracking()
                .Where(p => p.Id == playerId)
                .Select(p => new HomeProfile(p.Name, p.PlayerTypeId, p.PlayerType!.Name, p.Rating, p.Rank, p.Money,
                    db.Games.Count(g => g.Player1Id == p.Id || g.Player2Id == p.Id),
                    db.Games.Count(g => g.WinnerId == p.Id)))
                .SingleOrDefaultAsync(ct);
            quests = [.. (await Quests.EnsureTodayAsync(db, playerId, time, ct)).Select(q =>
            {
                var definition = Quests.Get(q.Kind);
                return new QuestView(Localized.T(definition.Text), q.Progress, definition.Target, definition.Reward, q.CompletedAt is not null);
            })];

            if (await Seasons.CurrentAsync(db, ct) is { } current)
            {
                var games = db.Games.Where(g => !g.IsPractice && g.Created >= current.StartsAt);
                var best = await db.SeasonStandings.AsNoTracking().Include(s => s.Season)
                    .Where(s => s.PlayerId == playerId)
                    .OrderBy(s => s.Position).ThenByDescending(s => s.Rating)
                    .FirstOrDefaultAsync(ct);
                season = new SeasonProfile(current,
                    await games.CountAsync(g => g.Player1Id == playerId || g.Player2Id == playerId, ct),
                    await games.CountAsync(g => g.WinnerId == playerId, ct),
                    best);
            }
        }

        var top = await db.Players.AsNoTracking()
            .Where(p => !p.IsSystem && !p.IsAi)
            .OrderByDescending(p => p.Rating).ThenBy(p => p.Id)
            .Take(10)
            .Select(p => new { p.Name, p.Rating, p.Rank, Type = p.PlayerType!.Name })
            .ToListAsync(ct);
        // ponytail: every rating of the season's players for the ladder strip; count by rating in SQL if it gets crowded.
        var ladder = await Seasons.CurrentAsync(db, ct) is { } now
            ? LadderRung.Of([.. (await Seasons.Standings(db, now.StartsAt).Select(s => s.Rating).ToListAsync(ct)).Select(Ratings.RankOf)])
            : [];
        return View(new HomeViewModel
        {
            Profile = profile,
            Quests = quests,
            TopPlayers = [.. top.Select((p, i) => new LeaderboardEntry(i + 1, p.Name, p.Rating, p.Rank, p.Type))],
            Season = season,
            Ladder = ladder,
        });
    }

    /// <summary>The 20 most recent games with a player in them for the "Recent games" feed (the AI community has its own).</summary>
    [HttpGet]
    public async Task<IActionResult> GetGames(CancellationToken ct)
    {
        var games = await db.Games.AsNoTracking()
            .Where(g => !g.Player1!.IsAi || !g.Player2!.IsAi)
            .OrderByDescending(g => g.Id)
            .Take(20)
            .Select(g => new { gameId = g.Id, player1 = g.Player1!.Name, player2 = g.Player2!.Name, practice = g.IsPractice, ai1 = g.Player1!.IsAi, ai2 = g.Player2!.IsAi })
            .ToListAsync(ct);
        string Name(string name, bool ai) => ai ? Strings.PersonaName(name) : Localized.PlayerName(name);
        return Json(games.Select(g => new { g.gameId, player1 = Name(g.player1, g.ai1), player2 = Name(g.player2, g.ai2), g.practice }));
    }

    /// <summary>
    /// The AI community for the home page: who is online (players and AI apart) and the AI games to watch, from the game
    /// server, and the latest lines of the AI activity feed.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Community(CancellationToken ct)
    {
        CommunityStatus? online = null;
        if (Uri.TryCreate(configuration["Souls:GameServerHealthUrl"], UriKind.Absolute, out var health))
        {
            try
            {
                online = await httpClients.CreateClient("status").GetFromJsonAsync<CommunityStatus>(new Uri(health, "/community"), ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
            {
                online = null;
            }
        }

        var cards = await db.Cards.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var feed = await db.AiEvents.AsNoTracking()
            .OrderByDescending(a => a.Id)
            .Take(15)
            .Select(a => new { a.Player!.Name, a.Kind, a.Value, a.Created })
            .ToListAsync(ct);
        return Json(new
        {
            players = online?.Players,
            ai = online?.Ai,
            live = online?.Live ?? [],
            idle = online?.Idle ?? [],
            feed = feed.Select(a => new
            {
                name = a.Name,
                text = a.Kind switch
                {
                    AiEventKind.Tier => localizer["{0} (AI) reached {1}", a.Name, Localized.T(Ratings.TierOf(a.Value).Text)].Value,
                    AiEventKind.Streak => localizer["{0} (AI) won {1} games in a row", a.Name, a.Value].Value,
                    _ => localizer["{0} (AI) got a new card: {1}", a.Name, cards.GetValueOrDefault(a.Value, "?")].Value,
                },
                kind = a.Kind.ToString().ToLowerInvariant(),
                created = a.Created,
            }),
        });
    }

    private sealed record CommunityStatus(int Players, int Ai, List<LiveAiGame> Live, List<string>? Idle);

    private sealed record LiveAiGame(int GameId, string[] Players);

    [HttpGet]
    public async Task<IActionResult> GetNews(CancellationToken ct)
    {
        var news = await db.News.AsNoTracking()
            .Where(n => n.Enabled)
            .OrderByDescending(n => n.Date)
            .Take(20)
            .Select(n => new { title = n.Title, text = n.Text, author = n.Author, date = n.Date })
            .ToListAsync(ct);
        return Json(news);
    }

    /// <summary>Health of the database and the game server, shown on the home page.</summary>
    [HttpGet]
    public async Task<IActionResult> ServiceStatus(CancellationToken ct)
    {
        bool database;
        try
        {
            database = await db.Database.CanConnectAsync(ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Database status check failed");
            database = false;
        }

        var gameServer = false;
        var healthUrl = configuration["Souls:GameServerHealthUrl"];
        if (Uri.TryCreate(healthUrl, UriKind.Absolute, out var uri))
        {
            try
            {
                using var response = await httpClients.CreateClient("status").GetAsync(uri, ct);
                gameServer = response.IsSuccessStatusCode;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
            {
                gameServer = false;
            }
        }

        return Json(new Dictionary<string, bool> { ["Game Server"] = gameServer, ["Database"] = database });
    }

    /// <summary>Remembers the language the player picked (a year, in a cookie) and goes back to the page.</summary>
    [HttpPost]
    public IActionResult Language(string language, string? returnUrl, [FromServices] IHostEnvironment environment)
    {
        if (Strings.Languages.Contains(language))
        {
            var secure = SoulsHostingExtensions.UseSecureCookies(configuration, environment);
            Response.Cookies.Append(Localized.CookieName(secure), Localized.CookieValue(language), new CookieOptions
            {
                Expires = time.GetUtcNow().AddYears(1),
                HttpOnly = true,
                IsEssential = true,
                Path = "/",
                SameSite = SameSiteMode.Lax,
                Secure = secure || Request.IsHttps,
            });
        }

        return LocalRedirect(Url.IsLocalUrl(returnUrl) ? returnUrl : "/");
    }

    public IActionResult AccessDenied()
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return View();
    }

    [Route("/Home/Status/{code:int}")]
    public IActionResult Status(int code)
    {
        if (HttpContext.Features.Get<IStatusCodeReExecuteFeature>() is null)
        {
            return NotFound();
        }

        ViewData["StatusCode"] = code;
        return View("Error");
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        ViewData["RequestId"] = Activity.Current?.Id ?? HttpContext.TraceIdentifier;
        return View();
    }
}
