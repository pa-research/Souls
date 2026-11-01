using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Security;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

[AllowAnonymous]
public sealed class SeasonController(SoulsDbContext db) : Controller
{
    private const int Top = 100;

    /// <summary>
    /// A season's ladder and leaderboard: live for the current season, the stored final standings for an ended one. The
    /// ladder counts the players on each rank, and shows where the signed-in player stands.
    /// </summary>
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
        var me = User.GetPlayerId();
        IReadOnlyList<SeasonEntry> standings;
        List<int> ranks;
        LadderMe? mine = null;
        if (current)
        {
            // ponytail: the whole live table for the ladder's counts; count by rating in SQL if seasons get crowded.
            var all = await Seasons.Standings(db, season.StartsAt).ToListAsync(ct);
            standings = [.. all.Take(Top).Select((s, i) => new SeasonEntry(i + 1, s.Name, s.Rating, Ratings.RankOf(s.Rating), s.Games, s.Wins))];
            ranks = [.. all.Select(s => Ratings.RankOf(s.Rating))];
            if (me is { } playerId && await db.Players.AsNoTracking().Where(p => p.Id == playerId).Select(p => (int?)p.Rating).SingleOrDefaultAsync(ct) is { } rating)
            {
                var index = all.FindIndex(s => s.PlayerId == playerId);
                mine = new LadderMe(index < 0 ? null : index + 1, rating, Ratings.RankOf(rating));
            }
        }
        else
        {
            var stored = db.SeasonStandings.AsNoTracking().Where(s => s.SeasonNumber == season.Number);
            standings = await stored.OrderBy(s => s.Position).Take(Top)
                .Select(s => new SeasonEntry(s.Position, s.Player!.Name, s.Rating, s.Rank, s.Games, s.Wins) { RewardCoins = s.RewardCoins, RewardCard = s.RewardCard!.Name })
                .ToListAsync(ct);
            ranks = await stored.Select(s => s.Rank).ToListAsync(ct);
            if (me is { } playerId && await stored.Where(s => s.PlayerId == playerId).Select(s => new LadderMe(s.Position, s.Rating, s.Rank)).SingleOrDefaultAsync(ct) is { } finished)
            {
                mine = finished;
            }
        }

        var ladder = LadderRung.Of(ranks);
        return View(new SeasonViewModel
        {
            Season = season, IsCurrent = current, Seasons = seasons, Standings = standings, Ladder = ladder, Players = ranks.Count, Me = mine,
        });
    }

    /// <summary>The AI community's own ladder this season: its personas play each other, never on the players' table.</summary>
    public async Task<IActionResult> Ai(CancellationToken ct)
    {
        if (await Seasons.CurrentAsync(db, ct) is not { } season)
        {
            return NotFound();
        }

        var all = await Seasons.Standings(db, season.StartsAt, ai: true).ToListAsync(ct);
        return View(new SeasonViewModel
        {
            Season = season,
            IsCurrent = true,
            Seasons = [season],
            Standings = [.. all.Take(Top).Select((s, i) => new SeasonEntry(i + 1, s.Name, s.Rating, Ratings.RankOf(s.Rating), s.Games, s.Wins))],
            Ladder = LadderRung.Of([.. all.Select(s => Ratings.RankOf(s.Rating))]),
            Players = all.Count,
        });
    }
}
