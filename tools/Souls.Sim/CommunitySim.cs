using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Ai;
using Souls.Server.Game;
using Souls.Server.Objects;
using Card = Souls.Server.Objects.Card;
using Player = Souls.Server.Objects.Player;

/// <summary>
/// --community days: plays the community (Souls.Server's AiCommunity) for that many days on a simulated clock, with the
/// server's own pieces: the personas it makes, who is online when, who plays whom, the bots' real games (headless, as
/// the server plays them away), the ratings, streaks, feed and new cards, the live games on the server and the season
/// rollover. Reports per season how lively it is (online, games, feed, live games), how the ladder looks, and what it
/// costs (CPU per game and per day).
/// </summary>
internal static class CommunitySim
{
    private const int TickSeconds = 30;
    private const int LiveGames = 3;
    private const int MinOnline = 16;
    private const double GamesPerHour = 2;

    /// <summary>A live game on the server takes this long a turn (the bots think at human pace there).</summary>
    private static readonly TimeSpan LiveTurn = TimeSpan.FromSeconds(20);

    private static readonly TimeSpan SeasonLength = new SeasonOptions().Length;

    private sealed class Sim(int id, AiCommunity.Recruit recruit)
    {
        public int Id { get; } = id;
        public AiCommunity.Recruit Recruit { get; } = recruit;
        public Persona Persona => Recruit.Persona;
        public string Name => Recruit.Player.Name;
        public int Type => Recruit.Player.PlayerTypeId;
        public double Skill => Recruit.Persona.Skill;
        public int Rating { get; set; } = recruit.Player.Rating;
        public double Deviation { get; set; } = recruit.Player.RatingDeviation;
        public double Volatility { get; set; } = recruit.Player.RatingVolatility;
        public DateTimeOffset? RatedAt { get; set; }
        public int Streak { get; set; }
        public Dictionary<int, int> Owned { get; } = recruit.Owned.ToDictionary(o => o.Card.Id, o => o.Level);
        public List<(int CardId, int Count)> Deck { get; set; } = recruit.Deck;
        public DateTimeOffset BusyUntil { get; set; }
        public int SeasonGames { get; set; }
        public int SeasonWins { get; set; }
    }

    private sealed record Queued(Sim One, Sim Two, bool Live, DateTimeOffset At);

