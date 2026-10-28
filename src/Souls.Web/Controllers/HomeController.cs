using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;

namespace Souls.Web.Controllers;

[AllowAnonymous]
public sealed class HomeController(SoulsDbContext db, IHttpClientFactory httpClients, IConfiguration configuration, ILogger<HomeController> logger) : Controller
{
    public IActionResult Index()
    {
        ViewData["Title"] = "Home";
        ViewData["GitHubRepository"] = configuration["Souls:GitHubRepository"];
        return View();
    }

    /// <summary>The 20 most recent games for the "Recent games" feed.</summary>
    [HttpGet]
    public async Task<IActionResult> GetGames(CancellationToken ct)
    {
        var games = await db.Games.AsNoTracking()
            .OrderByDescending(g => g.Id)
            .Take(20)
            .Select(g => new { gameId = g.Id, player1 = g.Player1!.Name, player2 = g.Player2!.Name })
            .ToListAsync(ct);
        return Json(games);
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
