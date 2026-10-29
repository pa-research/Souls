using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Web.Models;

namespace Souls.Web.Controllers;

public sealed class GameController(SoulsDbContext db, IConfiguration configuration) : Controller
{
    /// <summary>The game client. It connects to the game server's WebSockets with the login cookie.</summary>
    /// <param name="watch">A running game to spectate (3D client).</param>
    public async Task<IActionResult> Index(int? watch, CancellationToken ct)
    {
        ViewData["Title"] = watch is null ? "Play" : "Watch";
        return View(await ConfigAsync(ct) with { Watch = watch });
    }

    /// <summary>Plays back a finished game in the 3D client.</summary>
    public async Task<IActionResult> Replay(int id, CancellationToken ct)
    {
        if (!await db.GameReplays.AnyAsync(r => r.GameId == id, ct))
        {
            return NotFound();
        }

        ViewData["Title"] = "Replay";
        return View("Index", await ConfigAsync(ct) with { ReplayUrl = Url.Action(nameof(ReplayData), new { id }), ReplayGameId = id });
    }

    /// <summary>The recorded spectator messages of a finished game.</summary>
    public async Task<IActionResult> ReplayData(int id, CancellationToken ct)
    {
        var data = await db.GameReplays.AsNoTracking().Where(r => r.GameId == id).Select(r => r.Data).SingleOrDefaultAsync(ct);
        return data is null ? NotFound() : Content(data, "application/json");
    }

    private async Task<GameConfig> ConfigAsync(CancellationToken ct)
    {
        var cards = await db.Cards.AsNoTracking()
            .OrderBy(c => c.Id)
            .Select(c => new CardPortrait(c.Id, c.Portrait ?? CardTile.DefaultPortrait))
            .ToListAsync(ct);
        var heroTypes = await db.PlayerTypes.AsNoTracking().OrderBy(t => t.Id).ToListAsync(ct);
        return new GameConfig(configuration["Souls:GameServerUrl"] ?? "/ws", cards) { Rules = RulesConfig.Create(heroTypes) };
    }

    [AllowAnonymous]
    public async Task<IActionResult> Stats(int id, CancellationToken ct)
    {
        ViewData["Title"] = "Stats";
        var game = await db.Games.AsNoTracking()
            .Include(g => g.Player1).ThenInclude(p => p!.PlayerType)
            .Include(g => g.Player2).ThenInclude(p => p!.PlayerType)
            .SingleOrDefaultAsync(g => g.Id == id, ct);
        if (game is null)
        {
            return NotFound();
        }

        var log = await db.GameLogs.AsNoTracking()
            .Include(l => l.GameLogType)
            .Where(l => l.GameId == id)
            .OrderBy(l => l.Id)
            .ToListAsync(ct);
        var cards = await db.Cards.AsNoTracking().ToDictionaryAsync(c => c.Id, ct);
        Player[] players = [game.Player1!, game.Player2!];

        var result = log.FirstOrDefault(l => l.GameLogTypeId is (int)GameLogKind.Won or (int)GameLogKind.Draw);
        return View(new GameStatsViewModel
        {
            GameId = id,
            Players = players,
            IsDraw = result?.GameLogTypeId == (int)GameLogKind.Draw,
            Winner = players.FirstOrDefault(p => p.Id == result?.Obj1Id),
            Log = [.. log.Where(l => l.GameLogTypeId != (int)GameLogKind.NewCard).Select(l => Describe(l, players, cards))],
            IsPractice = game.IsPractice,
            Turns = game.Turns,
            HasReplay = await db.GameReplays.AnyAsync(r => r.GameId == id, ct),
            RatingChanges = [game.Player1RatingChange, game.Player2RatingChange],
        });
    }

    private static string Describe(GameLog entry, Player[] players, Dictionary<int, Card> cards)
    {
        if (!string.IsNullOrEmpty(entry.Text))
        {
            return entry.Text;
        }

        string PlayerName(int id) => players.FirstOrDefault(p => p.Id == id)?.Name ?? "?";
        string CardName(int id) => cards.TryGetValue(id, out var c) ? c.Name : "a card";
        int CardAttack(int id) => cards.TryGetValue(id, out var c) ? c.Attack : 0;
        int PlayerAttack(int id) => players.FirstOrDefault(p => p.Id == id)?.PlayerType?.Attack ?? 0;

        var format = entry.GameLogType?.Text ?? string.Empty;
        object[] args = (GameLogKind)entry.GameLogTypeId switch
        {
            GameLogKind.Won or GameLogKind.Defeat or GameLogKind.Draw or GameLogKind.NextTurn or GameLogKind.GameCreated
                => [PlayerName(entry.Obj1Id), PlayerName(entry.Obj2Id)],
            GameLogKind.CardAttackPlayer => [CardName(entry.Obj1Id), PlayerName(entry.Obj2Id), CardAttack(entry.Obj1Id)],
            GameLogKind.CardAttackCard => [CardName(entry.Obj1Id), CardName(entry.Obj2Id), CardAttack(entry.Obj1Id)],
            GameLogKind.PlayerAttackPlayer => [PlayerName(entry.Obj1Id), PlayerName(entry.Obj2Id), PlayerAttack(entry.Obj1Id)],
            GameLogKind.PlayerAttackCard => [PlayerName(entry.Obj1Id), CardName(entry.Obj2Id), PlayerAttack(entry.Obj1Id)],
            GameLogKind.NewCard or GameLogKind.UseCard => [PlayerName(entry.Obj1Id), CardName(entry.Obj2Id)],
            GameLogKind.Kicked => [PlayerName(entry.Obj1Id)],
            GameLogKind.AbilityHeal or GameLogKind.AbilitySacrifice => [CardName(entry.Obj1Id)],
            _ => [],
        };

        if (entry.GameLogTypeId is (int)GameLogKind.AbilityHeal or (int)GameLogKind.AbilitySacrifice)
        {
            format = "{0} uses an ability.";
        }

        try
        {
            return string.Format(CultureInfo.InvariantCulture, format, args);
        }
        catch (FormatException)
        {
            return entry.GameLogType?.Title ?? "?";
        }
    }
}
