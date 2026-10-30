using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>Hansel's card shop: spend soul coins (earned by winning games and quests) on new cards and upgrades.</summary>
public sealed class ShopController(SoulsDbContext db, TimeProvider time) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = "Shop";
        var playerId = User.RequirePlayerId();
        var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId).ToDictionaryAsync(pc => pc.CardId, pc => pc.Level, ct);
        var cards = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race).OrderBy(c => c.Id).ToListAsync(ct);
        var player = await Summary(db, playerId, ct);

        return View(new ShopViewModel
        {
            Cards = [.. cards.Select(c => CardTile.From(c, owned.ContainsKey(c.Id), owned.GetValueOrDefault(c.Id, 1)))],
            Player = player,
        });
    }

    internal static Task<PlayerSummary> Summary(SoulsDbContext db, int playerId, CancellationToken ct) => db.Players.AsNoTracking()
        .Where(p => p.Id == playerId)
        .Select(p => new PlayerSummary(p.Name, p.Money, p.Rank, p.PlayerType!.Name, p.PlayerType.Health, p.PlayerType.Mana, p.PlayerType.Race!.Name) { Rating = p.Rating })
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
            TempData["Error"] = $"{card.Name} is already at the highest level.";
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
                return $"{card.Name} was already upgraded.";
            }

            var charged = await db.Players
                .Where(p => p.Id == playerId && p.Money >= cost)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money - cost), ct);
            if (charged == 0)
            {
                return $"You cannot afford to upgrade {card.Name}!";
            }

            await transaction.CommitAsync(ct);
            return null;
        });

        TempData[error is null ? "Message" : "Error"] = error ?? $"{card.Name} is now level {level + 1}!";
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

        // Charge and grant atomically; the conditional update and the unique (player, card) index make
        // double purchases and overspending impossible even with concurrent requests.
        var strategy = db.Database.CreateExecutionStrategy();
        var error = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            if (await db.PlayerCards.AnyAsync(pc => pc.PlayerId == playerId && pc.CardId == cardId, ct))
            {
                return $"You already own {card.Name}";
            }

            var charged = await db.Players
                .Where(p => p.Id == playerId && p.Money >= card.VendorPrice)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money - card.VendorPrice), ct);
            if (charged == 0)
            {
                return $"You cannot afford {card.Name}!";
            }

            db.PlayerCards.Add(new PlayerCard { PlayerId = playerId, CardId = cardId, ObtainedAt = time.GetUtcNow() });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // A concurrent purchase of the same card won; disposing the transaction refunds this one.
                return $"You already own {card.Name}";
            }

            await transaction.CommitAsync(ct);
            return null;
        });

        TempData[error is null ? "Message" : "Error"] = error ?? $"You bought {card.Name}!";
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
        var pool = await db.Cards.AsNoTracking().ToListAsync(ct);
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
                    ? "You cannot afford a card pack!"
                    : "Your soul coins changed in the meantime, so no pack was bought. Please try again.";
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

        ViewData["Title"] = "Card Pack";
        var results = opened.Chunk(3).ToList();
        var ids = results.Select(r => r[0]).ToList();
        var cards = await db.Cards.AsNoTracking().Include(c => c.Race).Where(c => ids.Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
        return View(results.Select(r => new PackCard(CardTile.From(cards[r[0]], owned: true, level: r[1]), r[2])).ToList());
    }
}
