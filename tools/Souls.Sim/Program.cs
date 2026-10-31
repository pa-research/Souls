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

// Balance simulator: the Hard bot plays itself with random hero classes and hero powers and random one- or two-race decks
// from the cards of SeedData its class can play, then reports win rates per card, class, hero power and race.
//
//   dotnet run --project tools/Souls.Sim -c Release -- --games 4000 --out docs/balance.md
//
// --vs-legacy instead pits the Hard bot against the Hard bot without its lookahead, seats swapped every other game
// (same classes and decks), and reports the head-to-head result.

var games = Arg("--games", 2000);
var parallel = Arg("--parallel", Environment.ProcessorCount);
var output = ArgString("--out");
var tune = Arg("--tune", 0);
// --seed n: another draw of classes, powers and decks (shuffles and bot choices vary from run to run anyway).
var seed = Arg("--seed", 0);
var vsLegacy = args.Contains("--vs-legacy");
const int MaxTurns = 80;
// Flag band of the card table, on the in-deck win rate (see the note under the table).
const double InDeckBand = 0.035;

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
// --card id:attack,health,armor,cost[,ability value] overrides a card's numbers (repeatable).
for (var i = 0; i < args.Length - 1; i++)
{
    if (args[i] == "--card")
    {
        var parts = args[i + 1].Split(':');
        var stats = parts[1].Split(',').Select(x => int.Parse(x, CultureInfo.InvariantCulture)).ToArray();
        var card = pool.Single(c => c.Id == int.Parse(parts[0], CultureInfo.InvariantCulture));
        (card.Attack, card.Health, card.Armor, card.Cost) = (stats[0], stats[1], stats[2], stats[3]);
        card.AbilityValue = stats.Length > 4 ? stats[4] : card.AbilityValue;
    }
}

