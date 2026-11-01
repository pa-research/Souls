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
