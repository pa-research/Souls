using System.Globalization;
using System.Net;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;

namespace Souls.Tests.Integration;

[Collection(SoulsCollection.Name)]
public class SeasonTests(SoulsAppFixture app)
{
    private const string Password = "CorrectHorse9!";

    [Fact]
    public async Task EndingASeasonStoresStandingsPaysRewardsOnceAndResetsRatings()
    {
        // A Diamond II (registered, so the profile can be checked) and a Bronze who played each other this season,
        // and a Gold who did not play.
        var names = Enumerable.Range(0, 3).Select(_ => "s" + Guid.NewGuid().ToString("N")[..10]).ToArray();
        using var browser = app.CreateBrowser();
        await browser.RegisterAsync(names[0], Password);
        var (ids, season) = await app.WithDbAsync(async db =>
        {
            db.Players.AddRange(names[1..].Select(n => new Player { Name = n, NormalizedName = Player.Normalize(n), Password = "!", PlayerTypeId = 2 }));
            await db.SaveChangesAsync();
            var playerIds = await db.Players.Where(p => names.Contains(p.Name)).OrderBy(p => p.Id).Select(p => p.Id).ToArrayAsync();
            int[] ratings = [1650, 900, 1300];
            for (var i = 0; i < playerIds.Length; i++)
            {
                await db.Players.Where(p => p.Id == playerIds[i]).ExecuteUpdateAsync(s => s.SetProperty(p => p.Rating, ratings[i]).SetProperty(p => p.Money, 7).SetProperty(p => p.RatingDeviation, 80));
            }

            db.Games.Add(new Game { Player1Id = playerIds[0], Player2Id = playerIds[1], WinnerId = playerIds[0], Created = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
            return (playerIds, (await Seasons.CurrentAsync(db))!);
        });

        // The admin ends the season early.
        using var admin = app.CreateBrowser();
        using (await admin.LoginAsync(SoulsAppFixture.AdminName, SoulsAppFixture.AdminPassword))
        {
        }

        IEnumerable<KeyValuePair<string, string>> endNow = [new("Form.Number", season.Number.ToString(CultureInfo.InvariantCulture)), new("Form.Name", season.Name), new("endNow", "true")];
        using var end = await admin.PostFormAsync("/Admin/Season", "/Admin/Season", endNow);
        Assert.Equal(HttpStatusCode.Redirect, end.StatusCode);

        // Two rollovers at once (the game server's own check may run too): exactly one of them does the work.
        var ended = await Task.WhenAll(EndAsync(), EndAsync());
        Assert.True(ended.Count(s => s is not null) <= 1);
        Assert.Null(await EndAsync());

        await app.WithDbAsync(async db =>
        {
            Assert.Equal(season.Number + 1, (await Seasons.CurrentAsync(db))!.Number);
            var standings = await db.SeasonStandings.Where(s => s.SeasonNumber == season.Number && ids.Contains(s.PlayerId)).OrderBy(s => s.Position).ToListAsync();
            Assert.Equal([ids[0], ids[1]], standings.Select(s => s.PlayerId));
            var (diamond, bronze) = (standings[0], standings[1]);
            Assert.Equal((1650, 14, 1, 1, 40), (diamond.Rating, diamond.Rank, diamond.Games, diamond.Wins, diamond.RewardCoins));
            Assert.Equal((900, 1, 1, 0, 5, (int?)null), (bronze.Rating, bronze.Rank, bronze.Games, bronze.Wins, bronze.RewardCoins, bronze.RewardCardId));
            Assert.Equal(Rarity.Legendary, await db.Cards.Where(c => c.Id == diamond.RewardCardId).Select(c => c.Rarity).SingleAsync());
            Assert.True(await db.PlayerCards.AnyAsync(pc => pc.PlayerId == ids[0] && pc.CardId == diamond.RewardCardId));

            // Rewards were paid once; every rating moved halfway back to 1000, also of the player who did not play, and
            // became less certain, so the new season finds everyone's level quickly.
            var players = await db.Players.Where(p => ids.Contains(p.Id)).OrderBy(p => p.Id).Select(p => new { p.Money, p.Rating, p.Rank, p.RatingDeviation }).ToListAsync();
            Assert.Equal([(47, 1325, 7), (12, 950, 1), (7, 1150, 4)], players.Select(p => (p.Money, p.Rating, p.Rank)));
            Assert.All(players, p => Assert.Equal(Ratings.SeasonDeviation, p.RatingDeviation));

            db.Games.Add(new Game { Player1Id = ids[1], Player2Id = ids[2], WinnerId = ids[2], Created = DateTimeOffset.UtcNow });
            return await db.SaveChangesAsync();
        });

        // A form left open over the rollover cannot change the ended season.
        using var stale = await admin.PostFormAsync("/Admin/Season", "/Admin/Season", endNow);
        using var adminPage = await admin.GetAsync("/Admin/Season");
        var adminHtml = await adminPage.Content.ReadAsStringAsync();
        Assert.Contains("That season has already ended.", adminHtml, StringComparison.Ordinal);
        Assert.Contains($"Season {season.Number + 1}", adminHtml, StringComparison.Ordinal);

        // The leaderboard: the final standings of the ended season, and the live one of the new season.
        using var past = await browser.GetAsync($"/Season/Index/{season.Number}");
        var pastHtml = await past.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, past.StatusCode);
        Assert.Contains("Final standings", pastHtml, StringComparison.Ordinal);
        Assert.Contains(names[0], pastHtml, StringComparison.Ordinal);
        Assert.Contains(names[1], pastHtml, StringComparison.Ordinal);
        Assert.DoesNotContain(names[2], pastHtml, StringComparison.Ordinal);

        using var current = await browser.GetAsync("/Season");
        var currentHtml = await current.Content.ReadAsStringAsync();
        Assert.Contains($"Season {season.Number + 1}", currentHtml, StringComparison.Ordinal);
        Assert.Contains(names[2], currentHtml, StringComparison.Ordinal);
        Assert.DoesNotContain(names[0], currentHtml, StringComparison.Ordinal);

        // The profile shows the new season and the best finish.
        using (await browser.LoginAsync(names[0], Password))
        {
        }

        using var home = await browser.GetAsync("/");
        var homeHtml = await home.Content.ReadAsStringAsync();
        Assert.Contains($"Season {season.Number + 1}</a>:", homeHtml, StringComparison.Ordinal);
        Assert.Matches($"Best finish: #\\d+ in {season.Name} \\(Diamond II\\)", homeHtml);

        Task<Season?> EndAsync() => app.WithDbAsync(db => Seasons.EndIfDueAsync(db, TimeProvider.System, new SeasonOptions()));
    }
}
