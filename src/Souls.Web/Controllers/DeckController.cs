using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>The deck builder: pick 20 cards from the cards you own (at most 4 copies of a common card, 1 of a legendary).</summary>
public sealed class DeckController(SoulsDbContext db) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = "Deck";
        var playerId = User.RequirePlayerId();
        var owned = await db.PlayerCards.AsNoTracking()
            .Where(pc => pc.PlayerId == playerId)
            .Include(pc => pc.Card).ThenInclude(c => c!.Ability)
            .Include(pc => pc.Card).ThenInclude(c => c!.Race)
            .OrderBy(pc => pc.CardId)
            .ToListAsync(ct);
        var saved = await db.DeckCards.AsNoTracking().Where(d => d.PlayerId == playerId).ToListAsync(ct);

        // The deck the game server will use: the saved one if valid, otherwise the automatic one.
        var deck = Decks.Build(owned, pc => pc.CardId, pc => pc.Card!.Rarity, saved.Select(d => (d.CardId, d.Count)));
        var counts = deck.GroupBy(pc => pc.CardId).ToDictionary(g => g.Key, g => g.Count());
        return View(new DeckViewModel
        {
            Entries = [.. owned.Select(pc => new DeckEntry(CardTile.From(pc.Card!, owned: false, pc.Level), counts.GetValueOrDefault(pc.CardId)))],
            Custom = saved.Count > 0 && deck.Count == GameRules.DeckSize && Decks.Validate(saved.Select(d => (d.CardId, d.Count)), owned.ToDictionary(pc => pc.CardId, pc => pc.Card!.Rarity)) is null,
        });
    }

    /// <summary>Saves the deck: <c>count[cardId]</c> copies of each card.</summary>
    [HttpPost]
    public async Task<IActionResult> Save([FromForm(Name = "count")] Dictionary<int, int>? counts, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        counts ??= [];
        var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId)
            .Select(pc => new { pc.CardId, pc.Card!.Rarity })
            .ToDictionaryAsync(pc => pc.CardId, pc => pc.Rarity, ct);
        var deck = counts.Where(c => c.Value != 0).Select(c => (c.Key, c.Value)).ToList();
        if (Decks.Validate(deck, owned) is { } error)
        {
            TempData["Error"] = error;
            return RedirectToAction(nameof(Index));
        }

        await db.DeckCards.Where(d => d.PlayerId == playerId).ExecuteDeleteAsync(ct);
        db.DeckCards.AddRange(deck.Select(d => new DeckCard { PlayerId = playerId, CardId = d.Key, Count = d.Value }));
        await db.SaveChangesAsync(ct);
        TempData["Message"] = "Your deck was saved. It is used from your next game.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Goes back to the automatic deck (owned cards spread evenly).</summary>
    [HttpPost]
    public async Task<IActionResult> Reset(CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        await db.DeckCards.Where(d => d.PlayerId == playerId).ExecuteDeleteAsync(ct);
        TempData["Message"] = "You play with the automatic deck again.";
        return RedirectToAction(nameof(Index));
    }
}
