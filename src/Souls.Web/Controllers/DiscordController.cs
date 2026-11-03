using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
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
/// player in with Discord (a new Discord account gets a player of its own at once), and a player can move the link to
/// a Souls account they already have (<see cref="Link"/>). On the site: Linked Roles (<see cref="DiscordLeague"/>),
/// which also links a logged-in player, and the <c>/souls</c> command's interactions (<see cref="DiscordInteractions"/>).
/// </summary>
[AllowAnonymous]
public sealed class DiscordController(DiscordActivity discord, SoulsDbContext db, SessionService sessions, PasswordService passwords, PlayerRegistration registration, ILogger<DiscordController> logger, IStringLocalizer<SharedResource> localizer) : Controller
{
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
            player = await registration.CreateForDiscordAsync(user.Id, user.GlobalName ?? user.Username, ct);
            logger.LogInformation("Registered player {Name} with Discord", player.Name);
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

    /// <summary>
    /// In the Activity: the player moves their Discord account to a Souls account they already have, by logging in to
    /// it; from then on the Activity opens that one. (The player made for the Discord account stays, unlinked.)
    /// </summary>
    [HttpGet]
    public IActionResult Link()
    {
        if (!discord.IsActivityRequest(HttpContext) || User.GetPlayerId() is null)
        {
            return NotFound();
        }

        ViewData["Title"] = localizer["Link your Souls account"].Value;
        return View(new LoginViewModel());
    }

    [HttpPost]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Link(LoginViewModel model, CancellationToken ct)
    {
        if (!discord.IsActivityRequest(HttpContext) || User.GetPlayerId() is not { } currentId)
        {
            return NotFound();
        }

        ViewData["Title"] = localizer["Link your Souls account"].Value;
        var current = await db.Players.SingleAsync(p => p.Id == currentId, ct);
        if (!ModelState.IsValid || current.DiscordId is not { } discordId)
        {
            return View(model);
        }

        var normalized = Player.Normalize(model.Name);
        var target = await db.Players.SingleOrDefaultAsync(p => p.NormalizedName == normalized && !p.IsSystem && !p.IsAi, ct);
        if (target is null || passwords.Verify(target.Password, model.Password) == PasswordCheck.Failed)
        {
            ModelState.AddModelError(string.Empty, localizer["Invalid username or password."]);
            return View(model);
        }

        if (await sessions.IsBannedAsync(target.Id, ct))
        {
            ModelState.AddModelError(string.Empty, localizer["This account is banned."]);
            return View(model);
        }

        if (target.DiscordId is { } other && other != discordId)
        {
            ModelState.AddModelError(string.Empty, localizer["That account is linked to another Discord account."]);
            return View(model);
        }

        if (target.Id != current.Id)
        {
            await MoveDiscordAsync(current, target, discordId, ct);
            logger.LogInformation("{From} moved its Discord account to {To}", current.Name, target.Name);
        }

        await SignInAsync(target, ct);
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

        // The player logged in here gets the Discord account (moved from a player the Activity made for it); otherwise
        // the account's player, if it has one.
        var linked = await db.Players.SingleOrDefaultAsync(p => p.DiscordId == signIn.User.Id && !p.IsSystem && !p.IsAi, ct);
        var player = linked;
        if (User.GetPlayerId() is { } id && id != linked?.Id)
        {
            var me = await db.Players.SingleAsync(p => p.Id == id, ct);
            if (me.DiscordId is null)
            {
                if (linked is not null)
                {
                    await MoveDiscordAsync(linked, me, signIn.User.Id, ct);
                }
                else
                {
                    me.DiscordId = signIn.User.Id;
                    await db.SaveChangesAsync(ct);
                }

                logger.LogInformation("{Name} linked a Discord account", me.Name);
                player = me;
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

    /// <summary>Moves a Discord account from one player to another (with its Linked Roles connection: it is made again).</summary>
    private async Task MoveDiscordAsync(Player from, Player to, string discordId, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            // (Two saves: the Discord id is unique, so it leaves the one player before it reaches the other.)
            from.DiscordId = null;
            await db.DiscordConnections.Where(c => c.PlayerId == from.Id).ExecuteDeleteAsync(ct);
            await db.SaveChangesAsync(ct);
            to.DiscordId = discordId;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        });
    }

    private async Task SignInAsync(Player player, CancellationToken ct)
    {
        var token = await sessions.StartAsync(player, ct);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, SoulsClaims.CreatePrincipal(player, token));
        logger.LogInformation("{Name} logged in with Discord", player.Name);
    }
}
