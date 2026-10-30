using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;
using Souls.Web.Services;

namespace Souls.Web.Controllers;

/// <summary>
/// The deck builder: pick 20 cards from the cards you own (at most 4 copies of a common card, 1 of a legendary) and the
/// hero power you play with. Another class's cards never show up or count (see <see cref="GameRules.CanUse"/>).
/// </summary>
public sealed class DeckController(SoulsDbContext db) : Controller
{
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = "Deck";
        var playerId = User.RequirePlayerId();
        var player = await db.Players.AsNoTracking().Where(p => p.Id == playerId)
            .Select(p => new { p.PlayerTypeId, p.HeroPowerId, Class = p.PlayerType!.Name }).SingleAsync(ct);
        var owned = await db.PlayerCards.AsNoTracking()
            .Where(pc => pc.PlayerId == playerId && (pc.Card!.ClassId == null || pc.Card.ClassId == player.PlayerTypeId))
            .Include(pc => pc.Card).ThenInclude(c => c!.Ability)
            .Include(pc => pc.Card).ThenInclude(c => c!.Race)
            .Include(pc => pc.Card).ThenInclude(c => c!.Class)
            .OrderBy(pc => pc.CardId)
            .ToListAsync(ct);
        var saved = await db.DeckCards.AsNoTracking().Where(d => d.PlayerId == playerId).ToListAsync(ct);

        // The deck the game server will use: the saved one if valid, otherwise the automatic one.
        var deck = Decks.Build(owned, pc => pc.CardId, pc => pc.Card!.Rarity, saved.Select(d => (d.CardId, d.Count)));
        var counts = deck.GroupBy(pc => pc.CardId).ToDictionary(g => g.Key, g => g.Count());
        var power = GameRules.PowerOf(player.PlayerTypeId, player.HeroPowerId);
        return View(new DeckViewModel
        {
            Entries = [.. owned.Select(pc => new DeckEntry(CardTile.From(pc.Card!, owned: false, pc.Level), counts.GetValueOrDefault(pc.CardId)))],
            Custom = saved.Count > 0 && deck.Count == GameRules.DeckSize && Decks.Validate(saved.Select(d => (d.CardId, d.Count)), owned.ToDictionary(pc => pc.CardId, pc => pc.Card!.Rarity)) is null,
            ClassName = player.Class,
            HeroPowers = [.. GameRules.PowersOf(player.PlayerTypeId).Select(id => new HeroPowerOption(id, GameRules.HeroPowers[id], id == power))],
        });
    }

    /// <summary>Saves the deck: <c>count[cardId]</c> copies of each card.</summary>
    [HttpPost]
    public async Task<IActionResult> Save([FromForm(Name = "count")] Dictionary<int, int>? counts, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        counts ??= [];
        var classId = await db.Players.Where(p => p.Id == playerId).Select(p => p.PlayerTypeId).SingleAsync(ct);
        var owned = await db.PlayerCards.Where(pc => pc.PlayerId == playerId)
            .Select(pc => new { pc.CardId, pc.Card!.Rarity, pc.Card.ClassId, pc.Card.Name })
            .ToListAsync(ct);
        var deck = counts.Where(c => c.Value != 0).Select(c => (c.Key, c.Value)).ToList();
        var otherClass = owned.FirstOrDefault(pc => counts.GetValueOrDefault(pc.CardId) != 0 && !GameRules.CanUse(pc.ClassId, classId));
        var error = otherClass is not null
            ? $"{otherClass.Name} is a card of another class."
            : Decks.Validate(deck, owned.ToDictionary(pc => pc.CardId, pc => pc.Rarity));
        if (error is not null)
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

    /// <summary>Picks the hero power the player plays with: one of the two of their class.</summary>
    [HttpPost]
    public async Task<IActionResult> HeroPower(int power, CancellationToken ct)
    {
        var playerId = User.RequirePlayerId();
        var classId = await db.Players.Where(p => p.Id == playerId).Select(p => p.PlayerTypeId).SingleAsync(ct);
        if (!GameRules.HeroPowers.TryGetValue(power, out var picked) || picked.ClassId != classId)
        {
            TempData["Error"] = "Your class cannot use that hero power.";
            return RedirectToAction(nameof(Index));
        }

        await db.Players.Where(p => p.Id == playerId).ExecuteUpdateAsync(s => s.SetProperty(p => p.HeroPowerId, power), ct);
        TempData["Message"] = $"You play with {picked.Name} from your next game.";
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
