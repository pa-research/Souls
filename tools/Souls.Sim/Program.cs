using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Ai;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using Card = Souls.Server.Objects.Card;
using Player = Souls.Server.Objects.Player;

// Balance simulator: the Hard bot plays itself with random hero classes and random one- or two-race decks from the
// card set in SeedData, then reports win rates per card, class and race.
//
//   dotnet run --project tools/Souls.Sim -c Release -- --games 4000 --out docs/balance.md
//
// --vs-legacy instead pits the Hard bot against the Hard bot without its lookahead, seats swapped every other game
// (same classes and decks), and reports the head-to-head result.

var games = Arg("--games", 2000);
var parallel = Arg("--parallel", Environment.ProcessorCount);
var output = ArgString("--out");
var tune = Arg("--tune", 0);
var vsLegacy = args.Contains("--vs-legacy");
const int MaxTurns = 80;

// --class id:attack,health,armor,mana overrides a hero class (repeatable).
var classes = SeedData.PlayerTypes;
for (var i = 0; i < args.Length - 1; i++)
{
    if (args[i] == "--class")
    {
        var parts = args[i + 1].Split(':');
        var stats = parts[1].Split(',').Select(x => int.Parse(x, CultureInfo.InvariantCulture)).ToArray();
        var type = classes.Single(c => c.Id == int.Parse(parts[0], CultureInfo.InvariantCulture));
        (type.Attack, type.Health, type.Armor, type.Mana) = (stats[0], stats[1], stats[2], stats[3]);
    }
}

var pool = SeedData.Cards.Select(c =>
{
    c.Ability = SeedData.Abilities.SingleOrDefault(a => a.Id == c.AbilityId);
    c.Race = SeedData.Races.SingleOrDefault(r => r.Id == c.RaceId);
    return c;
}).ToList();
// --tune n: n rounds of adjusting each class's health towards a 50% win rate.
for (var round = 0; round < tune; round++)
{
    var sample = await RunAsync(games, round * 100_003);
    var line = new StringBuilder($"round {round + 1}:");
    foreach (var c in classes)
    {
        var mine = sample.SelectMany(r => new[] { (r, ident: 1, me: r.Class1, them: r.Class2), (r, ident: 2, me: r.Class2, them: r.Class1) })
            .Where(x => x.me == c.Id && x.me != x.them && x.r.Winner != 0).ToList();
        var rate = mine.Count(x => x.r.Winner == x.ident) / (double)Math.Max(1, mine.Count);
        line.Append(CultureInfo.InvariantCulture, $" {c.Name} {c.Attack}/{c.Health}+{c.Armor} m{c.Mana} {rate:P1};");
        c.Health = Math.Clamp(c.Health + (int)Math.Round((0.5 - rate) * 12), 8, 60);
    }

    Console.Error.WriteLine(line);
}

var results = await RunAsync(games, 0);
var plans = results.SelectMany(r => r.PlanTimes).ToList();
if (plans.Count > 0)
{
    Console.Error.WriteLine($"Lookahead: {plans.Count} decisions, average {plans.Average():0.0} ms, 95th percentile {plans.Order().ElementAt(plans.Count * 95 / 100):0.0} ms, max {plans.Max():0.0} ms");
}

var report = vsLegacy ? HeadToHead(results) : Report(results, pool, classes);
Console.WriteLine(report);
if (output is not null)
{
    await File.WriteAllTextAsync(output, report);
    Console.Error.WriteLine($"Wrote {output}");
}

return;

async Task<List<GameResult>> RunAsync(int count, int seed)
{
    var bag = new ConcurrentBag<GameResult>();
    var watch = Stopwatch.StartNew();
    var done = 0;
    await Parallel.ForEachAsync(Enumerable.Range(0, count), new ParallelOptions { MaxDegreeOfParallelism = parallel }, async (i, ct) =>
    {
        // Against the legacy bot, games 2n and 2n+1 share classes and decks and swap the seats.
        var random = new Random(seed + (vsLegacy ? i / 2 : i) * 7919 + 17);
        bag.Add(await PlayAsync(pool, classes[random.Next(classes.Length)], classes[random.Next(classes.Length)], random, vsLegacy ? i % 2 + 1 : 0));
        var n = Interlocked.Increment(ref done);
        if (n % 1000 == 0)
        {
            Console.Error.WriteLine($"{n}/{count} games ({watch.Elapsed.TotalSeconds:0}s)");
        }
    });
    return [.. bag];
}

