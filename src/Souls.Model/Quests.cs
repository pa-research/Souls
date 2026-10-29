using Microsoft.EntityFrameworkCore;
using Souls.Model.Entities;

namespace Souls.Model;

/// <summary>What a player did in one game, counted by the game server for daily quests.</summary>
public sealed record GameCounters(bool Won, bool Practice, bool HardBot, int CardsPlayed, int CardsDestroyed, int AbilitiesUsed, int HeroDamage);

/// <summary>Daily quests: three a day, progressed by games, paid out in coins when completed.</summary>
public static class Quests
{
    public const int PerDay = 3;

    public sealed record Definition(QuestKind Kind, string Text, int Target, int Reward);

    public static readonly IReadOnlyList<Definition> All =
    [
        new(QuestKind.WinGames, "Win 2 normal games", 2, 4),
        new(QuestKind.PlayCards, "Play 12 cards", 12, 2),
        new(QuestKind.DestroyCards, "Destroy 8 enemy cards", 8, 2),
        new(QuestKind.UseAbilities, "Use 5 card abilities or hero powers", 5, 2),
        new(QuestKind.HeroDamage, "Deal 40 damage to enemy heroes", 40, 3),
        new(QuestKind.WinPractice, "Win a practice game on Hard", 1, 2),
    ];

    public static Definition Get(QuestKind kind) => All.First(d => d.Kind == kind);

    public static DateOnly Today(TimeProvider time) => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);

    /// <summary>Returns today's quests of the player, handing out new ones if there are none yet.</summary>
    public static async Task<List<PlayerQuest>> EnsureTodayAsync(SoulsDbContext db, int playerId, TimeProvider time, CancellationToken ct = default)
    {
        var today = Today(time);
        var quests = await db.PlayerQuests.Where(q => q.PlayerId == playerId && q.Day == today).OrderBy(q => q.Id).ToListAsync(ct);
        if (quests.Count > 0)
        {
            return quests;
        }

        // A stable pick per player and day.
        var rng = new Random(HashCode.Combine(playerId, today.DayNumber));
        foreach (var definition in All.OrderBy(_ => rng.Next()).Take(PerDay))
        {
            quests.Add(new PlayerQuest { PlayerId = playerId, Kind = definition.Kind, Day = today });
        }

        db.PlayerQuests.AddRange(quests);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Another request handed them out at the same time.
            db.ChangeTracker.Clear();
            return await db.PlayerQuests.Where(q => q.PlayerId == playerId && q.Day == today).OrderBy(q => q.Id).ToListAsync(ct);
        }

        return quests;
    }

    /// <summary>Adds the counters of a game to today's quests and pays out completed ones. Returns the coins earned.</summary>
    public static async Task<(int Coins, List<PlayerQuest> Quests)> ApplyAsync(SoulsDbContext db, int playerId, GameCounters counters, TimeProvider time, CancellationToken ct = default)
    {
        var quests = await EnsureTodayAsync(db, playerId, time, ct);
        var coins = 0;
        foreach (var quest in quests.Where(q => q.CompletedAt is null))
        {
            var definition = Get(quest.Kind);
            quest.Progress = Math.Min(definition.Target, quest.Progress + Amount(quest.Kind, counters));
            if (quest.Progress >= definition.Target)
            {
                quest.CompletedAt = time.GetUtcNow();
                coins += definition.Reward;
            }
        }

        return (coins, quests);
    }

    private static int Amount(QuestKind kind, GameCounters c) => kind switch
    {
        QuestKind.WinGames => c.Won && !c.Practice ? 1 : 0,
        QuestKind.PlayCards => c.CardsPlayed,
        QuestKind.DestroyCards => c.CardsDestroyed,
        QuestKind.UseAbilities => c.AbilitiesUsed,
        QuestKind.HeroDamage => c.HeroDamage,
        QuestKind.WinPractice => c.Won && c.Practice && c.HardBot ? 1 : 0,
        _ => 0,
    };
}
