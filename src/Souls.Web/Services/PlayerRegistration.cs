using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Security;
using Souls.Web.Models;

namespace Souls.Web.Services;

/// <summary>
/// Creates players: the registration form's checks (name, class, five starter cards) and the new account with its
/// cards. Used by the register page and by the Discord Activity's sign-up, which has no password (the player signs in
/// with Discord).
/// </summary>
public sealed class PlayerRegistration(SoulsDbContext db, PasswordService passwords, TimeProvider time, IStringLocalizer<SharedResource> localizer)
{
    private const string Key = nameof(RegisterPageModel.Form) + ".";

    /// <summary>
    /// Checks the form and creates the player, linked to <paramref name="discordId"/> if given; <c>null</c> with the
    /// problems in <paramref name="modelState"/>.
    /// </summary>
    public async Task<Player?> CreateAsync(RegisterViewModel form, ModelStateDictionary modelState, string? discordId, CancellationToken ct)
    {
        // Required already reports an empty password.
        if (discordId is null && !string.IsNullOrEmpty(form.Password) && PasswordService.ValidatePolicy(form.Password) is { } passwordProblem)
        {
            modelState.AddModelError(Key + nameof(form.Password), Localized.T(passwordProblem));
        }

        if (string.Equals(form.Username, SeedData.BotPlayerName, StringComparison.OrdinalIgnoreCase))
        {
            modelState.AddModelError(Key + nameof(form.Username), localizer["That username is reserved"]);
        }

        var cards = form.Cards.Distinct().ToList();
        var starterIds = await db.Cards.Where(c => c.Level == 1 && (c.ClassId == null || c.ClassId == form.PlayerType)).Select(c => c.Id).ToListAsync(ct);
        if (cards.Count != 5 || cards.Except(starterIds).Any())
        {
            modelState.AddModelError(Key + nameof(form.Cards), localizer["You must select 5 starter cards!"]);
        }

        if (form.PlayerType is { } typeId && !await db.PlayerTypes.AnyAsync(t => t.Id == typeId, ct))
        {
            modelState.AddModelError(Key + nameof(form.PlayerType), localizer["You must select a class"]);
        }

        // An empty username binds as null; its Required error is already in the model state.
        var normalized = modelState.IsValid ? Player.Normalize(form.Username) : string.Empty;
        if (modelState.IsValid && await db.Players.AnyAsync(p => p.NormalizedName == normalized, ct))
        {
            modelState.AddModelError(Key + nameof(form.Username), localizer["The username already exists"]);
        }

        if (!modelState.IsValid)
        {
            return null;
        }

        var player = new Player
        {
            Name = form.Username.Trim(),
            NormalizedName = normalized,
            // A Discord player has no password: a random one nobody knows.
            Password = passwords.Hash(discordId is null ? form.Password : Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))),
            PlayerTypeId = form.PlayerType!.Value,
            PlayerPermissionId = PlayerPermission.Player,
            Rank = 1,
            Money = 0,
            Created = time.GetUtcNow(),
            DiscordId = discordId,
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
            modelState.AddModelError(Key + nameof(form.Username), localizer["The username already exists"]);
            return null;
        }

        return player;
    }

    /// <summary>The register page: the classes by race and the starter cards to pick from.</summary>
    public async Task<RegisterPageModel> PageAsync(RegisterViewModel form, CancellationToken ct, bool discord = false)
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
            Discord = discord,
        };
    }
}
