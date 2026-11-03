using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Security;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>
/// Souls on Discord. The Activity (see <see cref="DiscordActivity"/>, only on its host): its start page signs the
/// player in with Discord, and a Discord account without a player picks its hero and starter cards first. On the site:
/// Linked Roles (<see cref="DiscordLeague"/>) and the <c>/souls</c> command's interactions (<see cref="DiscordInteractions"/>).
/// </summary>
[AllowAnonymous]
public sealed partial class DiscordController(DiscordActivity discord, SoulsDbContext db, SessionService sessions, PlayerRegistration registration, ILogger<DiscordController> logger, IStringLocalizer<SharedResource> localizer) : Controller
{
    // The Discord account waiting for its player (TempData: a protected cookie).
    private const string PendingId = "DiscordId";
    private const string PendingName = "DiscordName";
    private const string LinkState = "DiscordLinkState";

    [HttpGet]
    public IActionResult Index() => discord.IsActivityRequest(HttpContext) ? View(model: discord.ClientId) : NotFound();

    public sealed record TokenRequest(string Code);

    /// <summary>Signs in with the SDK's authorization code; answers where the page goes next.</summary>
    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Token([FromBody] TokenRequest request, CancellationToken ct)
    {
        NoStatusPage();
        if (!discord.IsActivityRequest(HttpContext))
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(request.Code) || await discord.SignInAsync(request.Code, ct) is not { } signIn)
        {
            return Unauthorized();
        }

        // The page keeps the access token for the SDK (the player's Discord status, the channel's participants).
        var user = signIn.User;
        var player = await db.Players.SingleOrDefaultAsync(p => p.DiscordId == user.Id && !p.IsSystem && !p.IsAi, ct);
        if (player is null)
        {
            TempData[PendingId] = user.Id;
            TempData[PendingName] = user.GlobalName ?? user.Username;
            return Json(new { next = Url.Action(nameof(Join)), accessToken = signIn.AccessToken });
        }

        if (await sessions.IsBannedAsync(player.Id, ct))
        {
            return Forbid();
        }

        await SignInAsync(player, ct);
        return Json(new { next = GameUrl, accessToken = signIn.AccessToken });
    }

    /// <summary>The Souls names of Discord accounts (the players in the channel's Activity), by Discord id.</summary>
    [HttpGet]
    public async Task<IActionResult> Players(string? ids, CancellationToken ct)
    {
        NoStatusPage();
        if (!discord.IsActivityRequest(HttpContext) || User.Identity?.IsAuthenticated != true)
        {
            return NotFound();
        }

        var wanted = (ids ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(25).ToList();
        var players = await db.Players.AsNoTracking()
            .Where(p => p.DiscordId != null && wanted.Contains(p.DiscordId) && !p.IsSystem && !p.IsAi)
            .Select(p => new { p.DiscordId, p.Name })
            .ToListAsync(ct);
        return Json(players.ToDictionary(p => p.DiscordId!, p => p.Name));
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

    /// <summary>Linked Roles: a server's "Linked Roles" sends the member here to connect their Discord account.</summary>
    [HttpGet]
    public IActionResult LinkedRole()
    {
        if (!discord.Enabled || discord.IsActivityRequest(HttpContext))
        {
            return NotFound();
        }

        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        TempData[LinkState] = state;
        return Redirect(QueryHelpers.AddQueryString("https://discord.com/oauth2/authorize", new Dictionary<string, string?>
        {
            ["client_id"] = discord.ClientId,
            ["response_type"] = "code",
            ["scope"] = "identify role_connections.write",
            ["redirect_uri"] = LinkedRoleRedirect,
            ["state"] = state,
            ["prompt"] = "consent",
        }));
    }

    /// <summary>
    /// Back from Discord: the account's player (linked in the Activity, or the player logged in here, who gets linked)
    /// shows its Souls rank on Discord from now on.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> LinkedRoleCallback(string? code, string? state, [FromServices] DiscordLeague league, CancellationToken ct)
    {
        if (!discord.Enabled || discord.IsActivityRequest(HttpContext))
        {
            return NotFound();
        }

        ViewData["Title"] = localizer["Linked Roles"].Value;
        if (code is null || state is null || TempData[LinkState] as string != state || await discord.SignInAsync(code, ct, LinkedRoleRedirect) is not { } signIn)
        {
            return View("LinkedRole", new DiscordLinkModel(null, Failed: true));
        }

        var player = await db.Players.SingleOrDefaultAsync(p => p.DiscordId == signIn.User.Id && !p.IsSystem && !p.IsAi, ct);
        if (player is null && User.GetPlayerId() is { } id)
        {
            player = await db.Players.SingleOrDefaultAsync(p => p.Id == id && p.DiscordId == null, ct);
            if (player is not null)
            {
                player.DiscordId = signIn.User.Id;
                await db.SaveChangesAsync(ct);
                logger.LogInformation("{Name} linked a Discord account", player.Name);
            }
        }

        if (player is null)
        {
            return View("LinkedRole", new DiscordLinkModel(null, Failed: false));
        }

        await league.ConnectAsync(player, signIn, ct);
        return View("LinkedRole", new DiscordLinkModel(player.Name, Failed: false));
    }

    /// <summary>The <c>/souls</c> command: Discord posts each use here, signed with the application's key.</summary>
    [HttpPost]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> Interactions([FromServices] DiscordInteractions interactions, CancellationToken ct)
    {
        NoStatusPage();
        if (!discord.Enabled)
        {
            return NotFound();
        }

        using var reader = new StreamReader(Request.Body);
        var body = await reader.ReadToEndAsync(ct);
        if (!interactions.IsSigned(Request.Headers["X-Signature-Ed25519"], Request.Headers["X-Signature-Timestamp"], body))
        {
            return Unauthorized();
        }

        JsonNode? interaction;
        try
        {
            interaction = JsonNode.Parse(body);
        }
        catch (JsonException)
        {
            return BadRequest();
        }

        if (interaction is null)
        {
            return BadRequest();
        }

        var answer = await interactions.AnswerAsync(interaction, $"{Request.Scheme}://{Request.Host}", ct);
        return Content(answer.ToJsonString(), "application/json");
    }

    /// <summary>The JSON endpoints answer errors as they are (no error page: it would re-run the request as /Home/Status).</summary>
    private void NoStatusPage()
    {
        if (HttpContext.Features.Get<IStatusCodePagesFeature>() is { } pages)
        {
            pages.Enabled = false;
        }
    }

    private string LinkedRoleRedirect => $"{Request.Scheme}://{Request.Host}{Url.Action(nameof(LinkedRoleCallback))}";

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
