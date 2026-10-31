using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>Hansel's card shop: spend soul coins (earned by winning games and quests) on new cards and upgrades.</summary>
public sealed class ShopController(SoulsDbContext db, TimeProvider time, IStringLocalizer<SharedResource> localizer) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = localizer["Shop"].Value;
        var playerId = User.RequirePlayerId();
        var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId).ToDictionaryAsync(pc => pc.CardId, pc => pc.Level, ct);
        var classId = await ClassOf(playerId, ct);
        var cards = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race).Include(c => c.Class)
            .Where(c => c.ClassId == null || c.ClassId == classId).OrderBy(c => c.Id).ToListAsync(ct);
        var player = await Summary(db, playerId, ct);

        return View(new ShopViewModel
        {
            Cards = [.. cards.Select(c => CardTile.From(c, owned.ContainsKey(c.Id), owned.GetValueOrDefault(c.Id, 1)))],
            Player = player,
        });
    }

    private Task<int> ClassOf(int playerId, CancellationToken ct) => db.Players.Where(p => p.Id == playerId).Select(p => p.PlayerTypeId).SingleAsync(ct);

    internal static Task<PlayerSummary> Summary(SoulsDbContext db, int playerId, CancellationToken ct) => db.Players.AsNoTracking()
        .Where(p => p.Id == playerId)
        .Select(p => new PlayerSummary(p.Name, p.Money, p.Rank, p.PlayerType!.Name, p.PlayerType.Health, p.PlayerType.Mana, p.PlayerType.RaceId == null ? null : Localized.T(GameRules.RaceName(p.PlayerType.RaceId.Value))) { Rating = p.Rating })
        .SingleAsync(ct);

    /// <summary>Levels up an owned card (+1 attack and health per level).</summary>
    [HttpPost]
    public async Task<IActionResult> Upgrade(int cardId, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        var card = await db.Cards.AsNoTracking().SingleOrDefaultAsync(c => c.Id == cardId, ct);
        var owned = card is null ? null : await db.PlayerCards.AsNoTracking().SingleOrDefaultAsync(pc => pc.PlayerId == playerId && pc.CardId == cardId, ct);
        if (card is null || owned is null)
        {
            return NotFound();
        }

        if (owned.Level >= GameRules.MaxCardLevel)
        {
            TempData["Error"] = localizer["{0} is already at the highest level.", card.Name].Value;
            return RedirectToAction(nameof(Index));
        }

        var cost = GameRules.UpgradeCost(card, owned.Level);
        var level = owned.Level;
        var strategy = db.Database.CreateExecutionStrategy();
        var error = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            // Only upgrades from the level the player saw, so a double submit cannot skip a level or charge twice.
            var upgraded = await db.PlayerCards
                .Where(pc => pc.Id == owned.Id && pc.Level == level)
                .ExecuteUpdateAsync(s => s.SetProperty(pc => pc.Level, level + 1), ct);
            if (upgraded == 0)
            {
                return localizer["{0} was already upgraded.", card.Name].Value;
            }

            var charged = await db.Players
                .Where(p => p.Id == playerId && p.Money >= cost)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money - cost), ct);
            if (charged == 0)
            {
                return localizer["You cannot afford to upgrade {0}!", card.Name].Value;
            }

            await transaction.CommitAsync(ct);
            return null;
        });

        TempData[error is null ? "Message" : "Error"] = error ?? localizer["{0} is now level {1}!", card.Name, level + 1].Value;
        return RedirectToAction(nameof(Index));
    }

    [HttpPost]
    public async Task<IActionResult> Buy(int cardId, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        var card = await db.Cards.AsNoTracking().SingleOrDefaultAsync(c => c.Id == cardId, ct);
        if (card is null)
        {
            return NotFound();
        }

        if (!GameRules.CanUse(card.ClassId, await ClassOf(playerId, ct)))
        {
            TempData["Error"] = localizer["{0} is a card of another class.", card.Name].Value;
            return RedirectToAction(nameof(Index));
        }

        // Charge and grant atomically; the conditional update and the unique (player, card) index make
        // double purchases and overspending impossible even with concurrent requests.
        var strategy = db.Database.CreateExecutionStrategy();
        var error = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            if (await db.PlayerCards.AnyAsync(pc => pc.PlayerId == playerId && pc.CardId == cardId, ct))
            {
                return localizer["You already own {0}", card.Name].Value;
            }

            var charged = await db.Players
                .Where(p => p.Id == playerId && p.Money >= card.VendorPrice)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money - card.VendorPrice), ct);
            if (charged == 0)
            {
                return localizer["You cannot afford {0}!", card.Name].Value;
            }

            db.PlayerCards.Add(new PlayerCard { PlayerId = playerId, CardId = cardId, ObtainedAt = time.GetUtcNow() });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // A concurrent purchase of the same card won; disposing the transaction refunds this one.
                return localizer["You already own {0}", card.Name].Value;
            }

            await transaction.CommitAsync(ct);
            return null;
        });

        TempData[error is null ? "Message" : "Error"] = error ?? localizer["You bought {0}!", card.Name].Value;
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Buys a random pack (<see cref="Packs"/>): new cards are added, cards the player owns level up, and duplicates of
    /// cards at the highest level pay back coins. <paramref name="money"/> is the balance the player saw.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> BuyPack(int money, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        var classId = await ClassOf(playerId, ct);
        var pool = await db.Cards.AsNoTracking().Where(c => c.ClassId == null || c.ClassId == classId).ToListAsync(ct);
        int[]? opened = null;
        var strategy = db.Database.CreateExecutionStrategy();
        var error = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            // Only from the balance the player saw, so a double submit cannot buy a second pack. The charge also locks
            // the player's row, so the player's other purchases wait until this pack is granted.
            var charged = await db.Players
                .Where(p => p.Id == playerId && p.Money == money && p.Money >= Packs.Price)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money - Packs.Price), ct);
            if (charged == 0)
            {
                return await db.Players.Where(p => p.Id == playerId).Select(p => p.Money).SingleAsync(ct) < Packs.Price
                    ? localizer["You cannot afford a card pack!"].Value
                    : localizer["Your soul coins changed in the meantime, so no pack was bought. Please try again."].Value;
            }

            var pack = Packs.Open(pool, Random.Shared);
            var ids = pack.Select(c => c.Id).ToList();
            var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId && ids.Contains(pc.CardId)).ToDictionaryAsync(pc => pc.CardId, ct);
            var result = new List<int>();
            var refund = 0;
            foreach (var card in pack)
            {
                var coins = 0;
                if (!owned.TryGetValue(card.Id, out var playerCard))
                {
                    owned[card.Id] = playerCard = db.PlayerCards.Add(new PlayerCard { PlayerId = playerId, CardId = card.Id, ObtainedAt = time.GetUtcNow() }).Entity;
                }
                else if (playerCard.Level < GameRules.MaxCardLevel)
                {
                    playerCard.Level++;
                }
                else
                {
                    coins = Packs.Refund(card.VendorPrice);
                    refund += coins;
                }

                result.AddRange([card.Id, playerCard.Level, coins]);
            }

            if (refund > 0)
            {
                await db.Players.Where(p => p.Id == playerId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money + refund), ct);
            }

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            opened = [.. result];
            return null;
        });

        if (error is not null)
        {
            TempData["Error"] = error;
            return RedirectToAction(nameof(Index));
        }

        TempData["Pack"] = opened;
        return RedirectToAction(nameof(Pack));
    }

    /// <summary>The pack just bought, face down until the player turns the cards over.</summary>
    public async Task<IActionResult> Pack(CancellationToken ct)
    {
        // Card id, level and coins paid back for each card (see BuyPack).
        if (TempData["Pack"] is not int[] opened)
        {
            return RedirectToAction(nameof(Index));
        }

        ViewData["Title"] = localizer["Card Pack"].Value;
        var results = opened.Chunk(3).ToList();
        var ids = results.Select(r => r[0]).ToList();
        var cards = await db.Cards.AsNoTracking().Include(c => c.Race).Include(c => c.Class).Where(c => ids.Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
        return View(results.Select(r => new PackCard(CardTile.From(cards[r[0]], owned: true, level: r[1]), r[2])).ToList());
    }
}