    public static string Run(List<Souls.Model.Entities.Card> pool, PlayerType[] classes, int days, int size, int parallel, int seed)
    {
        var random = new Random(seed);
        var cards = pool.ToDictionary(c => c.Id);
        var types = classes.ToDictionary(c => c.Id, c => new PlayerTypeInfo(c.Id, c.Attack, c.Health, c.Mana, c.Armor, c.RaceId));
        var start = new DateTimeOffset(2026, 11, 2, 0, 0, 0, TimeSpan.Zero);
        var roster = AiCommunity.Names().DistinctBy(Souls.Model.Entities.Player.Normalize).Take(size).Select((name, i) =>
        {
            var recruit = AiCommunity.NewPersona(name, pool, [.. classes.Select(c => c.Id)], random, start, start.AddDays(-60));
            recruit.Persona.PlayerId = i + 1;
            return new Sim(i + 1, recruit);
        }).ToList();
        var byPersona = roster.ToDictionary(s => s.Persona);
        var personas = roster.Select(s => s.Persona).ToList();

        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), new ServerState());
        var repository = new PlayerRepository(scopes);

        var report = new StringBuilder();
        report.AppendLine(CultureInfo.InvariantCulture, $"# Community simulation: {size} personas, {days} days");
        report.AppendLine();
        report.AppendLine(CultureInfo.InvariantCulture, $"`dotnet run --project tools/Souls.Sim -c Release -- --community {days} --personas {size} --out docs/community.md`: the server's community code (Souls.Server's AiCommunity) on a simulated clock, every game a real one between the bots. Ticks of {TickSeconds} s, {GamesPerHour} games an hour per online persona, {LiveGames} live games, at least {MinOnline} online. Seasons of {SeasonLength.TotalDays} days.");
        report.AppendLine();

        var season = new Season(1, start);
        var seasons = new List<Season> { season };
        var cpu = Process.GetCurrentProcess().TotalProcessorTime;
        var wall = Stopwatch.StartNew();
        var gameCpu = TimeSpan.Zero;
        var allGames = 0;
        List<Persona> online = [];
        for (var now = start; now < start.AddDays(days);)
        {
            // One simulated hour: who plays whom tick by tick, then the hour's games at once, then their results in order.
            var queue = new List<Queued>();
            var hourEnd = now.AddHours(1);
            for (; now < hourEnd; now = now.AddSeconds(TickSeconds))
            {
                if (now.Second == 0 && now.Minute % 30 == 0)
                {
                    online = AiCommunity.Online(personas, now, MinOnline);
                }

                var at = now;
                var free = online.Select(p => byPersona[p]).Where(s => s.BusyUntil <= at).ToList();
                // The matchmaker starts a live game within a second of one ending: counted after it did.
                var live = roster.Count(s => s.BusyUntil > at) / 2;
                for (; live < LiveGames && free.Count >= 2; live++)
                {
                    var one = free[random.Next(free.Count)];
                    free.Remove(one);
                    var two = free.MinBy(s => Math.Abs(s.Rating - one.Rating))!;
                    free.Remove(two);
                    one.BusyUntil = two.BusyUntil = now + LiveTurn * 22;
                    queue.Add(new Queued(one, two, true, now));
                }

                season.Ticks++;
                season.LiveTicks += live > 0 ? 1 : 0;
                season.FullLiveTicks += live >= LiveGames ? 1 : 0;
                season.Online.Add(online.Count);
                season.OnlineByHour[now.Hour].Add(online.Count);
                var chance = GamesPerHour * TickSeconds / 3600.0 / 2;
                foreach (var (one, two) in AiCommunity.Pair(free, s => s.Rating, chance, random))
                {
                    queue.Add(new Queued(one, two, false, now));
                }
            }

            var played = new (Player? Winner, int Turns, TimeSpan Cpu)[queue.Count];
            var seeds = queue.Select(_ => random.Next()).ToArray();
            Parallel.For(0, queue.Count, new ParallelOptions { MaxDegreeOfParallelism = parallel }, i =>
            {
                var (one, two) = (ToPlayer(queue[i].One, cards, types), ToPlayer(queue[i].Two, cards, types));
                var before = ThreadCpu();
                var (winner, turns) = GameThread.Run(() => AiCommunity.PlayAsync(one, two, scopes, TimeProvider.System, metrics, NullLoggerFactory.Instance, repository, CancellationToken.None, seeds[i]));
                played[i] = (winner, turns, ThreadCpu() - before);
            });

            for (var i = 0; i < queue.Count; i++)
            {
                var (one, two, isLive, at) = queue[i];
                var (winner, turns, spent) = played[i];
                gameCpu += spent;
                allGames++;
                season.Games++;
                season.LiveGames += isLive ? 1 : 0;
                season.Turns += turns;
                season.Draws += winner is null ? 1 : 0;
                if (isLive)
                {
                    one.BusyUntil = two.BusyUntil = at + LiveTurn * turns;
                }

                Rate(one, two, winner?.Id, at);
                foreach (var (me, them) in new[] { (one, two), (two, one) })
                {
                    bool? won = winner is null ? null : winner.Id == me.Id;
                    me.SeasonGames++;
                    me.SeasonWins += won == true ? 1 : 0;
                    season.SkillGames[Quintile(me.Skill)]++;
                    season.SkillWins[Quintile(me.Skill)] += won == true ? 1 : 0;
                }
            }

            if (now - season.Start >= SeasonLength)
            {
                EndSeason(season, roster, pool, random, report);
                season = new Season(season.Number + 1, now);
                seasons.Add(season);
            }

            void Rate(Sim one, Sim two, int? winnerId, DateTimeOffset at)
            {
                var glicko = new Dictionary<Sim, Ratings.Glicko>();
                foreach (var s in new[] { one, two })
                {
                    glicko[s] = new Ratings.Glicko(s.Rating, Ratings.Aged(s.Deviation, s.Volatility, at - (s.RatedAt ?? at)), s.Volatility);
                }

                foreach (var (me, them) in new[] { (one, two), (two, one) })
                {
                    bool? won = winnerId is null ? null : winnerId == me.Id;
                    var after = Ratings.Update(glicko[me], glicko[them].Rating, glicko[them].Deviation, won is null ? 0.5 : won.Value ? 1 : 0);
                    var rankBefore = Ratings.RankOf(me.Rating);
                    me.Rating += (int)Math.Round(after.Rating, MidpointRounding.AwayFromZero) - (int)glicko[me].Rating;
                    (me.Deviation, me.Volatility, me.RatedAt) = (after.Deviation, after.Volatility, at);
                    var (streak, events, newCard) = AiCommunity.AfterGame(rankBefore, Ratings.RankOf(me.Rating), me.Streak, won, random);
                    me.Streak = streak;
                    foreach (var (kind, _) in events)
                    {
                        season.Events[kind]++;
                        season.EventHours.Add((int)((at - start).TotalHours));
                    }

                    if (newCard && AiCommunity.NewCard([.. pool.Where(c => GameRules.CanUse(c.ClassId, me.Type))], me.Owned.Keys, random) is { } card)
                    {
                        me.Owned[card.Id] = 1;
                        me.Deck = [.. AiCommunity.Deck([.. me.Owned.Keys.Select(id => cards[id])], random)];
                        season.Events[PlayerEventKind.Card]++;
                        season.EventHours.Add((int)((at - start).TotalHours));
                    }
                }
            }
        }

        if (season.Games > 0)
        {
            EndSeason(season, roster, pool, random, report, final: true);
        }

        var used = Process.GetCurrentProcess().TotalProcessorTime - cpu;
        report.AppendLine("## Cost");
        report.AppendLine();
        report.AppendLine(CultureInfo.InvariantCulture, $"- {allGames} games in {wall.Elapsed.TotalSeconds:0} s on {parallel} threads; {used.TotalSeconds:0} s of CPU in all.");
        report.AppendLine(CultureInfo.InvariantCulture, $"- A game: {gameCpu.TotalMilliseconds / Math.Max(1, allGames):0.0} ms of CPU (both bots and the server, one thread).");
        var perDay = gameCpu.TotalSeconds / days;
        report.AppendLine(CultureInfo.InvariantCulture, $"- A day of the community: {allGames / (double)days:0} games, {perDay:0} s of CPU ({perDay / 86400 * 100:0.00} % of one core).");
        return report.ToString();
    }

    private static TimeSpan ThreadCpu()
    {
        // ponytail: the process's CPU time per thread is not in .NET; /proc/thread-self/stat on Linux, else wall time.
        try
        {
            var fields = File.ReadAllText("/proc/thread-self/stat").Split(')')[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return TimeSpan.FromSeconds((long.Parse(fields[11], CultureInfo.InvariantCulture) + long.Parse(fields[12], CultureInfo.InvariantCulture)) / 100.0);
        }
        catch (IOException)
        {
            return TimeSpan.FromTicks(Stopwatch.GetTimestamp() * TimeSpan.TicksPerSecond / Stopwatch.Frequency);
        }
    }

    private static Player ToPlayer(Sim s, Dictionary<int, Souls.Model.Entities.Card> cards, Dictionary<int, PlayerTypeInfo> types)
    {
        var owned = s.Owned.Select(o => Card.FromEntity(cards[o.Key], o.Value)).OrderBy(c => c.Id).ToList();
        return new Player
        {
            Id = s.Id,
            Name = s.Name,
            Rating = s.Rating,
            Rank = Ratings.RankOf(s.Rating),
            PlayerType = types[s.Type],
            HeroPower = s.Recruit.Player.HeroPowerId,
            OwningCards = owned,
            Deck = Decks.Build(owned, c => c.Id, c => c.Rarity, s.Deck),
            IsBot = true,
            Skill = s.Skill,
        };
    }

    private static int Quintile(double skill) => Math.Min(4, (int)(skill * 5));

    private static void EndSeason(Season season, List<Sim> roster, List<Souls.Model.Entities.Card> pool, Random random, StringBuilder report, bool final = false)
    {
        var played = roster.Where(s => s.SeasonGames > 0).ToList();
        var days = Math.Max(1, season.Ticks * TickSeconds / 86400.0);
        var games = played.Select(s => s.SeasonGames).Order().ToList();
        string P(double x) => x.ToString("0.0 %", CultureInfo.InvariantCulture);
        report.AppendLine(CultureInfo.InvariantCulture, $"## Season {season.Number}{(final ? " (so far)" : "")}: {days:0} days");
        report.AppendLine();
        report.AppendLine(CultureInfo.InvariantCulture, $"- Played: {played.Count} of {roster.Count} personas; games each: median {Pct(games, 50)}, 10th {Pct(games, 10)}, 90th {Pct(games, 90)}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"- Games: {season.Games} ({season.Games / days:0} a day, {season.LiveGames / days:0} of them live), {season.Turns / (double)Math.Max(1, season.Games):0.0} turns on average, {P(season.Draws / (double)Math.Max(1, season.Games))} draws.");
        var online = season.Online.Order().ToList();
        report.AppendLine(CultureInfo.InvariantCulture, $"- Online: {online[0]} to {online[^1]}, median {Pct(online, 50)}. Live games: at least one {P(season.LiveTicks / (double)season.Ticks)} of the time, all {LiveGames} {P(season.FullLiveTicks / (double)season.Ticks)}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"- Online by hour (UTC, average): {string.Join(" ", season.OnlineByHour.Select((h, i) => $"{i:00}h {h.DefaultIfEmpty(0).Average():0}"))}.");
        var hours = (int)Math.Ceiling(days * 24);
        var perHour = season.EventHours.GroupBy(h => h).ToDictionary(g => g.Key, g => g.Count());
        var quiet = Enumerable.Range((int)season.EventHours.DefaultIfEmpty(0).Min(), hours).Count(h => !perHour.ContainsKey(h));
        report.AppendLine(CultureInfo.InvariantCulture, $"- Feed: {season.Events.Values.Sum() / days:0} lines a day ({string.Join(", ", season.Events.Select(e => $"{e.Value / days:0} {e.Key.ToString().ToLowerInvariant()}"))}); {quiet} of {hours} hours without one.");
        report.AppendLine(CultureInfo.InvariantCulture, $"- Win rate by skill fifth (weakest first): {string.Join(", ", Enumerable.Range(0, 5).Select(q => P(season.SkillWins[q] / (double)Math.Max(1, season.SkillGames[q]))))}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"- Cards owned: {roster.Average(s => s.Owned.Count):0.0} on average.");
        var tiers = played.GroupBy(s => Ratings.TierOf(Ratings.RankOf(s.Rating)).Name).ToDictionary(g => g.Key, g => g.Count());
        report.AppendLine(CultureInfo.InvariantCulture, $"- Final tiers: {string.Join(", ", new[] { "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion" }.Select(t => $"{t} {tiers.GetValueOrDefault(t)}"))}; ratings {played.Min(s => s.Rating)} to {played.Max(s => s.Rating)}, average {played.Average(s => s.Rating):0}.");
        report.AppendLine();

        // The rollover, as Seasons.EndIfDueAsync: a legendary for the top tiers, ratings halfway back, deviations raised.
        var legendaries = pool.Where(c => c.Rarity == Rarity.Legendary && c.ClassId == null).Select(c => c.Id).ToList();
        foreach (var s in played)
        {
            var missing = Seasons.Reward(Ratings.RankOf(s.Rating)).Legendary ? legendaries.Where(id => !s.Owned.ContainsKey(id)).ToList() : [];
            if (missing.Count > 0)
            {
                s.Owned[missing[random.Next(missing.Count)]] = 1;
            }
        }

        foreach (var s in roster)
        {
            s.Rating = Seasons.ResetRating(s.Rating);
            s.Deviation = Math.Max(s.Deviation, Ratings.SeasonDeviation);
            (s.SeasonGames, s.SeasonWins) = (0, 0);
        }
    }

    private static int Pct(List<int> sorted, int percent) => sorted.Count == 0 ? 0 : sorted[Math.Min(sorted.Count - 1, sorted.Count * percent / 100)];

    private sealed class Season(int number, DateTimeOffset start)
    {
        public int Number { get; } = number;
        public DateTimeOffset Start { get; } = start;
        public int Ticks { get; set; }
        public int LiveTicks { get; set; }
        public int FullLiveTicks { get; set; }
        public int Games { get; set; }
        public int LiveGames { get; set; }
        public long Turns { get; set; }
        public int Draws { get; set; }
        public List<int> Online { get; } = [];
        public List<int>[] OnlineByHour { get; } = [.. Enumerable.Range(0, 24).Select(_ => new List<int>())];
        public Dictionary<PlayerEventKind, int> Events { get; } = Enum.GetValues<PlayerEventKind>().ToDictionary(k => k, _ => 0);
        public List<int> EventHours { get; } = [];
        public int[] SkillGames { get; } = new int[5];
        public int[] SkillWins { get; } = new int[5];
    }
}
