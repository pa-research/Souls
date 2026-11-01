using Souls.Model.Entities;
using Souls.Server.Ai;

namespace Souls.Tests.Unit;

public class AiCommunityTests
{
    [Fact]
    public void APersonaIsOnlineInItsHoursByItsClock()
    {
        // 19:00-22:00 in UTC+1 (18:00-21:00 UTC), on a day it plays.
        var persona = new Persona { PlayerId = 1, UtcOffset = 60, PlayFrom = 19, PlayHours = 3 };
        var day = Enumerable.Range(0, 7).Select(d => new DateTimeOffset(2026, 11, 2 + d, 0, 0, 0, TimeSpan.Zero))
            .First(d => AiCommunity.IsOnline(persona, d.AddHours(18)));
        Assert.True(AiCommunity.IsOnline(persona, day.AddHours(20.9)));
        Assert.False(AiCommunity.IsOnline(persona, day.AddHours(17.9)));
        Assert.False(AiCommunity.IsOnline(persona, day.AddHours(21)));

        // Five days in seven.
        Assert.Equal(5, Enumerable.Range(0, 7).Count(d => AiCommunity.IsOnline(persona, day.AddDays(d).AddHours(19))));
    }

    [Fact]
    public void AQuietHourBorrowsPersonasSoGamesNeverStop()
    {
        // Everyone plays 19:00-20:00 UTC: at 04:00 nobody would be online.
        var roster = Enumerable.Range(1, 50).Select(id => new Persona { PlayerId = id, PlayFrom = 19, PlayHours = 1 }).ToList();
        var night = new DateTimeOffset(2026, 11, 2, 4, 0, 0, TimeSpan.Zero);
        var online = AiCommunity.Online(roster, night, 16);
        Assert.Equal(16, online.Count);
        Assert.Equal(online, AiCommunity.Online(roster, night.AddMinutes(59), 16));
        Assert.NotEqual(online, AiCommunity.Online(roster, night.AddHours(1), 16));
        Assert.Equal(16, AiCommunity.Online(roster, night.AddHours(1), 16).Count);
    }

    [Fact]
    public void PersonasArePairedCloseInRating()
    {
        var ratings = Enumerable.Range(0, 100).Select(i => 1000 + i * 10).ToList();
        var pairs = AiCommunity.Pair(ratings, r => r, chance: 1, new Random(3));
        Assert.Equal(50, pairs.Count);
        // One of the three closest: the last few left over may be further apart.
        Assert.InRange(pairs.Average(p => Math.Abs(p.Item1 - p.Item2)), 10, 60);
        Assert.Empty(AiCommunity.Pair(ratings, r => r, chance: 0, new Random(3)));
    }

    [Fact]
    public void AGameBringsAStreakTheFeedAndSometimesACard()
    {
        // Bronze I (rank 3) to Silver III (rank 4): a new tier; the fifth win in a row.
        var (streak, events, _) = AiCommunity.AfterGame(3, 4, 4, won: true, new Random(1));
        Assert.Equal(5, streak);
        Assert.Equal([(PlayerEventKind.Tier, 4), (PlayerEventKind.Streak, 5)], events);
        Assert.Empty(AiCommunity.AfterGame(4, 5, 3, won: false, new Random(1)).Events);
        Assert.Equal(0, AiCommunity.AfterGame(4, 4, 7, won: null, new Random(1)).Streak);
        Assert.InRange(Enumerable.Range(0, 1000).Count(i => AiCommunity.AfterGame(1, 1, 0, won: true, new Random(i)).NewCard), 25, 80);
    }

    [Fact]
    public void ThereAreAThousandUsableNames()
    {
        // Few repeat: the first 1000 give almost 1000 names (the server skips names already taken).
        var names = AiCommunity.Names().Take(1000).ToList();
        Assert.True(names.Select(Player.Normalize).Distinct().Count() > 950);
        Assert.All(names, n => Assert.Matches("^[A-Za-z0-9_-]{3,20}$", n));
    }

    [Fact]
    public void ASkillsRatingIsWhereItPlaysOnTheLadder()
    {
        Assert.Equal(BotSkill.Anchor, BotSkill.RatingOf(0));
        foreach (var skill in new[] { 0.05, 0.3, 0.55, 0.8, 0.95 })
        {
            // Ratings are whole numbers: a point is a few thousandths of skill on the steep parts of the ladder.
            Assert.InRange(BotSkill.ForRating(BotSkill.RatingOf(skill)) - skill, -0.01, 0.01);
        }
    }
}
