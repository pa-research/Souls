using System.Security.Cryptography;
using System.Text.RegularExpressions;
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
/// cards. Used by the register page and, without a form, for a Discord account the first time it opens the Activity
/// (<see cref="CreateForDiscordAsync"/>).
/// </summary>
public sealed partial class PlayerRegistration(SoulsDbContext db, PasswordService passwords, TimeProvider time, IStringLocalizer<SharedResource> localizer)
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

    /// <summary>
    /// The account of a Discord user who opens the Activity for the first time: a free name made from their Discord
    /// name, a random hero (changed on the Deck page) and the first five common starter cards; no password (they sign
    /// in with Discord, or link a Souls account of theirs later).
    /// </summary>
    public async Task<Player> CreateForDiscordAsync(string discordId, string discordName, CancellationToken ct)
    {
        var types = await db.PlayerTypes.OrderBy(t => t.Id).Select(t => t.Id).ToListAsync(ct);
        var cards = await db.Cards.Where(c => c.Level == 1 && c.ClassId == null && c.Rarity == Rarity.Common)
            .OrderBy(c => c.Id).Select(c => c.Id).Take(5).ToListAsync(ct);
        var name = SuggestName(discordName);
        for (var attempt = 0; ; attempt++)
        {
            var form = new RegisterViewModel
            {
                Username = attempt == 0 ? name : $"{name[..Math.Min(name.Length, 16)]}{Random.Shared.Next(100, 10000)}",
                PlayerType = types[Random.Shared.Next(types.Count)],
                Cards = cards,
            };
            var problems = new ModelStateDictionary();
            if (await CreateAsync(form, problems, discordId, ct) is { } player)
            {
                return player;
            }

            // Opened twice at once: the other request made it.
            if (await db.Players.SingleOrDefaultAsync(p => p.DiscordId == discordId, ct) is { } made)
            {
                return made;
            }

            if (attempt >= 20)
            {
                throw new InvalidOperationException("No free name for a Discord player: " + string.Join("; ", problems.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage)));
            }

            db.ChangeTracker.Clear();
        }
    }

    /// <summary>A Discord name as a Souls username (3-20 letters, digits, '-' or '_').</summary>
    public static string SuggestName(string name)
    {
        var clean = NotAllowed().Replace(name, "_");
        clean = clean.Length > 20 ? clean[..20] : clean;
        return clean.PadRight(3, '_');
    }

    [GeneratedRegex("[^A-Za-z0-9_-]")]
    private static partial Regex NotAllowed();

    /// <summary>The register page: the classes by race and the starter cards to pick from.</summary>
    public async Task<RegisterPageModel> PageAsync(RegisterViewModel form, CancellationToken ct)
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