// legacySeat: the player (1 or 2) whose Hard bot plays without the lookahead, 0 for none.
static async Task<GameResult> PlayAsync(List<Souls.Model.Entities.Card> pool, PlayerType class1, PlayerType class2, Random random, int legacySeat)
{
    var state = new ServerState();
    var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
    var scopes = services.GetRequiredService<IServiceScopeFactory>();
    var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), scopes, TimeProvider.System,
        Options.Create(new GameOptions { TurnTime = TimeSpan.FromHours(1) }),
        new GameMetrics(services.GetRequiredService<IMeterFactory>(), state), NullLogger<GameEngine>.Instance);
    var service = new GameService(state, engine, new PlayerRepository(scopes), TimeProvider.System, NullLogger<GameService>.Instance);
    var aiOptions = new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero };
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));

    (Player Player, Task Ai, List<Souls.Model.Entities.Card> Deck, AiPlayer Bot) Bot(int id, PlayerType type)
    {
        var deck = Decks.Themed(pool, c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, random);
        var cards = deck.Select(c => Card.FromEntity(c)).ToList();
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var player = new Player
        {
            Id = id,
            Name = "p" + id,
            PlayerType = new PlayerTypeInfo(type.Id, type.Attack, type.Health, type.Mana, type.Armor, type.RaceId),
            OwningCards = cards,
            Deck = cards,
            IsBot = true,
            Difficulty = 2,
            GameContext = connection,
        };
        state.GameClients[connection] = player;
        var ai = id == legacySeat
            ? new AiPlayer(connection, m => state.RunExclusiveAsync(() => service.ProcessAsync(connection, m)), aiOptions, 2, NullLogger.Instance)
            : new AiPlayer(connection, m => state.RunExclusiveAsync(() => service.ProcessAsync(connection, m)), aiOptions, 2, NullLogger.Instance,
                engine, () => state.RunExclusiveAsync(() => player.GPlayer?.GameRoom?.Copy()));
        return (player, Task.Run(() => ai.RunAsync(cts.Token)), deck, ai);
    }

    var started = Stopwatch.StartNew();
    var one = Bot(1, class1);
    var two = Bot(2, class2);
    GameRoom room = null!;
    // Drawn cards come from the log: the starting hands are logged once the bots' mulligans are done.
    var drawn = new Dictionary<int, HashSet<int>> { [1] = [], [2] = [] };
    await state.RunExclusiveAsync(() =>
    {
        room = engine.CreateGame(new Pair<Player>(one.Player, two.Player), practice: true);
        return Task.CompletedTask;
    });

    while (!room.IsEnded && !cts.IsCancellationRequested)
    {
        await Task.Delay(2);
        if (room.Turn >= MaxTurns)
        {
            await state.RunExclusiveAsync(() => engine.EndGameAsync(room, isDraw: true));
        }
    }

    var played = started.Elapsed;
    if (!room.IsEnded)
    {
        var gp = room.CurrentPlaying.GPlayer!;
        Console.Error.WriteLine($"STUCK turn {room.Turn} current {room.CurrentPlaying.Name} mana {gp.Mana} hp {gp.Health} power used {gp.HeroPowerUsed} hand [{string.Join(", ", gp.HandCards.Values.Select(c => $"{c.Name}({c.Cost})"))}] board [{string.Join(" | ", gp.BoardCards.Values.Select(c => $"{c} acted {c.HasAttacked} par {c.Paralyzed}"))}] enemy [{string.Join(" | ", room.Other(gp).BoardCards.Values.Select(c => c.ToString()))}] enemy hp {room.Other(gp).Health}");
    }

    await cts.CancelAsync();
    await Task.WhenAll(one.Ai, two.Ai);
    if (started.Elapsed.TotalSeconds > 30)
    {
        Console.Error.WriteLine($"SLOW game: {played.TotalSeconds:0.0}s to finish, {started.Elapsed.TotalSeconds:0.0}s with the bots, {room.Turn} turns, ended {room.IsEnded}");
    }

    var playedCards = new Dictionary<int, HashSet<int>> { [1] = [], [2] = [] };
    foreach (var log in room.Logger.Records)
    {
        if (log.GameLogTypeId == (int)GameLogKind.UseCard)
        {
            playedCards[log.Obj1Id].Add(log.Obj2Id);
        }
        else if (log.GameLogTypeId == (int)GameLogKind.NewCard)
        {
            drawn[log.Obj1Id].Add(log.Obj2Id);
        }
    }

    var winner = room.Winner is null || !room.IsEnded ? 0 : room.Winner.Id;
    return new GameResult(class1.Id, class2.Id, winner, room.Turn + 1,
        [Side(1, one.Deck), Side(2, two.Deck)], legacySeat, [.. one.Bot.PlanTimes, .. two.Bot.PlanTimes]);

    SideResult Side(int ident, List<Souls.Model.Entities.Card> deck) =>
        new([.. deck.Select(c => c.Id).Distinct()], drawn[ident], playedCards[ident], [.. deck.Select(c => c.RaceId ?? 0).Distinct().Order()]);
}

