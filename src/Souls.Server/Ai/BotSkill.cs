namespace Souls.Server.Ai;

/// <summary>
/// The dial of a ranked bot (<see cref="AiPlayer"/> with a skill): one number from 0 (weakest) to 1 (strongest) sets
/// how far it searches, how often it takes a worse action and how often it misses a win. tools/Souls.Sim --ladder
/// measures what rating each skill plays at (docs/ranked-bots.md).
/// </summary>
public static class BotSkill
{
    /// <summary>From this skill on, the bot sends back expensive starting cards (as the Normal and Hard bots do).</summary>
    public const double MulliganSkill = 0.3;

    /// <summary>
    /// The temperature of the softmax over the actions' scores (2 points per point of hero health): at 0 a bot takes
    /// almost any reasonable action, at 1 always the best.
    /// </summary>
    public static double Temperature(double skill) => 150 * Math.Pow(1 - Math.Clamp(skill, 0, 1), 2);

    /// <summary>How often the bot does not see that an action wins the game: 90 % at skill 0, never at 1.</summary>
    public static double MissLethal(double skill) => 0.9 * Math.Pow(1 - Math.Clamp(skill, 0, 1), 2);

    /// <summary>How often the bot takes any of its actions (or ends the turn) at random, as a beginner does: 50 % at 0.</summary>
    public static double Wander(double skill) => 0.5 * Math.Pow(1 - Math.Clamp(skill, 0, 1), 3);

    /// <summary>
    /// What skills 0, 0.1 ... 1 play at against each other, the weakest at 0: tools/Souls.Sim --ladder, 5400 games
    /// (docs/bot-ladder.md). Run it again when the bot or the cards change.
    /// </summary>
    private static readonly int[] Ladder = [0, 35, 55, 71, 131, 167, 226, 316, 406, 478, 491];

    /// <summary>
    /// Where the ladder sits on the players' scale: skill 0 plays like a player rated this. A first guess until real
    /// games exist; the live calibration (docs/ranked-bots.md, phase 5) moves it to where bots score 50 % against
    /// people of their rating. The top of the dial (skill 1) then plays at about Gold II; stronger bots need the
    /// better decks and upgraded cards of phase 3.
    /// </summary>
    public const int Anchor = 900;

    /// <summary>The skill that plays at <paramref name="rating"/>: interpolated on the ladder, 0 below it, 1 above.</summary>
    public static double ForRating(int rating, int anchor = Anchor)
    {
        var target = rating - anchor;
        if (target <= Ladder[0])
        {
            return 0;
        }

        for (var i = 1; i < Ladder.Length; i++)
        {
            if (target <= Ladder[i])
            {
                return (i - 1 + (target - Ladder[i - 1]) / (double)(Ladder[i] - Ladder[i - 1])) / (Ladder.Length - 1);
            }
        }

        return 1;
    }

    /// <summary>The rating a skill plays at: the inverse of <see cref="ForRating"/>.</summary>
    public static int RatingOf(double skill, int anchor = Anchor)
    {
        var at = Math.Clamp(skill, 0, 1) * (Ladder.Length - 1);
        var i = Math.Min((int)at, Ladder.Length - 2);
        return anchor + (int)Math.Round(Ladder[i] + (at - i) * (Ladder[i + 1] - Ladder[i]));
    }

    /// <summary>Simulated actions and beam width of the lookahead: a little at skill 0, the Hard bot's at 1.</summary>
    public static (int Budget, int Beam) Search(double skill, int budget, int beam)
    {
        var s = Math.Clamp(skill, 0, 1);
        return ((int)Math.Round(300 + (budget - 300) * s), (int)Math.Round(2 + (beam - 2) * s));
    }
}
