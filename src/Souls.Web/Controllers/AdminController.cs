using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Security;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

[Authorize(Roles = SoulsClaims.AdminRole)]
public sealed partial class AdminController(SoulsDbContext db, NewsSanitizer sanitizer, SessionService sessions, TimeProvider time, IWebHostEnvironment environment, ILogger<AdminController> logger) : Controller
{
    public async Task<IActionResult> Players(CancellationToken ct)
    {
        ViewData["Title"] = "Players";
        return View(new AdminPlayersViewModel
        {
            Players = await db.Players.AsNoTracking().Include(p => p.PlayerPermission).Where(p => !p.IsSystem).OrderBy(p => p.Id).ToListAsync(ct),
            Permissions = await db.PlayerPermissions.AsNoTracking().OrderBy(p => p.Id).ToListAsync(ct),
            Cards = await db.PlayerCards.GroupBy(pc => pc.PlayerId)
                .Select(g => new { g.Key, Count = g.Count(), Levels = g.Sum(pc => pc.Level) })
                .ToDictionaryAsync(x => x.Key, x => (x.Count, x.Levels), ct),
        });
    }

    [HttpPost]
    public async Task<IActionResult> ChangePermission(int userId, int permission, CancellationToken ct)
    {
        if (userId == User.RequirePlayerId())
        {
            TempData["Error"] = "You cannot change your own permission.";
            return RedirectToAction(nameof(Players));
        }

        if (!await db.PlayerPermissions.AnyAsync(p => p.Id == permission, ct))
        {
            return BadRequest();
        }

        var updated = await db.Players.Where(p => p.Id == userId && !p.IsSystem)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.PlayerPermissionId, permission), ct);
        if (updated > 0)
        {
            // The role is part of the login cookie: end the session so it is re-issued with the new role.
            await sessions.EndAsync(userId, ct);
            logger.LogInformation("Permission of player {PlayerId} changed to {Permission}", userId, permission);
        }

        return RedirectToAction(nameof(Players));
    }

    public IActionResult Games()
    {
        ViewData["Title"] = "Games";
        return View();
    }

    /// <summary>
    /// Win rate of each card when played, per card and hero class, from stored games between players. Like the
    /// simulator's report (docs/balance.md) it counts decided games only: draws and practice games are left out.
    /// </summary>
    public async Task<IActionResult> CardStatistics(CancellationToken ct)
    {
        ViewData["Title"] = "Card Statistics";

        // One row per game, player and card played in it (playing a card twice counts once), grouped in the database.
        var plays = db.GameLogs
            .Where(l => l.GameLogTypeId == (int)GameLogKind.UseCard && !l.Game!.IsPractice && l.Game.WinnerId != null)
            .Select(l => new { l.GameId, PlayerId = l.Obj1Id, CardId = l.Obj2Id, Won = l.Game!.WinnerId == l.Obj1Id })
            .Distinct();
        var stats = await plays
            .Join(db.Players, x => x.PlayerId, p => p.Id, (x, p) => new { x.CardId, p.PlayerTypeId, x.Won })
            .GroupBy(x => new { x.CardId, x.PlayerTypeId })
            .Select(g => new { g.Key.CardId, g.Key.PlayerTypeId, Games = g.Count(), Wins = g.Count(x => x.Won) })
            .ToListAsync(ct);

        var classes = await db.PlayerTypes.AsNoTracking().OrderBy(t => t.Id).ToListAsync(ct);
        var cards = await db.Cards.AsNoTracking().Include(c => c.Race).ToListAsync(ct);
        WinRate Rate(int cardId, int? classId)
        {
            var rows = stats.Where(s => s.CardId == cardId && (classId is null || s.PlayerTypeId == classId)).ToList();
            return new WinRate(rows.Sum(s => s.Games), rows.Sum(s => s.Wins));
        }

        return View(new CardStatisticsViewModel
        {
            Classes = classes,
            Cards = [.. cards
                .Select(c => new CardStatistics(c, Rate(c.Id, null), [.. classes.Select(t => Rate(c.Id, t.Id))]))
                .OrderByDescending(r => r.Total.Games >= CardStatisticsViewModel.FewGames)
                .ThenByDescending(r => r.Total.Rate ?? -1)
                .ThenByDescending(r => r.Total.Games)
                .ThenBy(r => r.Card.Name)],
        });
    }

    [HttpGet]
    public async Task<IActionResult> CardEditor(int? id, CancellationToken ct)
    {
        ViewData["Title"] = "Card Editor";
        var model = new CardEditorModel();
        if (id is not null)
        {
            var card = await db.Cards.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct);
            if (card is null)
            {
                return NotFound();
            }

            model = new CardEditorModel
            {
                Id = card.Id,
                Name = card.Name,
                Cost = card.Cost,
                Attack = card.Attack,
                Health = card.Health,
                Armor = card.Armor,
                Level = card.Level,
                VendorPrice = card.VendorPrice,
                AbilityId = card.AbilityId,
                AbilityValue = card.AbilityValue,
                Rarity = card.Rarity,
                Flavor = card.Flavor,
                RaceId = card.RaceId,
                Portrait = card.Portrait,
            };
        }

        return View(await CardEditorPageAsync(model, ct));
    }

    [HttpPost]
    public async Task<IActionResult> CardEditor([Bind(Prefix = "Card")] CardEditorModel model, CancellationToken ct)
    {
        ViewData["Title"] = "Card Editor";
        if (model.AbilityId is { } abilityId && !await db.Abilities.AnyAsync(a => a.Id == abilityId, ct))
        {
            ModelState.AddModelError("Card.AbilityId", "Unknown ability");
        }

        if (model.RaceId is { } raceId && !await db.Races.AnyAsync(r => r.Id == raceId, ct))
        {
            ModelState.AddModelError("Card.RaceId", "Unknown race");
        }

        if (!await IsValidPortraitAsync(model.Portrait, ct))
        {
            ModelState.AddModelError("Card.Portrait", "Upload a portrait or use one of the built-in portraits.");
        }

        if (!ModelState.IsValid)
        {
            return View(await CardEditorPageAsync(model, ct));
        }

        Card card;
        if (model.Id is { } id)
        {
            card = await db.Cards.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new BadHttpRequestException("Unknown card");
        }
        else
        {
            card = new Card { Name = model.Name };
            db.Cards.Add(card);
        }

        card.Name = model.Name.Trim();
        card.Cost = model.Cost;
        card.Attack = model.Attack;
        card.Health = model.Health;
        card.Armor = model.Armor;
        card.Level = model.Level;
        card.VendorPrice = model.VendorPrice;
        card.AbilityId = model.AbilityId;
        card.AbilityValue = model.AbilityValue;
        card.Rarity = model.Rarity;
        card.Flavor = string.IsNullOrWhiteSpace(model.Flavor) ? null : model.Flavor.Trim();
        card.RaceId = model.RaceId;
        card.Portrait = string.IsNullOrWhiteSpace(model.Portrait) ? null : model.Portrait;
        await db.SaveChangesAsync(ct);

        TempData["Message"] = $"Saved {card.Name}.";
        return RedirectToAction(nameof(CardEditor), new { id = card.Id });
    }

    /// <summary>Uploads a card portrait (PNG, JPEG or GIF up to 1 MB) and returns its URL.</summary>
    [HttpPost]
    [EnableRateLimiting("upload")]
    [RequestSizeLimit(UploadedImage.MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Upload(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0 || file.Length > UploadedImage.MaxBytes)
        {
            return BadRequest(new { error = "Choose an image of at most 1 MB." });
        }

        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var data = buffer.ToArray();
        var contentType = ImageValidator.DetectContentType(data);
        if (contentType is null)
        {
            return BadRequest(new { error = "Only PNG, JPEG and GIF images are allowed." });
        }

        var image = new UploadedImage
        {
            Id = Guid.NewGuid(),
            ContentType = contentType,
            Data = data,
            CreatedAt = time.GetUtcNow(),
            UploadedById = User.RequirePlayerId(),
        };
        db.UploadedImages.Add(image);
        await db.SaveChangesAsync(ct);
        return Json(new { data = image.Url });
    }

    [HttpGet]
    public async Task<IActionResult> NewsEditor(int? id, CancellationToken ct)
    {
        ViewData["Title"] = "News Editor";
        var post = new NewsEditorModel();
        if (id is not null)
        {
            var news = await db.News.AsNoTracking().SingleOrDefaultAsync(n => n.Id == id, ct);
            if (news is null)
            {
                return NotFound();
            }

            post = new NewsEditorModel { Id = news.Id, Title = news.Title, Text = news.Text };
        }

        return View(await NewsEditorPageAsync(post, ct));
    }

    [HttpPost]
    public async Task<IActionResult> NewsEditor([Bind(Prefix = "Post")] NewsEditorModel model, CancellationToken ct)
    {
        ViewData["Title"] = "News Editor";
        if (!ModelState.IsValid)
        {
            return View(await NewsEditorPageAsync(model, ct));
        }

        News news;
        if (model.Id is { } id)
        {
            news = await db.News.SingleOrDefaultAsync(n => n.Id == id, ct) ?? throw new BadHttpRequestException("Unknown news post");
        }
        else
        {
            news = new News { Title = model.Title, Text = string.Empty, Author = User.Identity!.Name!, Enabled = true };
            db.News.Add(news);
        }

        news.Title = model.Title.Trim();
        news.Text = sanitizer.Sanitize(model.Text);
        news.Author = User.Identity!.Name!;
        news.Date = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return RedirectToAction(nameof(NewsEditor));
    }

    [HttpPost]
    public async Task<IActionResult> NewsToggle(int id, CancellationToken ct)
    {
        await db.News.Where(n => n.Id == id).ExecuteUpdateAsync(s => s.SetProperty(n => n.Enabled, n => !n.Enabled), ct);
        return RedirectToAction(nameof(NewsEditor));
    }

    [HttpPost]
    public async Task<IActionResult> NewsDelete(int id, CancellationToken ct)
    {
        await db.News.Where(n => n.Id == id).ExecuteDeleteAsync(ct);
        return RedirectToAction(nameof(NewsEditor));
    }

    /// <summary>Portraits must be a built-in image or an uploaded one; arbitrary URLs and paths are rejected.</summary>
    private async Task<bool> IsValidPortraitAsync(string? portrait, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(portrait))
        {
            return true;
        }

        if (BuiltInPortrait().IsMatch(portrait))
        {
            return environment.WebRootFileProvider.GetFileInfo(portrait).Exists;
        }

        var match = UploadedPortrait().Match(portrait);
        if (!match.Success || !Guid.TryParseExact(match.Groups["id"].Value, "N", out var id))
        {
            return false;
        }

        var contentType = await db.UploadedImages.Where(i => i.Id == id).Select(i => i.ContentType).SingleOrDefaultAsync(ct);
        return contentType is not null && portrait.EndsWith(UploadedImage.Extension(contentType), StringComparison.Ordinal);
    }

    private async Task<CardEditorViewModel> CardEditorPageAsync(CardEditorModel model, CancellationToken ct) => new()
    {
        Card = model,
        Abilities = await db.Abilities.AsNoTracking().OrderBy(a => a.Id).ToListAsync(ct),
        Races = await db.Races.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct),
        Cards = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race).OrderBy(c => c.Id).ToListAsync(ct),
    };

    private async Task<NewsEditorViewModel> NewsEditorPageAsync(NewsEditorModel model, CancellationToken ct) => new()
    {
        Post = model,
        News = await db.News.AsNoTracking().OrderByDescending(n => n.Date).ToListAsync(ct),
    };

    [GeneratedRegex(@"^/Content/Images/Card/Portraits/[0-9]{1,4}\.(png|jpg|gif)$")]
    private static partial Regex BuiltInPortrait();

    [GeneratedRegex(@"^/Images/Uploaded/(?<id>[0-9a-f]{32})\.(png|jpg|gif)$")]
    private static partial Regex UploadedPortrait();
}
