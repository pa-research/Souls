using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Security;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

public sealed class PlayerController(SoulsDbContext db, PasswordService passwords, SessionService sessions, TimeProvider time, ILogger<PlayerController> logger, IStringLocalizer<SharedResource> localizer) : Controller
{
    /// <summary>Verified against when the user does not exist, so both cases take the same time.</summary>
    private static readonly Lazy<string> DummyHash = new(() => new PasswordService().Hash(Guid.NewGuid().ToString()));

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
        {
            return RedirectToAction("Index", "Home");
        }

        ViewData["Title"] = localizer["Login"].Value;
        return View(new LoginViewModel { ReturnUrl = returnUrl });
    }

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(LoginViewModel model, CancellationToken ct)
    {
        ViewData["Title"] = localizer["Login"].Value;
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var normalized = Player.Normalize(model.Name);
        var player = await db.Players.SingleOrDefaultAsync(p => p.NormalizedName == normalized && !p.IsSystem, ct);
        var check = passwords.Verify(player?.Password ?? DummyHash.Value, model.Password);
        if (player is null || check == PasswordCheck.Failed)
        {
            logger.LogInformation("Failed login for {Name}", model.Name);
            ModelState.AddModelError(string.Empty, localizer["Invalid username or password."]);
            return View(model);
        }

        if (await sessions.IsBannedAsync(player.Id, ct))
        {
            ModelState.AddModelError(string.Empty, localizer["This account is banned."]);
            return View(model);
        }

        if (check == PasswordCheck.SuccessRehashNeeded)
        {
            // Upgrades hashes from the original application (unsalted SHA-256) to PBKDF2.
            player.Password = passwords.Hash(model.Password);
            await db.SaveChangesAsync(ct);
        }

        var token = await sessions.StartAsync(player, ct);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, SoulsClaims.CreatePrincipal(player, token));
        logger.LogInformation("{Name} logged in", player.Name);

        return Url.IsLocalUrl(model.ReturnUrl) ? LocalRedirect(model.ReturnUrl) : RedirectToAction("Index", "Home");
    }

    [HttpPost]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await sessions.EndAsync(User.RequirePlayerId(), ct);
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToAction("Index", "Home");
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> Register(CancellationToken ct)
    {
        ViewData["Title"] = localizer["Registration"].Value;
        return View(await RegisterPageAsync(new RegisterViewModel(), ct));
    }

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register([Bind(Prefix = "Form")] RegisterViewModel form, CancellationToken ct)
    {
        ViewData["Title"] = localizer["Registration"].Value;
        var key = nameof(RegisterPageModel.Form) + ".";

        // Required already reports an empty password.
        if (!string.IsNullOrEmpty(form.Password) && PasswordService.ValidatePolicy(form.Password) is { } passwordProblem)
        {
            ModelState.AddModelError(key + nameof(form.Password), Localized.T(passwordProblem));
        }

        if (string.Equals(form.Username, SeedData.BotPlayerName, StringComparison.OrdinalIgnoreCase))
        {
            ModelState.AddModelError(key + nameof(form.Username), localizer["That username is reserved"]);
        }

        var cards = form.Cards.Distinct().ToList();
        var starterIds = await db.Cards.Where(c => c.Level == 1 && (c.ClassId == null || c.ClassId == form.PlayerType)).Select(c => c.Id).ToListAsync(ct);
        if (cards.Count != 5 || cards.Except(starterIds).Any())
        {
            ModelState.AddModelError(key + nameof(form.Cards), localizer["You must select 5 starter cards!"]);
        }

        if (form.PlayerType is { } typeId && !await db.PlayerTypes.AnyAsync(t => t.Id == typeId, ct))
        {
            ModelState.AddModelError(key + nameof(form.PlayerType), localizer["You must select a class"]);
        }

        // An empty username binds as null; its Required error is already in the model state.
        var normalized = ModelState.IsValid ? Player.Normalize(form.Username) : string.Empty;
        if (ModelState.IsValid && await db.Players.AnyAsync(p => p.NormalizedName == normalized, ct))
        {
            ModelState.AddModelError(key + nameof(form.Username), localizer["The username already exists"]);
        }

        if (!ModelState.IsValid)
        {
            return View(await RegisterPageAsync(form, ct));
        }

        var player = new Player
        {
            Name = form.Username.Trim(),
            NormalizedName = normalized,
            Password = passwords.Hash(form.Password),
            PlayerTypeId = form.PlayerType!.Value,
            PlayerPermissionId = PlayerPermission.Player,
            Rank = 1,
            Money = 0,
            Created = time.GetUtcNow(),
        };
        db.Players.Add(player);
        foreach (var cardId in cards)
        {
            db.PlayerCards.Add(new PlayerCard { Player = player, CardId = cardId, ObtainedAt = time.GetUtcNow() });
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Lost a race against another registration with the same name.
            ModelState.AddModelError(key + nameof(form.Username), localizer["The username already exists"]);
            return View(await RegisterPageAsync(form, ct));
        }

        logger.LogInformation("Registered player {Name}", player.Name);
        TempData["Message"] = localizer["Your account was created. Please log in."].Value;
        return RedirectToAction(nameof(Login));
    }

    /// <summary>
    /// A player's public profile: rank, ranked record, the rating's course this season, the last games and the final
    /// places of ended seasons. System accounts (the practice bot) have none.
    /// </summary>
    [HttpGet("Player/Profile/{name}")]
    [AllowAnonymous]
    public async Task<IActionResult> Profile(string name, CancellationToken ct)
    {
        var normalized = Player.Normalize(name);
        var player = await db.Players.AsNoTracking()
            .Where(p => p.NormalizedName == normalized && !p.IsSystem)
            .Select(p => new { p.Id, p.Name, p.PlayerTypeId, Type = p.PlayerType!.Name, p.Rating, p.Rank, p.Created })
            .SingleOrDefaultAsync(ct);
        if (player is null)
        {
            return NotFound();
        }

        var id = player.Id;
        var games = db.Games.AsNoTracking().Where(g => g.Player1Id == id || g.Player2Id == id);
        var counts = await games.GroupBy(g => g.IsPractice)
            .Select(g => new { Practice = g.Key, Games = g.Count(), Wins = g.Count(x => x.WinnerId == id) })
            .ToListAsync(ct);
        var recent = await games.OrderByDescending(g => g.Created).ThenByDescending(g => g.Id).Take(20)
            .Select(g => new ProfileGame(
                g.Id, g.Created, g.IsPractice,
                g.Player1Id == id ? g.Player2!.Name : g.Player1!.Name,
                g.Player1Id == id ? g.Player2!.PlayerTypeId : g.Player1!.PlayerTypeId,
                g.Player1Id == id ? g.Player2!.IsSystem : g.Player1!.IsSystem,
                g.WinnerId == null ? "draw" : g.WinnerId == id ? "won" : "lost",
                g.Player1Id == id ? g.Player1RatingChange : g.Player2RatingChange,
                g.Turns))
            .ToListAsync(ct);

        // The season's reset moves ratings without a game, so the course is traced back over this season's games only.
        var season = await Seasons.CurrentAsync(db, ct);
        var changes = await games.Where(g => !g.IsPractice && (season == null || g.Created >= season.StartsAt))
            .OrderByDescending(g => g.Created).ThenByDescending(g => g.Id).Take(60)
            .Select(g => g.Player1Id == id ? g.Player1RatingChange : g.Player2RatingChange)
            .ToListAsync(ct);
        var history = new List<int> { player.Rating };
        foreach (var change in changes)
        {
            history.Add(history[^1] - change);
        }

        history.Reverse();
        var seasons = await db.SeasonStandings.AsNoTracking().Include(s => s.Season)
            .Where(s => s.PlayerId == id)
            .OrderByDescending(s => s.SeasonNumber)
            .Select(s => new ProfileSeason(s.Season!, s.Position, s.Rank, s.Rating))
            .ToListAsync(ct);

        ViewData["Title"] = player.Name;
        var ranked = counts.SingleOrDefault(c => !c.Practice);
        return View(new ProfileViewModel
        {
            Name = player.Name,
            Type = player.PlayerTypeId,
            TypeName = player.Type,
            Rating = player.Rating,
            Rank = player.Rank,
            Created = player.Created,
            RankedGames = ranked?.Games ?? 0,
            RankedWins = ranked?.Wins ?? 0,
            OtherGames = counts.SingleOrDefault(c => c.Practice)?.Games ?? 0,
            RatingHistory = history,
            Games = recent,
            Seasons = seasons,
            IsMe = User.GetPlayerId() == id,
        });
    }

    /// <summary>Profile shown in the shop.</summary>
    [HttpGet]
    public async Task<IActionResult> GetPlayer(CancellationToken ct)
    {
        var id = User.RequirePlayerId();
        var p = await db.Players.AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new
            {
                name = x.Name,
                money = x.Money,
                rank = x.Rank,
                type = x.PlayerType!.Name,
                health = x.PlayerType.Health,
                bonusmana = x.PlayerType.Mana,
                race = x.PlayerType.Race!.Name,
            })
            .SingleOrDefaultAsync(ct);
        return p is null ? NotFound() : Json(p);
    }

    /// <summary>Called periodically by the game page to keep the sliding login cookie alive.</summary>
    [HttpGet]
    [AllowAnonymous]
    public IActionResult KeepAlive() => Json(new { authenticated = User.Identity?.IsAuthenticated == true });

    private async Task<RegisterPageModel> RegisterPageAsync(RegisterViewModel form, CancellationToken ct)
    {
        var races = await db.Races.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct);
        var types = await db.PlayerTypes.AsNoTracking().OrderBy(t => t.Id).ToListAsync(ct);
        var starters = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race)
            .Where(c => c.Level == 1 && c.ClassId == null).OrderBy(c => c.Id).ToListAsync(ct);

        return new RegisterPageModel
        {
            Form = form,
            Classes = [.. races.Select(r => new RaceClasses(r, [.. types.Where(t => t.RaceId == r.Id)]))],
            StarterCards = [.. starters.Select(c => CardTile.From(c))],
        };
    }
}
