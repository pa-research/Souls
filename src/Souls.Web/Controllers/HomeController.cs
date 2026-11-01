using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
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
            .Where(p => !p.IsSystem)
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

    /// <summary>The 20 most recent games for the "Recent games" feed.</summary>
    [HttpGet]
    public async Task<IActionResult> GetGames(CancellationToken ct)
    {
        var games = await db.Games.AsNoTracking()
            .OrderByDescending(g => g.Id)
            .Take(20)
            .Select(g => new { gameId = g.Id, player1 = g.Player1!.Name, player2 = g.Player2!.Name, practice = g.IsPractice })
            .ToListAsync(ct);
        return Json(games.Select(g => g with { player1 = Localized.PlayerName(g.player1), player2 = Localized.PlayerName(g.player2) }));
    }

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