static string Report(List<GameResult> results, List<Souls.Model.Entities.Card> pool, PlayerType[] classes)
{
    var sb = new StringBuilder();
    var n = results.Count;
    var draws = results.Count(r => r.Winner == 0);
    var decided = results.Where(r => r.Winner != 0).ToList();
    string Pct(double x) => (x * 100).ToString("0.0", CultureInfo.InvariantCulture) + "%";

    sb.AppendLine("# Balance report");
    sb.AppendLine();
    sb.AppendLine($"{n} games of the Hard bot (one-turn lookahead) against itself: random hero classes, random one- or two-race decks from the full card set, cards at level 1. Generated by `tools/Souls.Sim`.");
    sb.AppendLine();
    sb.AppendLine($"- Player one (goes first) wins {Pct(decided.Count(r => r.Winner == 1) / (double)Math.Max(1, decided.Count))} of decided games.");
    sb.AppendLine($"- Draws (both heroes fall, or {MaxTurns} turns): {Pct(draws / (double)n)}.");
    sb.AppendLine($"- Average game length: {results.Average(r => r.Turns).ToString("0.0", CultureInfo.InvariantCulture)} turns (median {results.Select(r => r.Turns).Order().ElementAt(n / 2)}).");
    sb.AppendLine();

    sb.AppendLine("## Hero classes");
    sb.AppendLine();
    sb.AppendLine("| Class | Games | Win rate | " + string.Join(" | ", classes.Select(c => "vs " + c.Name)) + " |");
    sb.AppendLine("|---|---:|---:|" + string.Concat(classes.Select(_ => "---:|")));
    foreach (var c in classes)
    {
        var mine = results.SelectMany(r => new[] { (r, ident: 1, me: r.Class1, them: r.Class2), (r, ident: 2, me: r.Class2, them: r.Class1) })
            .Where(x => x.me == c.Id && x.me != x.them).ToList();
        var wins = mine.Count(x => x.r.Winner == x.ident);
        var cells = classes.Select(o =>
        {
            if (o.Id == c.Id)
            {
                return "-";
            }

            var vs = mine.Where(x => x.them == o.Id).ToList();
            return vs.Count == 0 ? "-" : Pct(vs.Count(x => x.r.Winner == x.ident) / (double)vs.Count);
        });
        sb.AppendLine($"| {c.Name} | {mine.Count} | {Pct(wins / (double)Math.Max(1, mine.Count))} | {string.Join(" | ", cells)} |");
    }

    sb.AppendLine();
    sb.AppendLine("## Races");
    sb.AppendLine();
    sb.AppendLine("Win rate of decks that contain the race (decks hold one or two races).");
    sb.AppendLine();
    sb.AppendLine("| Race | Decks | Win rate |");
    sb.AppendLine("|---|---:|---:|");
    foreach (var race in SeedData.Races)
    {
        var sides = Sides(results).Where(x => x.side.Races.Contains(race.Id)).ToList();
        sb.AppendLine($"| {race.Name} | {sides.Count} | {Pct(sides.Count(x => x.won) / (double)Math.Max(1, sides.Count))} |");
    }

    sb.AppendLine();
    sb.AppendLine("## Cards");
    sb.AppendLine();
    sb.AppendLine("*Drawn* is the win rate of games in which the card was drawn (\"game in hand\"), the best single measure of a card's strength; *played* counts games in which it was played. Cards far from the average are flagged.");
    sb.AppendLine();
    var mean = Sides(results).Where(x => x.decided).Average(x => x.won ? 1.0 : 0.0);
    sb.AppendLine("| Card | Race | Rarity | Cost | Stats | Ability | Drawn | Drawn win rate | Played win rate | |");
    sb.AppendLine("|---|---|---|---:|---|---|---:|---:|---:|---|");
    var rows = pool.Select(card =>
    {
        var drawnSides = Sides(results).Where(x => x.decided && x.side.Drawn.Contains(card.Id)).ToList();
        var playedSides = Sides(results).Where(x => x.decided && x.side.Played.Contains(card.Id)).ToList();
        var gih = drawnSides.Count == 0 ? double.NaN : drawnSides.Count(x => x.won) / (double)drawnSides.Count;
        var pwr = playedSides.Count == 0 ? double.NaN : playedSides.Count(x => x.won) / (double)playedSides.Count;
        return (card, drawn: drawnSides.Count, gih, pwr);
    }).OrderByDescending(r => r.gih).ToList();
    foreach (var (card, drawnCount, gih, pwr) in rows)
    {
        var flag = drawnCount < 100 ? "few games" : gih > mean + 0.05 ? "strong" : gih < mean - 0.05 ? "weak" : "";
        var ability = card.AbilityId is { } id ? GameRules.AbilityLabel(id, card.AbilityValue) : "-";
        var race = SeedData.Races.Single(r => r.Id == card.RaceId).Name;
        sb.AppendLine($"| {card.Name} | {race} | {Rarity.Name(card.Rarity)} | {card.Cost} | {card.Attack}/{card.Health}{(card.Armor > 0 ? $" +{card.Armor}" : "")} | {ability} | {drawnCount} | {Pct(gih)} | {Pct(pwr)} | {flag} |");
    }

    return sb.ToString();

    static IEnumerable<(SideResult side, bool won, bool decided)> Sides(List<GameResult> results) =>
        results.SelectMany(r => new[] { (r.Sides[0], r.Winner == 1, r.Winner != 0), (r.Sides[1], r.Winner == 2, r.Winner != 0) });
}

