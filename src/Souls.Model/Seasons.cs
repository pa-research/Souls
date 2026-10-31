using Microsoft.EntityFrameworkCore;
using Souls.Model.Entities;

namespace Souls.Model;

public sealed class SeasonOptions
{
    /// <summary>Length of a new season (season 1 starts when <c>migrate</c> first runs).</summary>
    public TimeSpan Length { get; set; } = TimeSpan.FromDays(56);
}

/// <summary>
/// Ranked seasons. When a season ends, every player who played a normal game in it gets a final standing and a
/// reward for the tier of their final rating, and every rating is reset halfway towards the initial rating.
/// </summary>
public static class Seasons
{
    /// <summary>A player's place in a season: their rating, and the normal games they played and won in it.</summary>
    public sealed record Standing(int PlayerId, string Name, int Rating, int Games, int Wins);

    /// <summary>Soft reset halfway towards <see cref="Ratings.Initial"/>: 1400 becomes 1200, 900 becomes 950.</summary>
    public static int ResetRating(int rating) => Ratings.Initial + (rating - Ratings.Initial) / 2;

    /// <summary>Coins for the tier of the final rank; Diamond and Champion also get a legendary card they don't own yet.</summary>
    public static (int Coins, bool Legendary) Reward(int rank) => Ratings.TierOf(rank).Name switch
    {
        "Champion" => (50, true),
        "Diamond" => (40, true),
        "Platinum" => (30, false),
        "Gold" => (20, false),
        "Silver" => (10, false),
        _ => (5, false),
    };

    /// <summary>
    /// The name of a season with the default name ("Season 3") in the reader's language, or <c>null</c> for a name an
    /// administrator gave it (shown as it is).
    /// </summary>
    public static Localization.GameText? NameText(Season season) =>
        season.Name == DefaultName(season.Number) ? new Localization.GameText("season.name", ("n", season.Number)) : null;

    public static string DefaultName(int number) => $"Season {number}";

    public static Task<Season?> CurrentAsync(SoulsDbContext db, CancellationToken ct = default) =>
        db.Seasons.AsNoTracking().OrderByDescending(s => s.Number).FirstOrDefaultAsync(ct);

    /// <summary>Players who started a normal game in [<paramref name="from"/>, <paramref name="to"/>), best rating first.</summary>
    public static IQueryable<Standing> Standings(SoulsDbContext db, DateTimeOffset from, DateTimeOffset? to = null)
    {
        var games = db.Games.Where(g => !g.IsPractice && g.Created >= from && (to == null || g.Created < to));
        return db.Players
            .Where(p => !p.IsSystem)
            .Select(p => new { p.Id, p.Name, p.Rating, Games = games.Count(g => g.Player1Id == p.Id || g.Player2Id == p.Id), Wins = games.Count(g => g.WinnerId == p.Id) })
            .Where(x => x.Games > 0)
            .OrderByDescending(x => x.Rating).ThenByDescending(x => x.Wins).ThenBy(x => x.Id)
            .Select(x => new Standing(x.Id, x.Name, x.Rating, x.Games, x.Wins));
    }

    /// <summary>
    /// Ends the current season once its end has passed: stores the final standings, pays the rewards, resets every
    /// rating and starts the next season, all in one transaction. Inserting the next season claims the rollover, so a
    /// concurrent or repeated call does nothing. Returns the season that ended, or <c>null</c>.
    /// </summary>
    public static async Task<Season?> EndIfDueAsync(SoulsDbContext db, TimeProvider time, SeasonOptions options, CancellationToken ct = default)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            var now = time.GetUtcNow();
            var season = await db.Seasons.OrderByDescending(s => s.Number).FirstOrDefaultAsync(ct);
            if (season is null || season.EndsAt > now)
            {
                return null;
            }

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            season.EndsAt = now;
            db.Seasons.Add(new Season { Number = season.Number + 1, Name = DefaultName(season.Number + 1), StartsAt = now, EndsAt = now + options.Length });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Another rollover inserted the next season first; disposing the transaction undoes this one.
                return null;
            }

            var standings = await Standings(db, season.StartsAt, now).ToListAsync(ct);
            // Class cards are left out: a reward has to be playable by every class.
            var legendaries = await db.Cards.Where(c => c.Rarity == Rarity.Legendary && c.ClassId == null).Select(c => c.Id).ToListAsync(ct);
            var owned = (await db.PlayerCards.Where(pc => legendaries.Contains(pc.CardId)).Select(pc => new { pc.PlayerId, pc.CardId }).ToListAsync(ct))
                .ToLookup(pc => pc.PlayerId, pc => pc.CardId);
            var paid = new List<SeasonStanding>(standings.Count);
            for (var i = 0; i < standings.Count; i++)
            {
                var standing = standings[i];
                var rank = Ratings.RankOf(standing.Rating);
                var (coins, legendary) = Reward(rank);
                var missing = legendary ? legendaries.Except(owned[standing.PlayerId]).ToList() : [];
                int? card = missing.Count > 0 ? missing[Random.Shared.Next(missing.Count)] : null;
                paid.Add(new SeasonStanding
                {
                    SeasonNumber = season.Number,
                    PlayerId = standing.PlayerId,
                    Position = i + 1,
                    Rating = standing.Rating,
                    Rank = rank,
                    Games = standing.Games,
                    Wins = standing.Wins,
                    RewardCoins = coins,
                    RewardCardId = card,
                });
                if (card is { } cardId)
                {
                    db.PlayerCards.Add(new PlayerCard { PlayerId = standing.PlayerId, CardId = cardId, ObtainedAt = now });
                }
            }

            db.SeasonStandings.AddRange(paid);
            await db.SaveChangesAsync(ct);

            // Coins are added in SQL so a purchase on the site at the same moment is not overwritten.
            foreach (var group in paid.GroupBy(s => s.RewardCoins))
            {
                var ids = group.Select(s => s.PlayerId).ToList();
                await db.Players.Where(p => ids.Contains(p.Id)).ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money + group.Key), ct);
            }

            // ponytail: loads every player away from the initial rating; a set-based UPDATE if that ever gets too many.
            foreach (var player in await db.Players.Where(p => !p.IsSystem && p.Rating != Ratings.Initial).ToListAsync(ct))
            {
                player.Rating = ResetRating(player.Rating);
                player.Rank = Ratings.RankOf(player.Rating);
            }

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return season;
        });
    }
}
