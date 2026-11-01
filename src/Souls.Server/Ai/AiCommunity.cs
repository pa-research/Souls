using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using Card = Souls.Model.Entities.Card;
using Player = Souls.Server.Objects.Player;

namespace Souls.Server.Ai;

public sealed class CommunityOptions
{
    /// <summary>Off: no persona is made or comes online (the tests turn it off).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How many personas there are.</summary>
    public int Size { get; set; } = 200;

    /// <summary>How often who is online is updated and games away start.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>How many games an online persona plays away in an hour, on average.</summary>
    public double GamesPerHour { get; set; } = 3;

    /// <summary>How many persona games run on the server at human pace, for players to watch.</summary>
    public int LiveGames { get; set; } = 2;

    /// <summary>How long a persona takes to accept a challenge.</summary>
    public TimeSpan AnswerDelay { get; set; } = TimeSpan.FromSeconds(3);
}

/// <summary>
/// The AI community (docs/ranked-bots.md, phase 7): personas, bot accounts with a name, a class, a skill and the hours
/// they play, who are online by their own clock. Online personas play each other away from the server (headless, like
/// tools/Souls.Sim, stored and rated on their own ladder), so their ratings, streaks and collections grow and their decks
/// change; the matchmaker also runs a few of their games on the server for players to watch and lets them accept
/// challenges. Everything shows them as AI: <see cref="Model.Localization.Strings.PersonaName"/> in games, the
/// <see cref="Model.Entities.Player.IsAi"/> mark on the site, and the lobby counts them apart from the players.
/// </summary>
public sealed class AiCommunity(
    ServerState state,
    PlayerRepository players,
    IServiceScopeFactory scopes,
    TimeProvider time,
    IOptions<CommunityOptions> options,
    GameMetrics metrics,
    ILoggerFactory loggers) : BackgroundService
{
    /// <summary>A game away that goes on this long is a draw (as in the simulator).</summary>
    private const int MaxTurns = 80;

    /// <summary>How often a win brings a persona a new card.</summary>
    private const double CardChance = 0.2;

    /// <summary>How long the activity feed keeps its lines.</summary>
    private static readonly TimeSpan FeedAge = TimeSpan.FromDays(14);

    private readonly ILogger _logger = loggers.CreateLogger<AiCommunity>();
    private readonly Random _random = new();
    private bool _ready;
    private DateTimeOffset _lastPrune;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(options.Value.Interval, time);
        do
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _logger.LogError(e, "AI community tick failed");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    internal async Task TickAsync(CancellationToken ct)
    {
        if (!_ready)
        {
            await EnsurePersonasAsync(ct);
            _ready = true;
        }

        var now = time.GetUtcNow();
        List<Persona> online;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
            online = [.. (await db.Personas.AsNoTracking().Include(p => p.Player).ToListAsync(ct)).Where(p => IsOnline(p, now))];
            if (now - _lastPrune > TimeSpan.FromHours(1))
            {
                _lastPrune = now;
                await db.AiEvents.Where(a => a.Created < now - FeedAge).ExecuteDeleteAsync(ct);
            }
        }

        // Who went offline leaves once free; who is free is loaded again, with the newest rating, cards and deck.
        // ponytail: reloads every free online persona each tick (a few dozen); load only those who played if it grows.
        var names = online.ToDictionary(p => p.Player!.NormalizedName);
        var load = await state.RunExclusiveAsync(() =>
        {
            foreach (var (name, persona) in state.Personas.ToList())
            {
                if (!names.ContainsKey(name) && state.IsFree(persona))
                {
                    state.Personas.Remove(name);
                }
            }

            return online.Where(p => !state.Personas.TryGetValue(p.Player!.NormalizedName, out var there) || state.IsFree(there)).ToList();
        });
        var loaded = new List<Player>();
        foreach (var persona in load)
        {
            if (await players.LoadPlayerAsync(persona.PlayerId, ct, persona.Skill) is { } player)
            {
                loaded.Add(player);
            }
        }

        var pairs = await state.RunExclusiveAsync(() =>
        {
            foreach (var player in loaded)
            {
                var name = names.First(n => n.Value.PlayerId == player.Id).Key;
                if (!state.Personas.TryGetValue(name, out var there) || state.IsFree(there))
                {
                    state.Personas[name] = player;
                }
            }

            return PairAway();
        });

        foreach (var (one, two) in pairs)
        {
            try
            {
                await PlayAwayAsync(one, two, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _logger.LogWarning(e, "AI game of {One} and {Two} failed", one.Name, two.Name);
            }
            finally
            {
                await state.RunExclusiveAsync(() =>
                {
                    state.PersonasAway.Remove(one.Id);
                    state.PersonasAway.Remove(two.Id);
                    return Task.CompletedTask;
                });
            }
        }
    }

    /// <summary>
    /// Picks the free personas who play a game away this tick, each with one of the three closest in rating (so the same
    /// two do not always meet), and marks them away. Under the lock.
    /// </summary>
    private List<(Player, Player)> PairAway()
    {
        // Each game has two personas: starting one with this chance gives each about GamesPerHour games an hour.
        var chance = options.Value.GamesPerHour * options.Value.Interval.TotalHours / 2;
        var ready = state.Personas.Values.Where(state.IsFree).OrderBy(_ => _random.Next()).ToList();
        var pairs = new List<(Player, Player)>();
        while (ready.Count > 1)
        {
            var one = ready[0];
            ready.RemoveAt(0);
            if (_random.NextDouble() >= chance)
            {
                continue;
            }

            var closest = ready.OrderBy(p => Math.Abs(p.Rating - one.Rating)).Take(3).ToList();
            var two = closest[_random.Next(closest.Count)];
            ready.Remove(two);
            state.PersonasAway.Add(one.Id);
            state.PersonasAway.Add(two.Id);
            pairs.Add((one, two));
        }

        return pairs;
    }

    /// <summary>
    /// Plays a game of two personas away from the server: a server of its own, as in tools/Souls.Sim, headless and as fast
    /// as the bots think. It is stored and rated like any game (see <see cref="GameEngine.EndGameAsync"/>).
    /// </summary>
    private async Task PlayAwayAsync(Player first, Player second, CancellationToken ct)
    {
        // Players of their own: those of the server's state stay there.
        if (await players.LoadPlayerAsync(first.Id, ct, first.Skill) is not { } one || await players.LoadPlayerAsync(second.Id, ct, second.Skill) is not { } two)
        {
            return;
        }

        var away = new ServerState();
        var engine = new GameEngine(away, new ChatEngine(away, NullLogger<ChatEngine>.Instance), scopes, time,
            Options.Create(new GameOptions { TurnTime = TimeSpan.FromHours(1) }), metrics, loggers.CreateLogger<GameEngine>());
        var service = new GameService(away, engine, players, time, NullLogger<GameService>.Instance);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromMinutes(2));

        // The bots of a headless game read it under its lock.
        Task Inspect(Action<GameRoom> read) => away.RunExclusiveAsync(() =>
        {
            if (away.Rooms.Values.FirstOrDefault() is { } game)
            {
                read(game);
            }

            return Task.CompletedTask;
        });

        Task Seat(Player p)
        {
            var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
            p.GameContext = connection;
            away.GameClients[connection] = p;
            var ai = new AiPlayer(connection, m => away.RunExclusiveAsync(() => service.ProcessAsync(connection, m)),
                new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero }, 2, NullLogger.Instance,
                engine, () => away.RunExclusiveAsync(() => p.GPlayer?.GameRoom?.Copy()), p.Skill, Inspect);
            return Task.Run(() => ai.RunAsync(cts.Token), CancellationToken.None);
        }

        var bots = Task.WhenAll(Seat(one), Seat(two));
        var room = await away.RunExclusiveAsync(() => engine.CreateGame(new Pair<Player>(one, two), headless: true));
        while (!room.IsEnded && !bots.IsCompleted && !cts.IsCancellationRequested && room.Turn < MaxTurns)
        {
            await Task.WhenAny(bots, Task.Delay(20, CancellationToken.None));
        }

        if (!room.IsEnded)
        {
            await away.RunExclusiveAsync(() => engine.EndGameAsync(room, isDraw: true));
        }

        await cts.CancelAsync();
        await bots;
    }

    /// <summary>
    /// After a persona's game on its ladder (<paramref name="won"/> <c>null</c>: a draw): its new rating and streak, a
    /// line in the feed for a new tier or a streak of five, ten..., and now and then a new card for a win, which changes
    /// its deck. Saved with the game.
    /// </summary>
    public static async Task AfterGameAsync(SoulsDbContext db, int playerId, (int Change, Ratings.Glicko After) rating, bool? won, DateTimeOffset now)
    {
        var player = await db.Players.SingleAsync(p => p.Id == playerId);
        var persona = await db.Personas.SingleAsync(p => p.PlayerId == playerId);
        var before = player.Rank;
        player.Rating += rating.Change;
        player.RatingDeviation = rating.After.Deviation;
        player.RatingVolatility = rating.After.Volatility;
        player.RatedAt = now;
        player.Rank = Ratings.RankOf(player.Rating);
        if (player.Rank > before && Ratings.TierOf(player.Rank).Name != Ratings.TierOf(before).Name)
        {
            db.AiEvents.Add(new AiEvent { PlayerId = playerId, Created = now, Kind = AiEventKind.Tier, Value = player.Rank });
        }

        persona.Streak = won == true ? persona.Streak + 1 : 0;
        if (persona.Streak >= 5 && persona.Streak % 5 == 0)
        {
            db.AiEvents.Add(new AiEvent { PlayerId = playerId, Created = now, Kind = AiEventKind.Streak, Value = persona.Streak });
        }

        if (won != true || Random.Shared.NextDouble() >= CardChance)
        {
            return;
        }

        var owned = await db.PlayerCards.Where(c => c.PlayerId == playerId).Select(c => c.CardId).ToListAsync();
        var cards = (await db.Cards.AsNoTracking().ToListAsync()).Where(c => GameRules.CanUse(c.ClassId, player.PlayerTypeId)).ToList();
        var missing = cards.Where(c => !owned.Contains(c.Id)).ToList();
        if (missing.Count == 0)
        {
            return;
        }

        var card = missing[Random.Shared.Next(missing.Count)];
        db.PlayerCards.Add(new PlayerCard { PlayerId = playerId, CardId = card.Id, ObtainedAt = now });
        db.AiEvents.Add(new AiEvent { PlayerId = playerId, Created = now, Kind = AiEventKind.Card, Value = card.Id });
        await db.DeckCards.Where(d => d.PlayerId == playerId).ExecuteDeleteAsync();
        AddDeck(db, playerId, null, [.. cards.Where(c => c.Id == card.Id || owned.Contains(c.Id))], Random.Shared);
    }

    /// <summary>A persona's deck: one or two races from its cards (<see cref="Decks.Themed"/>), as the practice bot builds.</summary>
    private static void AddDeck(SoulsDbContext db, int playerId, Model.Entities.Player? player, IReadOnlyList<Card> cards, Random random)
    {
        foreach (var group in Decks.Themed(cards, c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, random).GroupBy(c => c.Id))
        {
            db.DeckCards.Add(new DeckCard { PlayerId = playerId, Player = player, CardId = group.Key, Count = group.Count() });
        }
    }

    /// <summary>Online on five days in seven (other days for each), from its hour for its hours, by its own clock.</summary>
    public static bool IsOnline(Persona persona, DateTimeOffset now)
    {
        var local = now.UtcDateTime.AddMinutes(persona.UtcOffset);
        return (DateOnly.FromDateTime(local).DayNumber + persona.PlayerId) % 7 < 5
            && (local.Hour - persona.PlayFrom + 24) % 24 < persona.PlayHours;
    }

    /// <summary>
    /// Makes the personas that are missing: a name nobody has, a class, a skill (most of them weak, as players are), a
    /// collection that grows with the skill, a deck, a rating where the skill plays (<see cref="BotSkill.RatingOf"/>) and
    /// a time zone and hours, mostly evenings in Europe.
    /// </summary>
    internal async Task EnsurePersonasAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var count = await db.Personas.CountAsync(ct);
        if (count >= options.Value.Size)
        {
            return;
        }

        var now = time.GetUtcNow();
        var random = new Random(count);
        var taken = (await db.Players.Select(p => p.NormalizedName).ToListAsync(ct)).ToHashSet();
        var cards = await db.Cards.AsNoTracking().ToListAsync(ct);
        var types = await db.PlayerTypes.AsNoTracking().Select(t => t.Id).ToListAsync(ct);
        foreach (var name in Names())
        {
            if (count >= options.Value.Size)
            {
                break;
            }

            var normalized = Model.Entities.Player.Normalize(name);
            if (!taken.Add(normalized))
            {
                continue;
            }

            var skill = Math.Pow(random.NextDouble(), 1.6);
            var type = types[random.Next(types.Count)];
            var powers = GameRules.PowersOf(type);
            var rating = BotSkill.RatingOf(skill);
            var player = new Model.Entities.Player
            {
                Name = name,
                NormalizedName = normalized,
                Password = "!", // not a valid hash: a persona never logs in
                IsAi = true,
                PlayerTypeId = type,
                HeroPowerId = powers.Count == 0 ? null : powers[random.Next(powers.Count)],
                Rating = rating,
                Rank = Ratings.RankOf(rating),
                RatingDeviation = Ratings.SeasonDeviation,
                Created = now,
            };
            db.Players.Add(player);

            var usable = cards.Where(c => GameRules.CanUse(c.ClassId, type)).OrderBy(_ => random.Next()).ToList();
            var owned = usable.Where(c => c.Level == 1).Take(5).Concat(usable.Where(c => c.Level != 1).Take((int)Math.Round(skill * 30))).ToList();
            foreach (var card in owned)
            {
                db.PlayerCards.Add(new PlayerCard { Player = player, CardId = card.Id, ObtainedAt = now, Level = random.NextDouble() < skill * 0.6 ? 2 : 1 });
            }

            AddDeck(db, 0, player, owned, random);
            var evening = random.NextDouble();
            db.Personas.Add(new Persona
            {
                Player = player,
                Skill = skill,
                UtcOffset = Pick(random, Offsets),
                PlayFrom = evening < 0.7 ? 17 + random.Next(6) : evening < 0.9 ? 11 + random.Next(5) : 6 + random.Next(4),
                PlayHours = random.NextDouble() < 0.1 ? 6 : 1 + random.Next(4),
            });
            count++;
        }

        await db.SaveChangesAsync(ct);
        _logger.LogInformation("The AI community has {Count} personas", count);
    }

    /// <summary>Time zones (minutes from UTC) and how many personas live in each: most in Norway's.</summary>
    private static readonly (int Offset, int Weight)[] Offsets =
        [(60, 40), (0, 12), (120, 10), (-300, 10), (-360, 5), (-480, 6), (330, 5), (540, 6), (600, 3), (-180, 3)];

    private static int Pick(Random random, (int Value, int Weight)[] choices)
    {
        var roll = random.Next(choices.Sum(c => c.Weight));
        foreach (var (value, weight) in choices)
        {
            if ((roll -= weight) < 0)
            {
                return value;
            }
        }

        return choices[^1].Value;
    }

    private static readonly string[] Firsts =
        ["Ash", "Bone", "Briar", "Cinder", "Dusk", "Ember", "Frost", "Gloom", "Grim", "Hollow", "Iron", "Moon", "Night", "Raven", "Rune",
         "Shade", "Soul", "Storm", "Thorn", "Wraith", "Hex", "Mist", "Pyre", "Ghast", "Blight"];

    private static readonly string[] Seconds =
        ["wolf", "blade", "fang", "heart", "born", "caller", "weaver", "walker", "bane", "song", "shard", "crow", "mancer", "ward", "maw",
         "vale", "spark", "rider", "keeper", "claw"];

    private static readonly string[] Given =
        ["Morgana", "Ingrid", "Torvald", "Sigrid", "Ylva", "Bjorn", "Freya", "Leif", "Astrid", "Halvard", "Solveig", "Eirik", "Ragna",
         "Kjell", "Tora", "Vidar", "Liv", "Arne", "Hedda", "Gunnar"];

    /// <summary>Names like players pick ("Ashwolf", "Raven_claw", "Sigrid92"), always in the same order.</summary>
    private static IEnumerable<string> Names()
    {
        var random = new Random(2026);
        var names = Firsts.SelectMany(f => Seconds.Select(s => (f, s))).OrderBy(_ => random.Next()).Select(x =>
        {
            var roll = random.NextDouble();
            return roll < 0.15 ? $"{x.f}_{x.s}" : roll < 0.4 ? $"{x.f}{x.s}{random.Next(2, 99)}" : x.f + x.s;
        }).ToList();
        foreach (var (name, i) in Given.Select((n, i) => (n, i)))
        {
            names.Insert(i * 7 % names.Count, i % 2 == 0 ? name : $"{name}{random.Next(70, 99)}");
        }

        return names;
    }
}
