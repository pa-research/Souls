using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
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

public sealed class PlayerController(SoulsDbContext db, PasswordService passwords, SessionService sessions, TimeProvider time, ILogger<PlayerController> logger) : Controller
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

        ViewData["Title"] = "Login";
        return View(new LoginViewModel { ReturnUrl = returnUrl });
    }

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(LoginViewModel model, CancellationToken ct)
    {
        ViewData["Title"] = "Login";
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
            ModelState.AddModelError(string.Empty, "Invalid username or password.");
            return View(model);
        }

        if (await sessions.IsBannedAsync(player.Id, ct))
        {
            ModelState.AddModelError(string.Empty, "This account is banned.");
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
        ViewData["Title"] = "Registration";
        return View(await RegisterPageAsync(new RegisterViewModel(), ct));
    }

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register([Bind(Prefix = "Form")] RegisterViewModel form, CancellationToken ct)
    {
        ViewData["Title"] = "Registration";
        var key = nameof(RegisterPageModel.Form) + ".";

        // Required already reports an empty password.
        if (!string.IsNullOrEmpty(form.Password) && PasswordService.ValidatePolicy(form.Password) is { } passwordProblem)
        {
            ModelState.AddModelError(key + nameof(form.Password), passwordProblem);
        }

        if (string.Equals(form.Username, SeedData.BotPlayerName, StringComparison.OrdinalIgnoreCase))
        {
            ModelState.AddModelError(key + nameof(form.Username), "That username is reserved");
        }

        var cards = form.Cards.Distinct().ToList();
        var starterIds = await db.Cards.Where(c => c.Level == 1 && (c.ClassId == null || c.ClassId == form.PlayerType)).Select(c => c.Id).ToListAsync(ct);
        if (cards.Count != 5 || cards.Except(starterIds).Any())
        {
            ModelState.AddModelError(key + nameof(form.Cards), "You must select 5 starter cards!");
        }

        if (form.PlayerType is { } typeId && !await db.PlayerTypes.AnyAsync(t => t.Id == typeId, ct))
        {
            ModelState.AddModelError(key + nameof(form.PlayerType), "You must select a class");
        }

        // An empty username binds as null; its Required error is already in the model state.
        var normalized = ModelState.IsValid ? Player.Normalize(form.Username) : string.Empty;
        if (ModelState.IsValid && await db.Players.AnyAsync(p => p.NormalizedName == normalized, ct))
        {
            ModelState.AddModelError(key + nameof(form.Username), "The username already exists");
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
            ModelState.AddModelError(key + nameof(form.Username), "The username already exists");
            return View(await RegisterPageAsync(form, ct));
        }

        logger.LogInformation("Registered player {Name}", player.Name);
        TempData["Message"] = "Your account was created. Please log in.";
        return RedirectToAction(nameof(Login));
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
