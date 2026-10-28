using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>Hansel's card shop: spend soul coins (earned by winning games) on new cards.</summary>
public sealed class ShopController(SoulsDbContext db, TimeProvider time) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = "Shop";
        var playerId = User.RequirePlayerId();
        var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId).Select(pc => pc.CardId).ToListAsync(ct);
        var cards = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race).OrderBy(c => c.Id).ToListAsync(ct);
        var player = await db.Players.AsNoTracking()
            .Where(p => p.Id == playerId)
            .Select(p => new PlayerSummary(p.Name, p.Money, p.Rank, p.PlayerType!.Name, p.PlayerType.Health, p.PlayerType.Mana, p.PlayerType.Race!.Name))
            .SingleAsync(ct);

        return View(new ShopViewModel
        {
            Cards = [.. cards.Select(c => CardTile.From(c, owned.Contains(c.Id)))],
            Player = player,
        });
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
}
