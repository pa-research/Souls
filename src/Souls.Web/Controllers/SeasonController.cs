using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

[AllowAnonymous]
public sealed class SeasonController(SoulsDbContext db) : Controller
{
    private const int Top = 100;

    /// <summary>A season's leaderboard: live for the current season, the stored final standings for an ended one.</summary>
    public async Task<IActionResult> Index(int? id, CancellationToken ct)
    {
        var seasons = await db.Seasons.AsNoTracking().OrderByDescending(s => s.Number).ToListAsync(ct);
        var season = id is null ? seasons.FirstOrDefault() : seasons.FirstOrDefault(s => s.Number == id);
        if (season is null)
        {
            return NotFound();
        }

        ViewData["Title"] = Localized.SeasonName(season);
        var current = season == seasons[0];
        IReadOnlyList<SeasonEntry> standings = current
            ? [.. (await Seasons.Standings(db, season.StartsAt).Take(Top).ToListAsync(ct))
                .Select((s, i) => new SeasonEntry(i + 1, s.Name, s.Rating, Ratings.RankOf(s.Rating), s.Games, s.Wins))]
            : await db.SeasonStandings.AsNoTracking()
                .Where(s => s.SeasonNumber == season.Number)
                .OrderBy(s => s.Position)
                .Take(Top)
                .Select(s => new SeasonEntry(s.Position, s.Player!.Name, s.Rating, s.Rank, s.Games, s.Wins) { RewardCoins = s.RewardCoins, RewardCard = s.RewardCard!.Name })
                .ToListAsync(ct);
        return View(new SeasonViewModel { Season = season, IsCurrent = current, Seasons = seasons, Standings = standings });
    }
}
