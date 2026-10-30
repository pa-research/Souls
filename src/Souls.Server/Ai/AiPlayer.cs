using System.Diagnostics;
using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using AbilityIds = Souls.Model.Entities.Ability;
using Races = Souls.Model.GameRules.Races;

namespace Souls.Server.Ai;

public sealed class AiOptions
{
    /// <summary>Pause at the start of the bot's turn.</summary>
    public TimeSpan ThinkDelay { get; set; } = TimeSpan.FromSeconds(1.5);

    /// <summary>Pause between the bot's actions.</summary>
    public TimeSpan AttackDelay { get; set; } = TimeSpan.FromMilliseconds(700);
}

/// <summary>
/// The practice bot. It plays through an in-memory <see cref="BotConnection"/> using the same messages as a
/// browser. After every action the server sends the full state (<see cref="GameResponse.GameSync"/>); on its turn the
/// bot then picks one action at a time: lethal if it can, spells, cards to play, abilities, trades, the hero power, and
/// finally ends the turn. Difficulty: 0 easy (random), 1 normal (greedy), 2 hard (careful trades, plays to its outs).
/// Given the engine and a way to copy its game, hard looks ahead instead (see <see cref="PlanAsync"/>).
/// </summary>
public sealed class AiPlayer(BotConnection connection, Func<Message, Task> send, AiOptions options, int difficulty, ILogger logger,
    GameEngine? engine = null, Func<Task<GameRoom?>>? copyGame = null)
{
    /// <summary>
    /// Simulated actions per decision, and positions kept after each step of the search: a few milliseconds per
    /// decision. Doubling both did not win measurably more games against the bot without lookahead.
    /// </summary>
    private const int LookaheadBudget = 10_000;
    private const int BeamWidth = 20;

    /// <summary>
    /// What a card in the hand is worth to the lookahead (3 health). A card played keeps it (its stats count on the
    /// board), so only a spell pays it: a spell must gain more than the card it uses up, and drawing cards is worth it.
    /// </summary>
    private const int HandCardWorth = 6;

    private sealed class Unit
    {
        public int Cid { get; init; }
        public int Attack { get; init; }
        public int Health { get; init; }
        public int MaxHealth { get; init; }
        public int Armor { get; init; }
        public bool Taunt { get; init; }
        public bool CanAct { get; init; }
        public int? Ability { get; init; }
        public int AbilityValue { get; init; }
        public int? Race { get; init; }
        public int SlotId { get; init; }
        public bool Ward { get; init; }
        public bool Venom => Ability == AbilityIds.Venom;

        /// <summary>Damage this unit deals when it attacks.</summary>
        public int Hit => Attack + (Race == Races.Ferocious ? 1 : 0);
        public int Toughness => Health + Armor;
        public int Value => Attack * 2 + Health + Armor + (Taunt ? 2 : 0) + (Ability is not null ? 2 : 0) + (Ward ? 2 : 0) + (Venom ? 3 : 0);

        public static Unit Of(Card c) => new()
        {
            Cid = c.Cid,
            Attack = c.Attack,
            Health = c.Health,
            MaxHealth = c.MaxHealth,
            Armor = c.Armor,
            Taunt = c.HasTaunt,
            CanAct = c.CanAct,
            Ability = c.AbilityId,
            AbilityValue = c.AbilityValue,
            Race = c.RaceId,
            SlotId = c.SlotId,
            Ward = c.Ward,
        };

        /// <summary>Whether an attack of <paramref name="damage"/> (from a venom card or not) kills this unit.</summary>
        public bool DiesTo(int damage, bool venom) => !Ward && damage > 0 && (venom || damage >= Toughness);
    }

    private sealed class Hero
    {
        public int Health { get; init; }
        public int MaxHealth { get; init; }
        public int Armor { get; init; }
        public int Attack { get; init; }
        public int Mana { get; init; }
        public int Type { get; init; }
        public bool CanAttack { get; init; }
        public bool CanUsePower { get; init; }
        public int Toughness => Health + Armor;
    }

    private readonly Dictionary<int, Card> _hand = [];
    private readonly HashSet<string> _failed = [];
    private readonly Random _random = new();
    private int _ident;
    private int _turn = -1;
    private bool _myTurn;
    private bool _ended;
    private bool _turnStarted;
    private string? _lastAction;
    private Hero _me = new();
    private Hero _enemy = new();
    private List<Unit> _myBoard = [];
    private List<Unit> _enemyBoard = [];
    private bool _synced;
    private Message? _mulligan;

    /// <summary>The mulligan sends back starting cards that cost more than this (easy bots keep their hand).</summary>
    private const int MulliganMaxCost = 4;

    /// <summary>How long each lookahead took, in milliseconds (read by the simulator).</summary>
    public List<double> PlanTimes { get; } = [];

    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var json in connection.Inbox.ReadAllAsync(ct))
            {
                try
                {
                    if (!Handle(JsonNode.Parse(json)!))
                    {
                        break;
                    }

                    if (_mulligan is { } mulligan)
                    {
                        _mulligan = null;
                        await Task.Delay(options.ThinkDelay, ct);
                        await send(mulligan);
                    }

                    // Act once everything the server sent has been read.
                    while (connection.Inbox.Count == 0 && _myTurn && _synced && !_ended)
                    {
                        if (!await StepAsync(ct))
                        {
                            break;
                        }
                    }
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "Bot failed to process a message");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Server shutting down.
        }
        finally
        {
            connection.Close("Bot stopped");
        }
    }

    /// <returns><c>false</c> when the bot should disconnect.</returns>
    private bool Handle(JsonNode message)
    {
        var payload = message["Payload"];
        switch ((GameResponse?)(int?)message["Type"])
        {
            case GameResponse.GameCreate:
                _ident = (int?)payload!["ident"] ?? 2;
                _hand.Clear();
                foreach (var (_, node) in payload["player"]!["hand"]!.AsObject())
                {
                    var card = Card.FromJson(node!);
                    _hand[card.Cid] = card;
                }

                if ((bool?)payload["mulligan"]?["done"] == false)
                {
                    _mulligan = Message.Create(GameRequest.Mulligan, new JsonObject
                    {
                        ["replace"] = new JsonArray([.. _hand.Values.Where(c => difficulty > 0 && c.Cost > MulliganMaxCost).Select(c => (JsonNode)c.Cid)]),
                    });
                }

                break;
            case GameResponse.GameMulligan:
                _hand.Clear();
                foreach (var node in payload!["hand"]!.AsArray())
                {
                    var card = Card.FromJson(node!);
                    _hand[card.Cid] = card;
                }

                break;
            case GameResponse.GameNewCard:
                foreach (var node in payload!["card"]!.AsArray())
                {
                    var card = Card.FromJson(node!);
                    _hand[card.Cid] = card;
                }

                break;
            case GameResponse.GameUseCardOk:
            case GameResponse.GameUseCardSpell:
                _hand.Remove((int?)payload!["card"]?["cid"] ?? 0);
                break;
            case GameResponse.GameSync:
                ReadSync(payload!);
                break;
            case GameResponse.GameGeneralMessage:
            case GameResponse.GameUseCardOom:
            case GameResponse.GameUseCardOccupied:
            case GameResponse.GameNotYourTurn:
                if (_lastAction is not null)
                {
                    _failed.Add(_lastAction);
                }

                break;
            case GameResponse.GameBotDisconnect:
            case GameResponse.GameVictory:
            case GameResponse.GameDefeat:
            case GameResponse.GameDraw:
                _ended = true;
                return false;
        }

        return true;
    }

    private void ReadSync(JsonNode sync)
    {
        _synced = true;
        var turn = (int?)sync["turn"] ?? 0;
        _myTurn = (int?)sync["current"] == _ident;
        if (turn != _turn)
        {
            _turn = turn;
            _failed.Clear();
            _turnStarted = false;
        }

        var enemyIdent = _ident == 1 ? 2 : 1;
        _me = ReadHero(sync["heroes"]?[_ident.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        _enemy = ReadHero(sync["heroes"]?[enemyIdent.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        _myBoard = ReadBoard(sync["board"]?[_ident.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        _enemyBoard = ReadBoard(sync["board"]?[enemyIdent.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
    }

    private static int Int(JsonNode? node) => node is JsonValue v && v.TryGetValue<int>(out var i) ? i
        : int.TryParse(node?.ToString(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out i) ? i : 0;

    private static Hero ReadHero(JsonNode? node) => new()
    {
        Health = Int(node?["health"]),
        MaxHealth = Int(node?["maxHealth"]),
        Armor = Int(node?["armor"]),
        Attack = Int(node?["attack"]),
        Mana = Int(node?["mana"]),
        Type = Int(node?["type"]),
        CanAttack = (bool?)node?["canAttack"] ?? false,
        CanUsePower = (bool?)node?["canUsePower"] ?? false,
    };

    private static List<Unit> ReadBoard(JsonNode? node) => node is JsonArray cards
        ? [.. cards.Select(c => new Unit
        {
            Cid = Int(c!["cid"]),
            Attack = Int(c["attack"]),
            Health = Int(c["health"]),
            MaxHealth = Int(c["maxHealth"]),
            Armor = Int(c["armor"]),
            Taunt = (bool?)c["taunt"] ?? false,
            CanAct = (bool?)c["canAct"] ?? false,
            Ability = (int?)c["ability"]?["id"],
            AbilityValue = Int(c["ability"]?["value"]),
            Race = (int?)c["race"]?["id"],
            SlotId = Int(c["slotId"]),
            Ward = (bool?)c["ward"] ?? false,
        })]
        : [];

    /// <summary>Takes one action (or ends the turn). Returns <c>false</c> when it should wait for the server.</summary>
    private async Task<bool> StepAsync(CancellationToken ct)
    {
        await Task.Delay(_turnStarted ? options.AttackDelay : options.ThinkDelay, ct);
        _turnStarted = true;

        Message? action;
        if (difficulty >= 2 && engine is not null && copyGame is not null)
        {
            var watch = Stopwatch.StartNew();
            action = await PlanAsync() is { } planned ? Try(planned) : null;
            PlanTimes.Add(watch.Elapsed.TotalMilliseconds);
        }
        else
        {
            action = Decide();
        }

        if (action is null)
        {
            _myTurn = false;
            _lastAction = null;
            await send(Message.Create(GameRequest.NextTurn));
            return false;
        }

        _lastAction = Key(action);
        await send(action);

        // The server answers synchronously; no answer means the action was refused without a message.
        if (connection.Inbox.Count == 0)
        {
            _failed.Add(_lastAction);
            return true;
        }

        return false;
    }

    private static string Key(Message m) => $"{m.Type}:{m.Payload.ToJsonString()}";

    private Message? Try(Message m) => _failed.Contains(Key(m)) ? null : m;

    private Message? Decide()
    {
        if (difficulty == 0 && _random.Next(10) == 0)
        {
            return null; // easy bots sometimes just pass
        }

        return Lethal() ?? CastSpell() ?? PlayCard() ?? UseAbility() ?? Attack() ?? HeroAttack() ?? HeroPower();
    }

    // ---- Lethal ---------------------------------------------------------------------------------------------------

    private Message? Lethal()
    {
        if (difficulty == 0 || _enemyBoard.Any(u => u.Taunt))
        {
            return null;
        }

        var ready = _myBoard.Where(u => u.CanAct).ToList();
        static bool Shoots(Unit u) => u.Ability is AbilityIds.Burn or AbilityIds.Drain;
        var damage = ready.Sum(u => Shoots(u) ? Math.Max(u.Hit, u.AbilityValue) : u.Ability == AbilityIds.Fury ? 2 * u.Hit : u.Hit)
            + (_me.CanAttack ? _me.Attack : 0)
            + (_me.CanUsePower && _me.Type is 1 or 2 ? 1 : 0)
            + _hand.Values.Where(c => c.IsSpell && c.Cost <= _me.Mana && c.AbilityId is AbilityIds.Burn or AbilityIds.Drain).Select(c => c.AbilityValue).DefaultIfEmpty().Max();
        if (damage < _enemy.Toughness)
        {
            return null;
        }

        foreach (var unit in ready.OrderByDescending(u => u.Hit))
        {
            var m = Shoots(unit) && unit.AbilityValue >= unit.Hit
                ? Ability(unit.Cid, TargetType.EnemyHero, -1)
                : AttackMessage(unit.Cid, -1, 1);
            if (Try(m) is { } ok)
            {
                return ok;
            }
        }

        if (_me.CanAttack && Try(AttackMessage(-1, -1, 3)) is { } heroHit)
        {
            return heroHit;
        }

        return _me.CanUsePower && _me.Type is 1 or 2 ? Try(Power(TargetType.EnemyHero, -1)) : null;
    }

    // ---- Cards ----------------------------------------------------------------------------------------------------

    private Message? PlayCard()
    {
        var free = Enumerable.Range(0, GamePlayer.BoardSlots).Where(s => _myBoard.All(u => u.SlotId != s)).ToList();
        if (free.Count == 0)
        {
            return null;
        }

        var affordable = _hand.Values.Where(c => !c.IsSpell && c.Cost <= _me.Mana).ToList();
        if (affordable.Count == 0)
        {
            return null;
        }

        // Inferno is held back while the enemy has (almost) nothing to burn, unless the hand is nearly full.
        if (difficulty > 0 && _enemyBoard.Count < 2 && _hand.Count < 8)
        {
            affordable = [.. affordable.Where(c => c.AbilityId != AbilityIds.Inferno)];
            if (affordable.Count == 0)
            {
                return null;
            }
        }

        var card = difficulty == 0
            ? affordable[_random.Next(affordable.Count)]
            : affordable
                .OrderByDescending(c => c.Cost)
                .ThenByDescending(c => c.AbilityId == AbilityIds.Taunt && _enemyBoard.Sum(u => u.Attack) >= _me.Toughness / 2 ? 1 : 0)
                .ThenByDescending(c => c.Attack + c.Health + c.Armor)
                .First();

        return Try(Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = PickSlot(card, free) }));
    }

    /// <summary>
    /// Taunts go in the middle, Rally next to as many friends as possible, Summon where its Lost Souls fit; the rest
    /// fill from the left.
    /// </summary>
    private int PickSlot(Card card, List<int> free)
    {
        int Neighbours(int slot) => new[] { slot - 1, slot + 1 }.Count(s => s is >= 0 and < GamePlayer.BoardSlots && !free.Contains(s));
        int OpenAround(int slot) => free.Count(f => Math.Abs(f - slot) == 1);
        return difficulty == 0 ? free[0] : card.AbilityId switch
        {
            AbilityIds.Taunt => free.OrderBy(s => Math.Abs(s - 3)).First(),
            AbilityIds.Rally => free.OrderByDescending(Neighbours).ThenBy(s => Math.Abs(s - 3)).First(),
            AbilityIds.Summon => free.OrderByDescending(OpenAround).ThenBy(s => Math.Abs(s - 3)).First(),
            _ => free[0],
        };
    }

    // ---- Spells ---------------------------------------------------------------------------------------------------

    /// <summary>
    /// Simple rules: a burn that kills the hero, else what it kills on the board; heal or armor the hero when it is
    /// low; paralyze a big hitter; empower a card that can still attack; draw while the hand has room; Inferno into
    /// two or more cards. Otherwise the spell waits.
    /// </summary>
    private Message? CastSpell()
    {
        foreach (var spell in _hand.Values.Where(c => c.IsSpell && c.Cost <= _me.Mana).OrderByDescending(c => c.Cost).ToList())
        {
            var v = spell.AbilityValue;
            var low = _me.Health <= _me.MaxHealth / 2;
            var m = spell.AbilityId switch
            {
                AbilityIds.Burn or AbilityIds.Drain when v >= _enemy.Toughness => Cast(spell.Cid, TargetType.EnemyHero),
                AbilityIds.Burn or AbilityIds.Drain => _enemyBoard.Where(u => u.DiesTo(v, venom: false)).OrderByDescending(u => u.Value)
                    .Select(u => Cast(spell.Cid, TargetType.EnemyCard, u.Cid)).FirstOrDefault(),
                AbilityIds.Heal or AbilityIds.Harden => low ? Cast(spell.Cid, TargetType.OwnHero) : null,
                AbilityIds.Paralyze => _enemyBoard.Where(u => u.Attack >= 3).OrderByDescending(u => u.Attack)
                    .Select(u => Cast(spell.Cid, TargetType.EnemyCard, u.Cid)).FirstOrDefault(),
                AbilityIds.Empower => _myBoard.OrderByDescending(u => u.CanAct).ThenByDescending(u => u.Attack)
                    .Select(u => Cast(spell.Cid, TargetType.FriendlyCard, u.Cid)).FirstOrDefault(),
                AbilityIds.Insight => _hand.Count - 1 + v <= GamePlayer.MaxHandCards ? Cast(spell.Cid) : null,
                AbilityIds.Inferno => _enemyBoard.Count >= 2 ? Cast(spell.Cid) : null,
                _ => null,
            };
            if (m is not null && Try(m) is { } ok)
            {
                return ok;
            }
        }

        return null;
    }

    // ---- Abilities ------------------------------------------------------------------------------------------------

    private Message? UseAbility()
    {
        foreach (var unit in _myBoard.Where(u => u.CanAct && GameRules.IsActivated(u.Ability)))
        {
            var m = unit.Ability switch
            {
                AbilityIds.Heal => HealTarget(unit),
                AbilityIds.Sacrifice => SacrificeTarget(unit),
                AbilityIds.Paralyze => _enemyBoard.Where(u => u.Attack >= 3).OrderByDescending(u => u.Attack).Select(u => Ability(unit.Cid, TargetType.EnemyCard, u.Cid)).FirstOrDefault(),
                AbilityIds.Harden => _me.Health <= _me.MaxHealth / 2 ? Ability(unit.Cid, TargetType.OwnHero, -1)
                    : _myBoard.Where(u => u.Taunt).Select(u => Ability(unit.Cid, TargetType.FriendlyCard, u.Cid)).FirstOrDefault()
                        ?? (difficulty >= 2 && _enemyBoard.Count > 0 ? Ability(unit.Cid, TargetType.FriendlyCard, unit.Cid) : null),
                AbilityIds.Burn or AbilityIds.Drain => ShootTarget(unit),
                _ => null,
            };
            if (m is not null && Try(m) is { } ok)
            {
                return ok;
            }
        }

        return null;
    }

    /// <summary>Burn and Drain: kill the best card it can (or pop a ward), otherwise hit the hero.</summary>
    private Message? ShootTarget(Unit shooter)
    {
        // A card that hits harder than it shoots attacks instead (unless an attack would only bounce off a taunt).
        if (difficulty > 0 && shooter.Hit > shooter.AbilityValue + 1 && !_enemyBoard.Any(u => u.Taunt))
        {
            return null;
        }

        var kill = _enemyBoard.Where(u => u.DiesTo(shooter.AbilityValue, venom: false) || u.Ward && u.Value >= 6)
            .OrderByDescending(u => u.Value).FirstOrDefault();
        return kill is not null
            ? Ability(shooter.Cid, TargetType.EnemyCard, kill.Cid)
            : Ability(shooter.Cid, TargetType.EnemyHero, -1);
    }

    private Message? HealTarget(Unit healer)
    {
        if (_me.MaxHealth - _me.Health >= 3 && (difficulty == 0 || _me.Health < _me.MaxHealth * 2 / 3))
        {
            return Ability(healer.Cid, TargetType.OwnHero, -1);
        }

        var hurt = _myBoard.Where(u => u.MaxHealth - u.Health >= 2).OrderByDescending(u => u.Value).FirstOrDefault();
        return hurt is null ? null : Ability(healer.Cid, TargetType.FriendlyCard, hurt.Cid);
    }

    private Message? SacrificeTarget(Unit source)
    {
        if (difficulty > 0 && source.Value >= 8)
        {
            return null; // too good to throw away
        }

        var best = _myBoard.Where(u => u.Cid != source.Cid).OrderByDescending(u => u.CanAct).ThenByDescending(u => u.Attack).FirstOrDefault();
        return best is null ? null : Ability(source.Cid, TargetType.FriendlyCard, best.Cid);
    }

    // ---- Attacks --------------------------------------------------------------------------------------------------

    private Message? Attack()
    {
        var taunts = _enemyBoard.Where(u => u.Taunt).ToList();
        // Cards with an ability to use already used it (UseAbility runs first); the rest attack.
        foreach (var unit in _myBoard.Where(u => u.CanAct && u.Attack > 0).OrderByDescending(u => u.Hit))
        {
            var target = PickTarget(unit, taunts);
            var m = target is null ? AttackMessage(unit.Cid, -1, 1) : AttackMessage(unit.Cid, target.Cid, 0);
            if (Try(m) is { } ok)
            {
                return ok;
            }
        }

        return null;
    }

    /// <summary>The enemy card to attack, or <c>null</c> to go for the hero.</summary>
    private Unit? PickTarget(Unit attacker, List<Unit> taunts)
    {
        if (taunts.Count > 0)
        {
            return taunts.OrderByDescending(t => t.DiesTo(attacker.Hit, attacker.Venom)).ThenBy(t => t.Toughness).First();
        }

        if (_enemyBoard.Count == 0)
        {
            return null;
        }

        if (difficulty == 0)
        {
            return _random.Next(10) < 6 ? null : _enemyBoard[_random.Next(_enemyBoard.Count)];
        }

        // Kill something without dying.
        bool Survives(Unit e) => attacker.Ward || e.Attack <= 0 || !e.Venom && e.Attack < attacker.Toughness;
        var clean = _enemyBoard.Where(e => e.DiesTo(attacker.Hit, attacker.Venom) && Survives(e)).OrderByDescending(e => e.Value).FirstOrDefault();
        if (clean is not null)
        {
            return clean;
        }

        // Hard: trade into anything worth more, pop wards with small cards, and defend when the enemy board threatens us.
        if (difficulty >= 2)
        {
            var trade = _enemyBoard.Where(e => e.DiesTo(attacker.Hit, attacker.Venom) && e.Value > attacker.Value).OrderByDescending(e => e.Value).FirstOrDefault();
            if (trade is not null)
            {
                return trade;
            }

            var ward = _enemyBoard.Where(e => e.Ward && e.Value >= attacker.Value && Survives(e)).OrderByDescending(e => e.Value).FirstOrDefault();
            if (ward is not null)
            {
                return ward;
            }

            if (_enemyBoard.Sum(e => e.Hit) >= _me.Toughness - 3)
            {
                return _enemyBoard.OrderByDescending(e => e.Attack).First();
            }
        }

        return null;
    }

    private Message? HeroAttack()
    {
        if (!_me.CanAttack || _me.Attack <= 0 || difficulty == 0 && _random.Next(2) == 0)
        {
            return null;
        }

        var taunts = _enemyBoard.Where(u => u.Taunt).ToList();
        var targets = taunts.Count > 0 ? taunts : _enemyBoard;
        var kill = targets.Where(u => u.DiesTo(_me.Attack, venom: false) && !u.Venom && u.Attack < _me.Toughness - 5).OrderByDescending(u => u.Value).FirstOrDefault();
        if (kill is not null)
        {
            return Try(AttackMessage(-1, kill.Cid, 2));
        }

        // Hitting the hero costs the enemy hero's attack in return.
        if (taunts.Count == 0 && _enemy.Attack < _me.Toughness / 3)
        {
            return Try(AttackMessage(-1, -1, 3));
        }

        return null;
    }

    private Message? HeroPower()
    {
        if (!_me.CanUsePower)
        {
            return null;
        }

        var m = _me.Type switch
        {
            1 or 2 => _enemyBoard.Where(u => u.DiesTo(1, venom: false) || u.Ward).OrderByDescending(u => u.Value).Select(u => Power(TargetType.EnemyCard, u.Cid)).FirstOrDefault()
                ?? Power(TargetType.EnemyHero, -1),
            3 => _me.Health < _me.MaxHealth ? Power(TargetType.OwnHero, -1)
                : _myBoard.Where(u => u.Health < u.MaxHealth).Select(u => Power(TargetType.FriendlyCard, u.Cid)).FirstOrDefault(),
            4 => Power(TargetType.OwnHero, -1),
            _ => null,
        };
        return m is null ? null : Try(m);
    }

    // ---- Lookahead (hard) -----------------------------------------------------------------------------------------

    /// <summary>
    /// Tries sequences of its own actions for this turn on copies of the game: a beam search that keeps the best
    /// <see cref="BeamWidth"/> positions after each step and simulates at most <see cref="LookaheadBudget"/> actions.
    /// Every position reached is scored with <see cref="Score"/>; returns the first action towards the best one, or
    /// <c>null</c> when ending the turn now is best.
    /// </summary>
    private async Task<Message?> PlanAsync()
    {
        var root = await copyGame!();
        if (root is null || root.IsEnded || root.CurrentPlaying.GPlayer!.Ident != _ident)
        {
            return null;
        }

        var best = Score(root);
        Message? bestFirst = null;
        var seen = new HashSet<int> { Signature(root) };
        List<(GameRoom Room, Message? First, int Score)> beam = [(root, null, best)];
        var budget = LookaheadBudget;
        while (beam.Count > 0 && budget > 0)
        {
            var next = new List<(GameRoom Room, Message? First, int Score)>();
            foreach (var (room, first, _) in beam)
            {
                foreach (var move in Moves(room))
                {
                    if (budget-- <= 0)
                    {
                        break;
                    }

                    var copy = room.Copy();
                    await ApplyAsync(copy, move);
                    if (!seen.Add(Signature(copy)))
                    {
                        continue; // refused, or a position already reached in another order
                    }

                    var score = Score(copy);
                    if (score > best)
                    {
                        (best, bestFirst) = (score, first ?? move);
                    }

                    if (!copy.IsEnded)
                    {
                        next.Add((copy, first ?? move, score));
                    }
                }
            }

            beam = [.. next.OrderByDescending(x => x.Score).Take(BeamWidth)];
        }

        return bestFirst;
    }

    /// <summary>
    /// The bot's value of a position at the end of its turn: its cards' <see cref="Unit.Value"/> minus the enemy's, the
    /// enemy's counting one and a half times (they attack next, paralyzed cards without their attack), plus its hero's
    /// health and armor minus the enemy's, plus <see cref="HandCardWorth"/> per card in its hand or played this turn
    /// (spells cast are used up, so they do not count).
    /// </summary>
    private int Score(GameRoom room)
    {
        var me = room.PlayerOf(_ident).GPlayer!;
        var enemy = room.Other(me);
        if (me.Health < 1)
        {
            return -1_000_000;
        }

        if (enemy.Health < 1)
        {
            return 1_000_000;
        }

        static int Cards(GamePlayer gp) => gp.BoardCards.Values.Sum(c => Unit.Of(c).Value);
        var threat = Cards(enemy) - enemy.BoardCards.Values.Where(c => c.Paralyzed).Sum(c => 2 * c.Attack);
        return 2 * (Cards(me) + me.Health + me.Armor - enemy.Health - enemy.Armor) - 3 * threat + HandCardWorth * (me.HandCards.Count + me.CardsPlayed - me.Used.Count);
    }

    /// <summary>Identifies a position, to drop actions that changed nothing and positions reached in another order.</summary>
    // ponytail: a 32-bit hash; a rare collision drops one candidate. Use a full key if that ever shows up in play.
    private static int Signature(GameRoom room)
    {
        var hash = new HashCode();
        foreach (var gp in new[] { room.Players.First.GPlayer!, room.Players.Second.GPlayer! })
        {
            hash.Add(HashCode.Combine(gp.Health, gp.Armor, gp.Attack, gp.Mana, gp.HasAttacked, gp.HeroPowerUsed, gp.HandCards.Count));
            for (var slot = 0; slot < GamePlayer.BoardSlots; slot++)
            {
                if (gp.BoardCards.TryGetValue(slot, out var c))
                {
                    hash.Add(HashCode.Combine(c.Cid, c.Attack, c.Health, c.Armor, c.HasAttacked, c.Ward, c.Paralyzed, c.AttacksThisTurn));
                }
            }
        }

        return hash.ToHashCode();
    }

    /// <summary>
    /// Every action the bot could take: each card once (in the slot <see cref="PickSlot"/> picks), each spell once on
    /// every target, every attack and ability target.
    /// </summary>
    private IEnumerable<Message> Moves(GameRoom room)
    {
        var me = room.PlayerOf(_ident).GPlayer!;
        var enemy = room.Other(me);
        var free = Enumerable.Range(0, GamePlayer.BoardSlots).Where(s => !me.BoardCards.ContainsKey(s)).ToList();
        var holdInferno = enemy.BoardCards.Count < 2 && me.HandCards.Count < 8;
        foreach (var card in me.HandCards.Values.Where(c => c.Cost <= me.Mana).DistinctBy(c => c.Id))
        {
            if (card.IsSpell && GameRules.IsActivated(card.AbilityId))
            {
                foreach (var (type, target) in Targets(me, enemy, GameRules.AbilityTargets(card.AbilityId!.Value)))
                {
                    yield return Cast(card.Cid, type, target);
                }
            }
            else if (card.IsSpell)
            {
                yield return Cast(card.Cid);
            }
            else if (free.Count > 0 && !(holdInferno && card.AbilityId == AbilityIds.Inferno))
            {
                yield return Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = PickSlot(card, free) });
            }
        }

        // Enemy cards before the hero: on equal scores the bot trades.
        var taunts = enemy.BoardCards.Values.Where(c => c.HasTaunt).ToList();
        var attackable = taunts.Count > 0 ? taunts : [.. enemy.BoardCards.Values];
        foreach (var unit in me.BoardCards.Values.Where(c => c.CanAct))
        {
            if (unit.Attack > 0)
            {
                foreach (var target in attackable)
                {
                    yield return AttackMessage(unit.Cid, target.Cid, 0);
                }

                if (taunts.Count == 0)
                {
                    yield return AttackMessage(unit.Cid, -1, 1);
                }
            }

            if (unit.AbilityId is { } ability && GameRules.IsActivated(ability))
            {
                foreach (var (type, target) in Targets(me, enemy, GameRules.AbilityTargets(ability)))
                {
                    yield return Ability(unit.Cid, type, target);
                }
            }
        }

        if (!me.HasAttacked && me.Attack > 0)
        {
            foreach (var target in attackable)
            {
                yield return AttackMessage(-1, target.Cid, 2);
            }

            if (taunts.Count == 0)
            {
                yield return AttackMessage(-1, -1, 3);
            }
        }

        if (!me.HeroPowerUsed && me.Mana >= GameRules.HeroPowerCost && GameRules.HeroPowers.TryGetValue(me.Type, out var power))
        {
            var kinds = GameRules.PowerTargets(power.Target);
            foreach (var (type, target) in kinds.Count == 0 ? [(TargetType.OwnHero, -1)] : Targets(me, enemy, kinds))
            {
                yield return Power(type, target);
            }
        }
    }

    private static IEnumerable<(TargetType Type, int Cid)> Targets(GamePlayer me, GamePlayer enemy, IReadOnlyList<string> kinds)
    {
        return kinds.SelectMany(Of);

        IEnumerable<(TargetType Type, int Cid)> Of(string kind) => kind switch
        {
            "friendlyCard" => me.BoardCards.Values.Select(c => (TargetType.FriendlyCard, c.Cid)),
            "enemyCard" => enemy.BoardCards.Values.Select(c => (TargetType.EnemyCard, c.Cid)),
            "ownHero" => [(TargetType.OwnHero, -1)],
            _ => [(TargetType.EnemyHero, -1)],
        };
    }

    private Task ApplyAsync(GameRoom room, Message move)
    {
        var player = room.PlayerOf(_ident);
        return (GameRequest)move.Type switch
        {
            GameRequest.UseCard => engine!.RequestUseCardAsync(player, move),
            GameRequest.Attack => engine!.RequestAttackAsync(player, move),
            GameRequest.UseAbility => engine!.RequestUseAbilityAsync(player, move),
            _ => engine!.RequestHeroPowerAsync(player, move),
        };
    }

    // ---- Messages -------------------------------------------------------------------------------------------------

    private static Message AttackMessage(int source, int target, int type) =>
        Message.Create(GameRequest.Attack, new JsonObject { ["source"] = source, ["target"] = target, ["type"] = type });

    private static Message Ability(int source, TargetType type, int target) =>
        Message.Create(GameRequest.UseAbility, new JsonObject { ["source"] = source, ["target"] = target, ["type"] = (int)type });

    /// <summary>Casts a spell on a target, or on nothing (on-play spells).</summary>
    private static Message Cast(int cid, TargetType? type = null, int target = -1) => Message.Create(GameRequest.UseCard, type is { } t
        ? new JsonObject { ["cid"] = cid, ["target"] = target, ["type"] = (int)t }
        : new JsonObject { ["cid"] = cid });

    private static Message Power(TargetType type, int target) =>
        Message.Create(GameRequest.HeroPower, new JsonObject { ["target"] = target, ["type"] = (int)type });
}