// --tune n: n rounds of adjusting each class's health towards a 50% win rate.
for (var round = 0; round < tune; round++)
{
    var sample = await RunAsync(games, seed + round * 100_003);
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

var results = await RunAsync(games, seed);
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

    // Each bot plays the cards its class may use and one of its class's hero powers at random.
    (Player Player, Task Ai, List<Souls.Model.Entities.Card> Deck, AiPlayer Bot) Bot(int id, PlayerType type)
    {
        var deck = Decks.Themed([.. pool.Where(c => GameRules.CanUse(c.ClassId, type.Id))], c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, random);
        var cards = deck.Select(c => Card.FromEntity(c)).ToList();
        var powers = GameRules.PowersOf(type.Id);
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var player = new Player
        {
            Id = id,
            Name = "p" + id,
            PlayerType = new PlayerTypeInfo(type.Id, type.Attack, type.Health, type.Mana, type.Armor, type.RaceId),
            HeroPower = powers[random.Next(powers.Count)],
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
    var spells = 0;
    foreach (var log in room.Logger.Records)
    {
        if (log.GameLogTypeId == (int)GameLogKind.UseCard)
        {
            playedCards[log.Obj1Id].Add(log.Obj2Id);
            spells += pool.Any(c => c.Id == log.Obj2Id && c.Kind == CardKind.Spell) ? 1 : 0;
        }
        else if (log.GameLogTypeId == (int)GameLogKind.NewCard)
        {
            drawn[log.Obj1Id].Add(log.Obj2Id);
        }
    }

    var winner = room.Winner is null || !room.IsEnded ? 0 : room.Winner.Id;
    return new GameResult(class1.Id, class2.Id, winner, room.Turn + 1,
        [Side(1, one.Deck), Side(2, two.Deck)], legacySeat, [.. one.Bot.PlanTimes, .. two.Bot.PlanTimes], spells);

    SideResult Side(int ident, List<Souls.Model.Entities.Card> deck) =>
        new([.. deck.Select(c => c.Id).Distinct()], drawn[ident], playedCards[ident], [.. deck.Select(c => c.RaceId ?? 0).Distinct().Order()],
            ident == 1 ? class1.Id : class2.Id, (ident == 1 ? one : two).Player.HeroPower ?? 0);
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
    sb.AppendLine($"{n} games of the Hard bot (one-turn lookahead) against itself: random hero classes and hero powers, random one- or two-race decks from the cards each class can play, cards at level 1. Generated by `tools/Souls.Sim`.");
    sb.AppendLine();
    sb.AppendLine($"- Player one (goes first) wins {Pct(decided.Count(r => r.Winner == 1) / (double)Math.Max(1, decided.Count))} of decided games.");
    sb.AppendLine($"- Draws (both heroes fall, or {MaxTurns} turns): {Pct(draws / (double)n)}.");
    sb.AppendLine($"- Average game length: {results.Average(r => r.Turns).ToString("0.0", CultureInfo.InvariantCulture)} turns (median {results.Select(r => r.Turns).Order().ElementAt(n / 2)}).");
    sb.AppendLine($"- Spells cast: {results.Average(r => r.Spells).ToString("0.0", CultureInfo.InvariantCulture)} per game (both players), at least one in {Pct(results.Count(r => r.Spells > 0) / (double)n)} of games.");
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

    // Players pick their deck's races, so a class must hold up with every race, its own included.
    sb.AppendLine();
    sb.AppendLine("## Classes and deck races");
    sb.AppendLine();
    sb.AppendLine("Win rate of each class's decks that hold the race (decks hold one or two races; mirror matches left out). Players pick their races, so every cell should be near 50%. The class's own race is in bold.");
    sb.AppendLine();
    sb.AppendLine("| Class | " + string.Join(" | ", SeedData.Races.Select(r => r.Name)) + " |");
    sb.AppendLine("|---|" + string.Concat(SeedData.Races.Select(_ => "---:|")));
    foreach (var c in classes)
    {
        var cells = SeedData.Races.Select(race =>
        {
            var mine = results.SelectMany(r => new[] { (r, ident: 1, me: r.Sides[0], them: r.Sides[1]), (r, ident: 2, me: r.Sides[1], them: r.Sides[0]) })
                .Where(x => x.me.Class == c.Id && x.them.Class != c.Id && x.me.Races.Contains(race.Id)).ToList();
            var cell = $"{Pct(mine.Count(x => x.r.Winner == x.ident) / (double)Math.Max(1, mine.Count))} ({mine.Count})";
            return race.Id == c.RaceId ? $"**{cell}**" : cell;
        });
        sb.AppendLine($"| {c.Name} | {string.Join(" | ", cells)} |");
    }

    // Each bot picks one of its class's two powers at random. "Against the other power" compares the two powers of a
    // class: the head-to-head win rate their log-odds imply (both win rates are against the same mix of opponents).
    sb.AppendLine();
    sb.AppendLine("## Hero powers");
    sb.AppendLine();
    sb.AppendLine("Games of each class (mirror matches left out) by the hero power it played. *Against the other power* is the head-to-head win rate the two powers' win rates imply (log-odds difference); 50% means both powers are equally strong.");
    sb.AppendLine();
    sb.AppendLine("| Power | Class | Games | Win rate | Against the other power |");
    sb.AppendLine("|---|---|---:|---:|---:|");
    var powerRates = GameRules.HeroPowers.Keys.Order().ToDictionary(id => id, id =>
    {
        var mine = results.SelectMany(r => new[] { (r, ident: 1, me: r.Sides[0], them: r.Sides[1]), (r, ident: 2, me: r.Sides[1], them: r.Sides[0]) })
            .Where(x => x.me.Power == id && x.me.Class != x.them.Class).ToList();
        return (games: mine.Count, rate: mine.Count(x => x.r.Winner == x.ident) / (double)Math.Max(1, mine.Count));
    });
    static double Logit(double p) => Math.Log(Math.Clamp(p, 0.001, 0.999) / (1 - Math.Clamp(p, 0.001, 0.999)));
    foreach (var (id, (games, rate)) in powerRates)
    {
        var power = GameRules.HeroPowers[id];
        var other = GameRules.PowersOf(power.ClassId).Where(o => o != id).Select(o => powerRates[o].rate).FirstOrDefault(double.NaN);
        var h2h = double.IsNaN(other) ? double.NaN : 1 / (1 + Math.Exp(Logit(other) - Logit(rate)));
        sb.AppendLine($"| {power.Name} | {classes.Single(c => c.Id == power.ClassId).Name} | {games} | {Pct(rate)} | {Pct(h2h)} |");
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
    sb.AppendLine("*Drawn* is the win rate of games in which the card was drawn (\"game in hand\"); *played* counts games in which it was played; *in deck* counts every game of a deck that holds the card, drawn or not. Cards more than 3.5 points from the average *in deck* are flagged (see the note below the table).");
    sb.AppendLine();
    var mean = Sides(results).Where(x => x.decided).Average(x => x.won ? 1.0 : 0.0);
    sb.AppendLine("| Card | Race | Rarity | Cost | Stats | Ability | Drawn | Drawn win rate | Played win rate | In deck win rate | |");
    sb.AppendLine("|---|---|---|---:|---|---|---:|---:|---:|---:|---|");
    var rows = pool.Select(card =>
    {
        var drawnSides = Sides(results).Where(x => x.decided && x.side.Drawn.Contains(card.Id)).ToList();
        var playedSides = Sides(results).Where(x => x.decided && x.side.Played.Contains(card.Id)).ToList();
        var gih = drawnSides.Count == 0 ? double.NaN : drawnSides.Count(x => x.won) / (double)drawnSides.Count;
        var pwr = playedSides.Count == 0 ? double.NaN : playedSides.Count(x => x.won) / (double)playedSides.Count;
        var deckSides = Sides(results).Where(x => x.decided && x.side.Deck.Contains(card.Id)).ToList();
        var dwr = deckSides.Count == 0 ? double.NaN : deckSides.Count(x => x.won) / (double)deckSides.Count;
        return (card, drawn: drawnSides.Count, gih, pwr, dwr);
    }).OrderByDescending(r => r.gih).ToList();
    string StatsOf(Souls.Model.Entities.Card card) => card.Kind == CardKind.Spell ? "spell" : $"{card.Attack}/{card.Health}{(card.Armor > 0 ? $" +{card.Armor}" : "")}";
    string AbilityOf(Souls.Model.Entities.Card card) => card.AbilityId is { } id ? GameRules.AbilityLabel(id, card.AbilityValue) : "-";
    string RaceOf(Souls.Model.Entities.Card card) => SeedData.Races.Single(r => r.Id == card.RaceId).Name;
    foreach (var (card, drawnCount, gih, pwr, dwr) in rows.Where(r => r.card.ClassId is null))
    {
        var flag = drawnCount < 100 ? "few games" : dwr > mean + InDeckBand ? "strong" : dwr < mean - InDeckBand ? "weak" : "";
        sb.AppendLine($"| {card.Name} | {RaceOf(card)} | {Rarity.Name(card.Rarity)} | {card.Cost} | {StatsOf(card)} | {AbilityOf(card)} | {drawnCount} | {Pct(gih)} | {Pct(pwr)} | {Pct(dwr)} | {flag} |");
    }

    sb.AppendLine();
    sb.AppendLine("Why the flag uses *in deck*: *drawn* and *played* over-count expensive cards. A card is only drawn (and played) in the games that last long enough for it, and the long games are, most likely, the ones the slower decks holding the expensive cards win more often; so a 6-9 mana card reads several points higher drawn than in deck, and its drawn rate hardly moves when its stats change. *In deck* has no such lean, but a smaller spread, since a player draws only about 70% of the deck in a 25-turn game: its band is the old 5 points on *drawn* times 0.7.");

    // A class card only shows up in its class's decks that hold its race, so its raw win rates mostly measure the
    // class: the adjusted rate compares it with those decks (50% + played win rate - their win rate).
    sb.AppendLine();
    sb.AppendLine("## Class cards");
    sb.AppendLine();
    sb.AppendLine("Only their class can play them, so their raw win rates follow the class's. *Decks like it* is the win rate of that class's decks that contain the card's race; *played, adjusted* is 50% plus the played win rate minus that.");
    sb.AppendLine();
    sb.AppendLine("| Card | Class | Race | Rarity | Cost | Stats | Ability | Drawn | Drawn win rate | Played win rate | Decks like it | Played, adjusted |");
    sb.AppendLine("|---|---|---|---|---:|---|---|---:|---:|---:|---:|---:|");
    foreach (var (card, drawnCount, gih, pwr, _) in rows.Where(r => r.card.ClassId is not null).OrderBy(r => r.card.Id))
    {
        var like = Sides(results).Where(x => x.decided && x.side.Class == card.ClassId && x.side.Races.Contains(card.RaceId ?? 0)).ToList();
        var likeRate = like.Count(x => x.won) / (double)Math.Max(1, like.Count);
        sb.AppendLine($"| {card.Name} | {classes.Single(c => c.Id == card.ClassId).Name} | {RaceOf(card)} | {Rarity.Name(card.Rarity)} | {card.Cost} | {StatsOf(card)} | {AbilityOf(card)} | {drawnCount} | {Pct(gih)} | {Pct(pwr)} | {Pct(likeRate)} | {Pct(0.5 + pwr - likeRate)} |");
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

internal sealed record SideResult(IReadOnlyList<int> Deck, IReadOnlySet<int> Drawn, IReadOnlySet<int> Played, IReadOnlyList<int> Races, int Class, int Power);

internal sealed record GameResult(int Class1, int Class2, int Winner, int Turns, IReadOnlyList<SideResult> Sides, int LegacySeat, IReadOnlyList<double> PlanTimes, int Spells);
