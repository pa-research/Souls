using System.Text.RegularExpressions;
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

/// <summary>
/// The Discord Activity (see <see cref="DiscordActivity"/>): its start page signs the player in with Discord, and a
/// Discord account without a player picks its hero and starter cards first. Only served on the Activity's host.
/// </summary>
[AllowAnonymous]
public sealed partial class DiscordController(DiscordActivity discord, SoulsDbContext db, SessionService sessions, PlayerRegistration registration, ILogger<DiscordController> logger, IStringLocalizer<SharedResource> localizer) : Controller
{
    // The Discord account waiting for its player (TempData: a protected cookie).
    private const string PendingId = "DiscordId";
    private const string PendingName = "DiscordName";

    [HttpGet]
    public IActionResult Index() => discord.IsActivityRequest(HttpContext) ? View(model: discord.ClientId) : NotFound();

    public sealed record TokenRequest(string Code);

    /// <summary>Signs in with the SDK's authorization code; answers where the page goes next.</summary>
    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Token([FromBody] TokenRequest request, CancellationToken ct)
    {
        if (!discord.IsActivityRequest(HttpContext))
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(request.Code) || await discord.SignInAsync(request.Code, ct) is not { } user)
        {
            return Unauthorized();
        }

        var player = await db.Players.SingleOrDefaultAsync(p => p.DiscordId == user.Id && !p.IsSystem && !p.IsAi, ct);
        if (player is null)
        {
            TempData[PendingId] = user.Id;
            TempData[PendingName] = user.GlobalName ?? user.Username;
            return Json(new { next = Url.Action(nameof(Join)) });
        }

        if (await sessions.IsBannedAsync(player.Id, ct))
        {
            return Forbid();
        }

        await SignInAsync(player, ct);
        return Json(new { next = GameUrl });
    }

    /// <summary>A new Discord player: the register page without a password.</summary>
    [HttpGet]
    public async Task<IActionResult> Join(CancellationToken ct)
    {
        if (!discord.IsActivityRequest(HttpContext) || TempData.Peek(PendingName) is not string name)
        {
            return NotFound();
        }

        ViewData["Title"] = localizer["Registration"].Value;
        return View("~/Views/Player/Register.cshtml", await registration.PageAsync(new RegisterViewModel { Username = SuggestName(name) }, ct, discord: true));
    }

    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Join([Bind(Prefix = "Form")] RegisterViewModel form, CancellationToken ct)
    {
        if (!discord.IsActivityRequest(HttpContext) || TempData.Peek(PendingId) is not string discordId)
        {
            return NotFound();
        }

        ViewData["Title"] = localizer["Registration"].Value;
        var key = nameof(RegisterPageModel.Form) + ".";
        ModelState.Remove(key + nameof(form.Password));
        ModelState.Remove(key + nameof(form.ConfirmPassword));
        var player = await registration.CreateAsync(form, ModelState, discordId, ct);
        if (player is null)
        {
            return View("~/Views/Player/Register.cshtml", await registration.PageAsync(form, ct, discord: true));
        }

        TempData.Remove(PendingId);
        TempData.Remove(PendingName);
        logger.LogInformation("Registered player {Name} with Discord", player.Name);
        await SignInAsync(player, ct);
        return Redirect(GameUrl);
    }

    private string GameUrl => Url.Action("Index", "Game", new { mode = "3d" })!;

    private async Task SignInAsync(Player player, CancellationToken ct)
    {
        var token = await sessions.StartAsync(player, ct);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, SoulsClaims.CreatePrincipal(player, token));
        logger.LogInformation("{Name} logged in with Discord", player.Name);
    }

    /// <summary>A Discord name as a Souls username (3-20 letters, digits, '-' or '_'), to start the form with.</summary>
    public static string SuggestName(string name)
    {
        var clean = NotAllowed().Replace(name, "_");
        clean = clean.Length > 20 ? clean[..20] : clean;
        return clean.PadRight(3, '_');
    }

    [GeneratedRegex("[^A-Za-z0-9_-]")]
    private static partial Regex NotAllowed();
}
