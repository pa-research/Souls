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
    public int Size { get; set; } = 1000;

    /// <summary>How often who is online is updated and games away start.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>How many games an online persona plays away in an hour, on average.</summary>
    public double GamesPerHour { get; set; } = 2;

    /// <summary>How many persona games run on the server at human pace, for players to watch.</summary>
    public int LiveGames { get; set; } = 3;

    /// <summary>
    /// At least this many personas are online at any hour (the quietest hours borrow some), so the live games never
    /// stop and there is always someone to challenge.
    /// </summary>
    public int MinOnline { get; set; } = 16;

    /// <summary>How long a persona takes to accept a challenge.</summary>
    public TimeSpan AnswerDelay { get; set; } = TimeSpan.FromSeconds(3);
}

/// <summary>
/// The community of personas (docs/ranked-bots.md, phase 7): bot accounts that look and play like the site's players,
/// each with a name, a class, a skill and the hours it plays, online by its own clock. Online personas play each other
/// away from the server (headless, like tools/Souls.Sim, stored and rated like any ranked game), so their ratings,
/// streaks and collections grow and their decks change; the matchmaker also runs a few of their games on the server
/// for players to watch and lets them accept challenges. tools/Souls.Sim --community plays seasons of it with the same
/// pieces (<see cref="NewPersona"/>, <see cref="Online"/>, <see cref="Pair"/>, <see cref="AfterGame"/>,
/// <see cref="PlayAsync"/>).
/// <para>
/// Cheap by design: the roster is read every few minutes, a persona is loaded when it comes online or after it played,
/// a game away costs a few tens of milliseconds of one core and a few small queries, and old games between personas
/// are deleted.
/// </para>
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
    /// <summary>A game that goes on this long is a draw (as in the simulator).</summary>
    public const int MaxTurns = 80;

    /// <summary>
    /// How often a win brings a persona a new card: about six a season, so collections keep growing for many seasons
    /// (one win in five filled them in three; tools/Souls.Sim --community).
    /// </summary>
    public const double CardChance = 0.05;

    /// <summary>How long the activity feed keeps its lines.</summary>
    private static readonly TimeSpan FeedAge = TimeSpan.FromDays(14);

    /// <summary>How long games between personas are kept: two seasons, for their profiles and standings.</summary>
    private static readonly TimeSpan GameAge = TimeSpan.FromDays(112);

    private static readonly TimeSpan RosterAge = TimeSpan.FromMinutes(10);

    private readonly ILogger _logger = loggers.CreateLogger<AiCommunity>();
    private readonly Random _random = new();
    private List<Persona> _roster = [];
    private DateTimeOffset _rosterAt;
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
                _logger.LogError(e, "Community tick failed");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    internal async Task TickAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        if (now - _rosterAt > RosterAge)
        {
            if (_roster.Count == 0)
            {
                await EnsurePersonasAsync(ct);
            }

            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
            _roster = await db.Personas.AsNoTracking().Include(p => p.Player).ToListAsync(ct);
            _rosterAt = now;
            if (now - _lastPrune > TimeSpan.FromHours(1))
            {
                _lastPrune = now;
                await db.PlayerEvents.Where(a => a.Created < now - FeedAge).ExecuteDeleteAsync(ct);
                await db.Games.Where(g => g.Created < now - GameAge && g.Player1!.IsAi && g.Player2!.IsAi).ExecuteDeleteAsync(ct);
            }
        }

        // Who went offline leaves once free; who came online, or played since it was loaded, is loaded (again).
        var online = Online(_roster, now, options.Value.MinOnline).ToDictionary(p => p.Player!.NormalizedName);
        var load = await state.RunExclusiveAsync(() =>
        {
            foreach (var (name, persona) in state.Personas.ToList())
            {
                if (!online.ContainsKey(name) && state.IsFree(persona))
                {
                    state.Personas.Remove(name);
                }
            }

            var stale = online.Values.Where(p => !state.Personas.TryGetValue(p.Player!.NormalizedName, out var there)
                || state.PersonasPlayed.Contains(p.PlayerId) && state.IsFree(there)).ToList();
            state.PersonasPlayed.ExceptWith(stale.Select(p => p.PlayerId));
            return stale;
        });
        var loaded = new List<(string, Player)>();
        foreach (var persona in load)
        {
            if (await players.LoadPlayerAsync(persona.PlayerId, ct, persona.Skill) is { } player)
            {
                loaded.Add((persona.Player!.NormalizedName, player));
            }
        }

        var pairs = await state.RunExclusiveAsync(() =>
        {
            foreach (var (name, player) in loaded)
            {
                if (!state.Personas.TryGetValue(name, out var there) || state.IsFree(there))
                {
                    state.Personas[name] = player;
                }
            }

            var chance = options.Value.GamesPerHour * options.Value.Interval.TotalHours / 2;
            var pairs = Pair([.. state.Personas.Values.Where(state.IsFree)], p => p.Rating, chance, _random);
            foreach (var (one, two) in pairs)
            {
                state.PersonasAway.UnionWith([one.Id, two.Id]);
            }

            return pairs;
        });

        foreach (var (one, two) in pairs)
        {
            try
            {
                // Players of their own: those of the server's state stay there.
                if (await players.LoadPlayerAsync(one.Id, ct, one.Skill) is { } first && await players.LoadPlayerAsync(two.Id, ct, two.Skill) is { } second)
                {
                    await PlayAsync(first, second, scopes, time, metrics, loggers, players, ct);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _logger.LogWarning(e, "Community game of {One} and {Two} failed", one.Name, two.Name);
            }
            finally
            {
                await state.RunExclusiveAsync(() =>
                {
                    state.PersonasAway.ExceptWith([one.Id, two.Id]);
                    state.PersonasPlayed.UnionWith([one.Id, two.Id]);
                    return Task.CompletedTask;
                });
            }
        }
    }

    /// <summary>
    /// Pairs some of the <paramref name="ready"/> personas for a game: each starts one with this chance (so with
    /// <c>chance = games an hour × tick length / 2</c> each plays about that many an hour), against one of the three
    /// closest in rating, so the same two do not always meet.
    /// </summary>
    public static List<(T, T)> Pair<T>(List<T> ready, Func<T, int> rating, double chance, Random random)
    {
        ready = [.. ready.OrderBy(_ => random.Next())];
        var pairs = new List<(T, T)>();
        while (ready.Count > 1)
        {
            var one = ready[0];
            ready.RemoveAt(0);
            if (random.NextDouble() >= chance)
            {
                continue;
            }

            var closest = ready.OrderBy(p => Math.Abs(rating(p) - rating(one))).Take(3).ToList();
            var two = closest[random.Next(closest.Count)];
            ready.Remove(two);
            pairs.Add((one, two));
        }

        return pairs;
    }

    /// <summary>
    /// Plays a game of two bots away from the server: a server of its own, as in tools/Souls.Sim, headless and as fast as
    /// they think, stored and rated like any game when there is a database (see <see cref="GameEngine.EndGameAsync"/>).
    /// Returns the winner (<c>null</c>: a draw) and the turns.
    /// </summary>
    public static async Task<(Player? Winner, int Turns)> PlayAsync(Player one, Player two, IServiceScopeFactory scopes, TimeProvider time, GameMetrics metrics,
        ILoggerFactory loggers, PlayerRepository players, CancellationToken ct, int? seed = null)
    {
        var away = new ServerState();
        var engine = new GameEngine(away, new ChatEngine(away, NullLogger<ChatEngine>.Instance), scopes, time,
            Options.Create(new GameOptions { TurnTime = TimeSpan.FromHours(1) }), metrics, loggers.CreateLogger<GameEngine>());
        var service = new GameService(away, engine, players, time, NullLogger<GameService>.Instance);
        var random = seed is { } s ? new Random(s) : new Random();
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
                new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero, Seed = random.Next() }, 2, NullLogger.Instance,
                engine, () => away.RunExclusiveAsync(() => p.GPlayer?.GameRoom?.Copy()), p.Skill, Inspect);
            // Started here, not on another thread: in the simulator the whole game runs on one (GameThread).
            return ai.RunAsync(cts.Token);
        }

        var bots = Task.WhenAll(Seat(one), Seat(two));
        var room = await away.RunExclusiveAsync(() => engine.CreateGame(new Pair<Player>(one, two), random: new Random(random.Next()), headless: true));
        while (!room.IsEnded && !bots.IsCompleted && !cts.IsCancellationRequested && room.Turn < MaxTurns)
        {
            await Task.WhenAny(bots, Task.Delay(5, CancellationToken.None));
        }

        if (!room.IsEnded)
        {
            await away.RunExclusiveAsync(() => engine.EndGameAsync(room, isDraw: true));
        }

        await cts.CancelAsync();
        await bots;
        return (room.IsEnded ? room.Winner : null, room.Turn + 1);
    }

    /// <summary>What a persona's game on the ladder brings: its new streak, lines for the feed and whether it gets a new card.</summary>
    public static (int Streak, List<(PlayerEventKind Kind, int Value)> Events, bool NewCard) AfterGame(int rankBefore, int rankAfter, int streak, bool? won, Random random)
    {
        var events = new List<(PlayerEventKind, int)>();
        if (IsNewTier(rankBefore, rankAfter))
        {
            events.Add((PlayerEventKind.Tier, rankAfter));
        }

        streak = won == true ? streak + 1 : 0;
        if (streak >= 5 && streak % 5 == 0)
        {
            events.Add((PlayerEventKind.Streak, streak));
        }

        return (streak, events, won == true && random.NextDouble() < CardChance);
    }

    /// <summary>A rating that went up into another tier ("reached Gold III"): a line for the feed, for anyone.</summary>
    public static bool IsNewTier(int rankBefore, int rankAfter) =>
        rankAfter > rankBefore && Ratings.TierOf(rankAfter).Name != Ratings.TierOf(rankBefore).Name;

    /// <summary>
    /// After a persona's game on the ladder (<paramref name="won"/> <c>null</c>: a draw): its new rating and streak, the
    /// feed and now and then a new card for a win, which changes its deck (see <see cref="AfterGame"/>). Saved with the game.
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
        var (streak, events, newCard) = AfterGame(before, player.Rank, persona.Streak, won, Random.Shared);
        persona.Streak = streak;
        db.PlayerEvents.AddRange(events.Select(e => new PlayerEvent { PlayerId = playerId, Created = now, Kind = e.Kind, Value = e.Value }));
        if (!newCard)
        {
            return;
        }

        var owned = await db.PlayerCards.Where(c => c.PlayerId == playerId).Select(c => c.CardId).ToListAsync();
        var cards = (await db.Cards.AsNoTracking().ToListAsync()).Where(c => GameRules.CanUse(c.ClassId, player.PlayerTypeId)).ToList();
        if (NewCard(cards, owned, Random.Shared) is not { } card)
        {
            return;
        }

        db.PlayerCards.Add(new PlayerCard { PlayerId = playerId, CardId = card.Id, ObtainedAt = now });
        db.PlayerEvents.Add(new PlayerEvent { PlayerId = playerId, Created = now, Kind = PlayerEventKind.Card, Value = card.Id });
        await db.DeckCards.Where(d => d.PlayerId == playerId).ExecuteDeleteAsync();
        foreach (var (id, count) in Deck([.. cards.Where(c => c.Id == card.Id || owned.Contains(c.Id))], Random.Shared))
        {
            db.DeckCards.Add(new DeckCard { PlayerId = playerId, CardId = id, Count = count });
        }
    }

    /// <summary>A card of its class it does not own yet, or <c>null</c>.</summary>
    public static Card? NewCard(IReadOnlyList<Card> usable, ICollection<int> owned, Random random)
    {
        var missing = usable.Where(c => !owned.Contains(c.Id)).ToList();
        return missing.Count == 0 ? null : missing[random.Next(missing.Count)];
    }

    /// <summary>A persona's deck: one or two races from its cards (<see cref="Decks.Themed"/>, as the practice bot builds).</summary>
    public static IEnumerable<(int CardId, int Count)> Deck(IReadOnlyList<Card> cards, Random random) =>
        Decks.Themed(cards, c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, random).GroupBy(c => c.Id).Select(g => (g.Key, g.Count()));

    /// <summary>Online on five days in seven (other days for each), from its hour for its hours, by its own clock.</summary>
    public static bool IsOnline(Persona persona, DateTimeOffset now)
    {
        var local = now.UtcDateTime.AddMinutes(persona.UtcOffset);
        return (DateOnly.FromDateTime(local).DayNumber + persona.PlayerId) % 7 < 5
            && (local.Hour - persona.PlayFrom + 24) % 24 < persona.PlayHours;
    }

    /// <summary>
    /// The personas online now: those in their hours and, in a quiet hour, others up to <paramref name="min"/> (a
    /// different few each hour), so games never stop.
    /// </summary>
    public static List<Persona> Online(IReadOnlyList<Persona> roster, DateTimeOffset now, int min)
    {
        var online = roster.Where(p => IsOnline(p, now)).ToList();
        if (online.Count < min)
        {
            var hour = (uint)(now.ToUnixTimeSeconds() / 3600);
            online.AddRange(roster.Where(p => !IsOnline(p, now)).OrderBy(p => Mix((uint)p.PlayerId, hour)).Take(min - online.Count));
        }

        return online;
    }

    /// <summary>A hash of a persona and an hour (the finalizer of MurmurHash3): another order every hour.</summary>
    private static uint Mix(uint id, uint hour)
    {
        var x = id * 0x9E3779B1u ^ hour * 0x85EBCA77u;
        x ^= x >> 16;
        x *= 0x85EBCA6Bu;
        x ^= x >> 13;
        x *= 0xC2B2AE35u;
        return x ^ (x >> 16);
    }

    /// <summary>A new persona: its account (not saved), its persona, the cards it owns with their level and its deck.</summary>
    public sealed record Recruit(Model.Entities.Player Player, Persona Persona, List<(Card Card, int Level)> Owned, List<(int CardId, int Count)> Deck);

    /// <summary>
    /// Makes a persona: a class, a skill (most of them weak, as players are), a collection that grows with the skill, a
    /// deck, a rating where the skill plays (<see cref="BotSkill.RatingOf"/>), the day it joined (between
    /// <paramref name="since"/> and <paramref name="now"/>) and a time zone and hours, mostly evenings in Europe.
    /// </summary>
    public static Recruit NewPersona(string name, IReadOnlyList<Card> cards, IReadOnlyList<int> types, Random random, DateTimeOffset now, DateTimeOffset since)
    {
        var skill = Math.Pow(random.NextDouble(), 1.6);
        var type = types[random.Next(types.Count)];
        var powers = GameRules.PowersOf(type);
        var rating = BotSkill.RatingOf(skill);
        var player = new Model.Entities.Player
        {
            Name = name,
            NormalizedName = Model.Entities.Player.Normalize(name),
            Password = "!", // not a valid hash: a persona never logs in
            IsAi = true,
            PlayerTypeId = type,
            HeroPowerId = powers.Count == 0 ? null : powers[random.Next(powers.Count)],
            Rating = rating,
            Rank = Ratings.RankOf(rating),
            RatingDeviation = Ratings.SeasonDeviation,
            Created = since + (now - since) * random.NextDouble(),
        };
        var usable = cards.Where(c => GameRules.CanUse(c.ClassId, type)).OrderBy(_ => random.Next()).ToList();
        var owned = usable.Where(c => c.Level == 1).Take(5).Concat(usable.Where(c => c.Level != 1).Take((int)Math.Round(skill * 30)))
            .Select(c => (c, random.NextDouble() < skill * 0.6 ? 2 : 1)).ToList();
        var evening = random.NextDouble();
        var persona = new Persona
        {
            Player = player,
            Skill = skill,
            UtcOffset = Pick(random, Offsets),
            PlayFrom = evening < 0.7 ? 17 + random.Next(6) : evening < 0.9 ? 11 + random.Next(5) : 6 + random.Next(4),
            PlayHours = random.NextDouble() < 0.1 ? 6 : 1 + random.Next(4),
        };
        return new Recruit(player, persona, owned, [.. Deck([.. owned.Select(o => o.c)], random)]);
    }

    /// <summary>Makes the personas that are missing (see <see cref="NewPersona"/>), with names nobody has.</summary>
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
        var since = await db.Players.Where(p => !p.IsSystem && !p.IsAi).MinAsync(p => p.Created, ct) ?? now;
        var random = new Random(count);
        var taken = (await db.Players.Select(p => p.NormalizedName).ToListAsync(ct)).ToHashSet();
        var cards = await db.Cards.AsNoTracking().ToListAsync(ct);
        var types = await db.PlayerTypes.AsNoTracking().Select(t => t.Id).ToListAsync(ct);
        foreach (var name in Names().Where(n => taken.Add(Model.Entities.Player.Normalize(n))).Take(options.Value.Size - count))
        {
            var recruit = NewPersona(name, cards, types, random, now, since);
            db.Players.Add(recruit.Player);
            db.Personas.Add(recruit.Persona);
            db.PlayerCards.AddRange(recruit.Owned.Select(o => new PlayerCard { Player = recruit.Player, CardId = o.Card.Id, ObtainedAt = recruit.Player.Created!.Value, Level = o.Level }));
            db.DeckCards.AddRange(recruit.Deck.Select(d => new DeckCard { Player = recruit.Player, CardId = d.CardId, Count = d.Count }));
            count++;
        }

        await db.SaveChangesAsync(ct);
        _logger.LogInformation("The community has {Count} personas", count);
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
         "Shade", "Soul", "Storm", "Thorn", "Wraith", "Hex", "Mist", "Pyre", "Ghast", "Blight", "Ruin", "Vile", "Dread", "Crypt", "Wolf"];

    private static readonly string[] Seconds =
        ["wolf", "blade", "fang", "heart", "born", "caller", "weaver", "walker", "bane", "song", "shard", "crow", "mancer", "ward", "maw",
         "vale", "spark", "rider", "keeper", "claw", "hunter", "gaze", "veil", "howl", "bloom"];

    private static readonly string[] Given =
        ["Morgana", "Ingrid", "Torvald", "Sigrid", "Ylva", "Bjorn", "Freya", "Leif", "Astrid", "Halvard", "Solveig", "Eirik", "Ragna",
         "Kjell", "Tora", "Vidar", "Liv", "Arne", "Hedda", "Gunnar", "Marius", "Jonas", "Emma", "Nora", "Sander", "Thea", "Mathias",
         "Ida", "Henrik", "Maja", "Elias", "Sofie", "Kasper", "Ella", "Tobias", "Ane", "Lukas", "Frida", "Even", "Selma"];

    /// <summary>Names like players pick ("Ashwolf", "Raven_claw", "sigrid92"), always in the same order, as many as asked.</summary>
    public static IEnumerable<string> Names()
    {
        var random = new Random(2026);
        string Variant(string name)
        {
            var roll = random.NextDouble();
            return roll < 0.3 ? name + random.Next(2, 100) : roll < 0.4 ? name.ToLowerInvariant() + random.Next(70, 100) : roll < 0.45 ? "x" + name : name;
        }

        // The first pass as they come; later ones (more than a thousand names) with a number, as a taken name gets.
        for (var pass = 0; ; pass++)
        {
            var names = Firsts.SelectMany(f => Seconds.Select(s => random.NextDouble() < 0.15 ? $"{f}_{s}" : f + s)).Concat(Given).OrderBy(_ => random.Next());
            foreach (var name in names)
            {
                yield return pass == 0 ? Variant(name) : (random.NextDouble() < 0.3 ? name.ToLowerInvariant() : name) + random.Next(2, 100).ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
        }
    }
}