static string HeadToHead(List<GameResult> results)
{
    var decided = results.Where(r => r.Winner != 0).ToList();
    var wins = decided.Count(r => r.Winner != r.LegacySeat);
    var rate = wins / (double)Math.Max(1, decided.Count);
    var margin = 1.96 * Math.Sqrt(rate * (1 - rate) / Math.Max(1, decided.Count));
    string Seat(int newSeat)
    {
        var games = decided.Where(r => r.LegacySeat != newSeat).ToList();
        return $"{games.Count(r => r.Winner == newSeat) / (double)Math.Max(1, games.Count):P1}";
    }

    return string.Create(CultureInfo.InvariantCulture, $"""
        Hard bot with lookahead against the legacy Hard bot: {results.Count} games, seats swapped every other game.
        Lookahead wins {wins} of {decided.Count} decided games: {rate:P1} (95% CI {rate - margin:P1} to {rate + margin:P1}); {results.Count - decided.Count} draws.
        As player one: {Seat(1)}; as player two: {Seat(2)}.
        """);
}

int Arg(string name, int fallback)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], CultureInfo.InvariantCulture, out var v) ? v : fallback;
}

string? ArgString(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

internal sealed record SideResult(IReadOnlyList<int> Deck, IReadOnlySet<int> Drawn, IReadOnlySet<int> Played, IReadOnlyList<int> Races);

internal sealed record GameResult(int Class1, int Class2, int Winner, int Turns, IReadOnlyList<SideResult> Sides, int LegacySeat, IReadOnlyList<double> PlanTimes);
