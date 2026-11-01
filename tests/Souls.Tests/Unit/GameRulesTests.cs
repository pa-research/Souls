using System.Reflection;
using System.Diagnostics.Metrics;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using AbilityIds = Souls.Model.Entities.Ability;
using CardKind = Souls.Model.Entities.CardKind;
using Races = Souls.Model.GameRules.Races;

namespace Souls.Tests.Unit;

public class GameRulesTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 29, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static Card Definition(int attack, int health, int armor = 0, int? ability = null, int? race = null, string name = "Test", int cost = 1, int? value = null) =>
        new() { Id = 1, Name = name, BaseAttack = attack, BaseHealth = health, BaseArmor = armor, AbilityId = ability, AbilityValueOverride = value, RaceId = race, Cost = cost };

    private static Card NewCard(int attack, int health, int armor = 0, int? ability = null, int? race = null, string name = "Test", int? value = null) =>
        Definition(attack, health, armor, ability, race, name, value: value).NewInstance();

    /// <summary>A running game between two players whose messages are captured.</summary>
    private sealed class TestGame
    {
        private TestGame(ManualTime clock, GameEngine engine, Player p1, Player p2)
        {
            Clock = clock;
            Engine = engine;
            P1 = p1;
            P2 = p2;
        }

        public ManualTime Clock { get; }
        public GameEngine Engine { get; }
        public Player P1 { get; }
        public Player P2 { get; }
        public GameRoom Room => P1.GPlayer?.GameRoom ?? _room!;
        public GamePlayer G1 => P1.GPlayer!;
        public GamePlayer G2 => P2.GPlayer!;
        private GameRoom? _room;

        /// <summary>A game whose first turn has started (both players kept their starting hand), or with <paramref name="mulligan"/> one that waits for the mulligan.</summary>
        public static TestGame Start(IReadOnlyList<Card>? deck1 = null, IReadOnlyList<Card>? deck2 = null, PlayerTypeInfo? type1 = null, PlayerTypeInfo? type2 = null, TimeSpan? turnTime = null, bool mulligan = false, int? power1 = null)
        {
            var clock = new ManualTime();
            var state = new ServerState();
            var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
            var options = Options.Create(new GameOptions { TurnTime = turnTime ?? TimeSpan.FromSeconds(75) });
            var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), state);
            var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), services.GetRequiredService<IServiceScopeFactory>(), clock, options, metrics, NullLogger<GameEngine>.Instance);
            var game = new TestGame(clock, engine, NewPlayer(1, deck1 ?? Filler(), type1, power1), NewPlayer(2, deck2 ?? Filler(), type2, null));
            game._room = engine.CreateGame(new Pair<Player>(game.P1, game.P2));
            if (!mulligan)
            {
                game.Mulligan(game.P1).GetAwaiter().GetResult();
                game.Mulligan(game.P2).GetAwaiter().GetResult();
            }

            return game;
        }

        private static IReadOnlyList<Card> Filler() => [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => Definition(1, 1, name: "Filler"))];

        private static Player NewPlayer(int id, IReadOnlyList<Card> deck, PlayerTypeInfo? type, int? power) => new()
        {
            Id = id,
            Name = "p" + id,
            PlayerType = type ?? new PlayerTypeInfo(1, Attack: 5, Health: 20, Mana: 1),
            HeroPower = power,
            OwningCards = deck,
            Deck = deck,
            GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true },
        };

        /// <summary>Puts a card on the board, ready to act.</summary>
        public Card Put(Player owner, Card card, int slot)
        {
            card.SlotId = slot;
            owner.GPlayer!.BoardCards[slot] = card;
            return card;
        }

        /// <summary>The messages a player received since the last call.</summary>
        public List<JsonNode> Messages(Player p)
        {
            var list = new List<JsonNode>();
            var inbox = ((BotConnection)p.GameContext!).Inbox;
            while (inbox.TryRead(out var response))
            {
                list.Add(response.ToJsonNode());
            }

            return list;
        }

        public List<JsonNode> Events(Player p) => [.. Messages(p)
            .Where(m => (int?)m["Type"] == (int)GameResponse.GameEvents)
            .SelectMany(m => m["Payload"]!["events"]!.AsArray().Select(e => e!))];

        public Task Attack(Player p, int source, int target, int type) =>
            Engine.RequestAttackAsync(p, Message.Create(GameRequest.Attack, new JsonObject { ["source"] = source, ["target"] = target, ["type"] = type }));

        public Task Ability(Player p, Card source, TargetType type, int target = -1) =>
            Engine.RequestUseAbilityAsync(p, Message.Create(GameRequest.UseAbility, new JsonObject { ["source"] = source.Cid, ["target"] = target, ["type"] = (int)type }));

        public Task Power(Player p, TargetType type, int target = -1) =>
            Engine.RequestHeroPowerAsync(p, Message.Create(GameRequest.HeroPower, new JsonObject { ["target"] = target, ["type"] = (int)type }));

        public Task Play(Player p, Card card, int slot) =>
            Engine.RequestUseCardAsync(p, Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = slot }));

        /// <summary>Casts a spell from the hand on a target (or, without a type, on nothing).</summary>
        public Task Cast(Player p, Card spell, TargetType? type = null, int target = -1) =>
            Engine.RequestUseCardAsync(p, Message.Create(GameRequest.UseCard, type is { } t
                ? new JsonObject { ["cid"] = spell.Cid, ["target"] = target, ["type"] = (int)t }
                : new JsonObject { ["cid"] = spell.Cid }));

        public Task EndTurn(Player p) => Engine.RequestNextTurnAsync(p);

        public Task Mulligan(Player p, params int[] replace) =>
            Engine.RequestMulliganAsync(p, Message.Create(GameRequest.Mulligan, new JsonObject { ["replace"] = new JsonArray([.. replace.Select(cid => (JsonNode)cid)]) }));
    }

    /// <summary>A spell in the player's hand.</summary>
    private static Card GiveSpell(GamePlayer gp, int ability, int? value = null, int cost = 1, int? race = null)
    {
        var spell = new Card { Id = 60, Name = "Spell", Kind = CardKind.Spell, AbilityId = ability, AbilityValueOverride = value, Cost = cost, RaceId = race }.NewInstance();
        gp.HandCards[spell.Cid] = spell;
        return spell;
    }

    /// <summary>A deck of 20 different cards ("c0" to "c19").</summary>
    private static IReadOnlyList<Card> Named() => [.. Enumerable.Range(0, GameRules.DeckSize).Select(i => Definition(1, 1, name: "c" + i))];

    [Fact]
    public void NewInstancesGetUniqueIdsAndPrintedStats()
    {
        var definition = Definition(2, 3, armor: 1);
        var a = definition.NewInstance();
        var b = definition.NewInstance();
        Assert.NotEqual(a.Cid, b.Cid);
        Assert.Equal((2, 3, 3, 1), (a.Attack, a.Health, a.MaxHealth, a.Armor));
    }

    [Fact]
    public void UpgradedCardsGainAttackAndHealth()
    {
        var entity = new Model.Entities.Card { Id = 9, Name = "X", Attack = 2, Health = 3, Armor = 1 };
        var card = Card.FromEntity(entity, level: 3).NewInstance();
        Assert.Equal((4, 5, 1, 3), (card.Attack, card.Health, card.Armor, card.Level));
    }

    [Fact]
    public void GameStartsWithThreeCardsAndBonusManaEveryTurn()
    {
        var game = TestGame.Start(type1: new PlayerTypeInfo(1, 5, 20, Mana: 1), type2: new PlayerTypeInfo(2, 2, 35, Mana: 2));

        Assert.Equal(3, game.G1.HandCards.Count);
        Assert.Equal(4, game.G2.HandCards.Count); // going second: one more card
        Assert.Equal(GameRules.DeckSize - 4, game.G2.Deck.Count);
        Assert.Equal(GameRules.DeckSize - 3, game.G1.Deck.Count);
        Assert.True(game.G1.IsPlayerTurn());
        Assert.Equal(2, game.G1.Mana); // round 1 + bonus 1

        game.Room.NextTurn();
        Assert.True(game.G2.IsPlayerTurn());
        Assert.Equal(4, game.G2.Mana); // round 1 + bonus 2 + 1 for going second

        game.Room.NextTurn();
        Assert.Equal(3, game.G1.Mana); // round 2 + bonus 1
        game.Room.NextTurn();
        Assert.Equal(4, game.G2.Mana); // round 2 + bonus 2, the extra mana was a one-off
    }

    [Fact]
    public void ManaIsCappedAtTen()
    {
        var game = TestGame.Start();
        for (var i = 0; i < 40; i++)
        {
            game.Room.NextTurn();
        }

        Assert.Equal(GameRules.MaxMana, game.Room.CurrentPlaying.GPlayer!.Mana);
    }

    [Fact]
    public async Task ArmorAbsorbsDamageBeforeHealth()
    {
        var game = TestGame.Start();
        var attacker = game.Put(game.P1, NewCard(3, 5), 0);
        var defender = game.Put(game.P2, NewCard(1, 4, armor: 2), 0);

        await game.Attack(game.P1, attacker.Cid, defender.Cid, 0);

        Assert.Equal((0, 3), (defender.Armor, defender.Health));
        Assert.Equal(4, attacker.Health);
        var damage = game.Events(game.P1).First(e => (string?)e["t"] == "damage");
        Assert.Equal((3, 2), ((int)damage["amount"]!, (int)damage["armorLost"]!));
    }

    [Fact]
    public async Task HeroArmorAbsorbsDamageToo()
    {
        var game = TestGame.Start(type2: new PlayerTypeInfo(4, Attack: 1, Health: 20, Mana: 2, Armor: 15));
        var attacker = game.Put(game.P1, NewCard(6, 9), 0);

        await game.Attack(game.P1, attacker.Cid, -1, 1);

        Assert.Equal((9, 20), (game.G2.Armor, game.G2.Health));
        Assert.Equal(8, attacker.Health); // the hero hits back with its attack
    }

    [Fact]
    public async Task CardsArriveExhaustedUnlessTheyHaveCharge()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var plain = NewCard(2, 2);
        var charger = NewCard(2, 2, ability: AbilityIds.Charge);
        game.G1.HandCards[plain.Cid] = plain;
        game.G1.HandCards[charger.Cid] = charger;

        await game.Play(game.P1, plain, 0);
        await game.Play(game.P1, charger, 1);
        game.Messages(game.P1);

        await game.Attack(game.P1, plain.Cid, -1, 1);
        Assert.Equal(20, game.G2.Health);
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameGeneralMessage);

        await game.Attack(game.P1, charger.Cid, -1, 1);
        Assert.Equal(18, game.G2.Health);
    }

    [Fact]
    public async Task TauntCardsMustBeAttackedFirst()
    {
        var game = TestGame.Start();
        var attacker = game.Put(game.P1, NewCard(2, 9), 0);
        var other = game.Put(game.P2, NewCard(1, 9), 0);
        var taunt = game.Put(game.P2, NewCard(1, 9, ability: AbilityIds.Taunt), 1);

        await game.Attack(game.P1, attacker.Cid, -1, 1);
        await game.Attack(game.P1, attacker.Cid, other.Cid, 0);
        Assert.Equal((20, 9), (game.G2.Health, other.Health));
        Assert.False(attacker.HasAttacked);

        await game.Attack(game.P1, attacker.Cid, taunt.Cid, 0);
        Assert.Equal(7, taunt.Health);
    }

    [Fact]
    public async Task FerociousCardsHitHarderWhenAttacking()
    {
        var game = TestGame.Start();
        var attacker = game.Put(game.P1, NewCard(2, 9, race: Races.Ferocious), 0);
        var defender = game.Put(game.P2, NewCard(2, 9, race: Races.Ferocious), 0);

        await game.Attack(game.P1, attacker.Cid, defender.Cid, 0);

        Assert.Equal(6, defender.Health); // 2 + 1
        Assert.Equal(7, attacker.Health); // the counter attack has no bonus
    }

    [Fact]
    public async Task VampiricDamageHealsTheHeroUpToItsMaximum()
    {
        var game = TestGame.Start();
        game.G1.Health = 15;
        var vampire = game.Put(game.P1, NewCard(4, 9, race: Races.Vampiric), 0);

        await game.Attack(game.P1, vampire.Cid, -1, 1);
        Assert.Equal(19, game.G1.Health);

        game.Room.NextTurn();
        game.Room.NextTurn();
        await game.Attack(game.P1, vampire.Cid, -1, 1);
        Assert.Equal(20, game.G1.Health);
    }

    [Fact]
    public async Task DarknessCardsCurseARandomEnemyWhenTheyDie()
    {
        var game = TestGame.Start();
        var attacker = game.Put(game.P1, NewCard(5, 5), 0);
        var dark = game.Put(game.P2, NewCard(1, 1, race: Races.Darkness), 0);

        await game.Attack(game.P1, attacker.Cid, dark.Cid, 0);

        // The only enemies are the attacker (4 health left after the counter attack) and the hero.
        var cursed = attacker.Health == 2 || game.G1.Health == 18;
        Assert.True(cursed);
        Assert.Contains(game.Events(game.P1), e => (string?)e["t"] == "curse");
    }

    [Fact]
    public async Task HauntCardsReturnToTheHandOnce()
    {
        var game = TestGame.Start();
        var attacker = game.Put(game.P1, NewCard(5, 20), 0);
        var ghost = game.Put(game.P2, NewCard(1, 1, ability: AbilityIds.Haunt), 0);
        var handBefore = game.G2.HandCards.Count;

        await game.Attack(game.P1, attacker.Cid, ghost.Cid, 0);

        Assert.Equal(handBefore + 1, game.G2.HandCards.Count);
        var returned = game.G2.HandCards.Values.Last();
        Assert.True(returned.Haunted);
        Assert.Equal(1, returned.Health);
        Assert.Contains(game.Messages(game.P2), m => (int?)m["Type"] == (int)GameResponse.GameNewCard && (bool?)m["Payload"]!["returned"] == true);

        // Killed again it stays dead.
        game.Put(game.P2, returned, 1);
        game.G2.HandCards.Remove(returned.Cid);
        game.Room.NextTurn();
        game.Room.NextTurn();
        await game.Attack(game.P1, attacker.Cid, returned.Cid, 0);
        Assert.Equal(handBefore, game.G2.HandCards.Count);
    }

    [Fact]
    public async Task SummonPutsALostSoulNextToTheCard()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var summoner = NewCard(2, 2, ability: AbilityIds.Summon);
        game.G1.HandCards[summoner.Cid] = summoner;

        await game.Play(game.P1, summoner, 3);

        var token = Assert.Single(game.G1.BoardCards.Values, c => c.IsToken);
        Assert.Equal(4, token.SlotId);
        Assert.Equal((1, 1), (token.Attack, token.Health));
    }

    [Fact]
    public async Task LightbringerCardsBlessTheHeroWhenPlayed()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        game.G1.Health = 10;
        var card = NewCard(1, 1, race: Races.Lightbringer);
        game.G1.HandCards[card.Cid] = card;

        await game.Play(game.P1, card, 0);

        Assert.Equal(10 + GameRules.LightbringerBlessing, game.G1.Health);
    }

    [Fact]
    public async Task HealIsCappedAndAlsoHealsNeighbours()
    {
        var game = TestGame.Start();
        var healer = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Heal), 0);
        var hurt = game.Put(game.P1, NewCard(1, 10), 2);
        var neighbour = game.Put(game.P1, NewCard(1, 10), 3);
        hurt.Health = 9;
        neighbour.Health = 5;

        await game.Ability(game.P1, healer, TargetType.FriendlyCard, hurt.Cid);

        Assert.Equal(10, hurt.Health);
        Assert.Equal(6, neighbour.Health);
        Assert.True(healer.HasAttacked);
    }

    [Fact]
    public async Task SacrificeGivesItsStatsAway()
    {
        var game = TestGame.Start();
        var source = game.Put(game.P1, NewCard(2, 3, armor: 1, ability: AbilityIds.Sacrifice), 0);
        var target = game.Put(game.P1, NewCard(1, 1), 1);

        await game.Ability(game.P1, source, TargetType.FriendlyCard, target.Cid);

        Assert.Equal((3, 4, 4, 1), (target.Attack, target.Health, target.MaxHealth, target.Armor));
        Assert.False(game.G1.BoardCards.ContainsKey(0));
    }

    [Fact]
    public async Task ParalyzedCardsMissTheirNextTurn()
    {
        var game = TestGame.Start();
        var caster = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Paralyze), 0);
        var victim = game.Put(game.P2, NewCard(5, 5), 0);

        await game.Ability(game.P1, caster, TargetType.EnemyCard, victim.Cid);
        Assert.True(victim.Paralyzed);

        await game.EndTurn(game.P1);
        await game.Attack(game.P2, victim.Cid, -1, 1);
        Assert.Equal(20, game.G1.Health);

        await game.EndTurn(game.P2);
        Assert.False(victim.Paralyzed);
        await game.EndTurn(game.P1);
        await game.Attack(game.P2, victim.Cid, -1, 1);
        Assert.Equal(15, game.G1.Health);
    }

    [Fact]
    public async Task BurnAndHardenTargetTheRightSide()
    {
        var game = TestGame.Start();
        var burner = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Burn), 0);
        var hardener = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Harden), 1);

        await game.Ability(game.P1, burner, TargetType.FriendlyCard, hardener.Cid);
        Assert.False(burner.HasAttacked);
        await game.Ability(game.P1, burner, TargetType.EnemyHero);
        await game.Ability(game.P1, hardener, TargetType.OwnHero);

        Assert.Equal(18, game.G2.Health);
        Assert.Equal(GameRules.HardenArmor, game.G1.Armor);
    }

    [Fact]
    public async Task AbilityValuesComeFromTheCard()
    {
        var game = TestGame.Start();
        var burner = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Burn, value: 4), 0);
        var hardener = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Harden, value: 5), 1);
        var healer = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Heal, value: 1), 2);
        game.G1.Health = 10;

        await game.Ability(game.P1, burner, TargetType.EnemyHero);
        await game.Ability(game.P1, hardener, TargetType.OwnHero);
        await game.Ability(game.P1, healer, TargetType.OwnHero);

        Assert.Equal(16, game.G2.Health);
        Assert.Equal(5, game.G1.Armor);
        Assert.Equal(11, game.G1.Health);
    }

    [Fact]
    public async Task WardBlocksTheFirstDamageOnly()
    {
        var game = TestGame.Start();
        var warded = game.Put(game.P2, NewCard(1, 3, ability: AbilityIds.Ward), 0);
        var attacker = game.Put(game.P1, NewCard(5, 9), 0);
        var burner = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Burn, value: 2), 1);
        Assert.True(warded.Ward);
        game.Messages(game.P1);

        await game.Attack(game.P1, attacker.Cid, warded.Cid, 0);
        Assert.Equal(3, warded.Health);
        Assert.False(warded.Ward);
        Assert.Contains(game.Events(game.P1), e => (string?)e["t"] == "ward" && (bool?)e["on"] == false);

        await game.Ability(game.P1, burner, TargetType.EnemyCard, warded.Cid);
        Assert.Equal(1, warded.Health);
    }

    [Fact]
    public async Task FuryCardsAttackTwice()
    {
        var game = TestGame.Start();
        var fury = game.Put(game.P1, NewCard(2, 9, ability: AbilityIds.Fury), 0);

        await game.Attack(game.P1, fury.Cid, -1, 1);
        Assert.False(fury.HasAttacked);
        await game.Attack(game.P1, fury.Cid, -1, 1);
        Assert.True(fury.HasAttacked);
        await game.Attack(game.P1, fury.Cid, -1, 1);

        Assert.Equal(16, game.G2.Health);
    }

    [Fact]
    public async Task VenomDestroysWhatItDamagesButNotWards()
    {
        var game = TestGame.Start();
        var venom = game.Put(game.P1, NewCard(1, 9, ability: AbilityIds.Venom), 0);
        var big = game.Put(game.P2, NewCard(1, 20, armor: 5), 0);
        var warded = game.Put(game.P2, NewCard(1, 20, ability: AbilityIds.Ward), 1);

        await game.Attack(game.P1, venom.Cid, big.Cid, 0);
        Assert.True(big.IsDead);
        Assert.False(game.G2.BoardCards.ContainsKey(0));

        await game.EndTurn(game.P1);
        await game.EndTurn(game.P2);
        await game.Attack(game.P1, venom.Cid, warded.Cid, 0);
        Assert.False(warded.IsDead);
        Assert.False(warded.Ward);

        // Venom works when defending too.
        await game.EndTurn(game.P1);
        await game.Attack(game.P2, warded.Cid, venom.Cid, 0);
        Assert.True(warded.IsDead);
    }

    [Fact]
    public async Task RallyBuffsTheNeighboursAttack()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var left = game.Put(game.P1, NewCard(1, 1), 2);
        var right = game.Put(game.P1, NewCard(2, 1), 4);
        var far = game.Put(game.P1, NewCard(1, 1), 6);
        var rally = NewCard(1, 1, ability: AbilityIds.Rally, value: 2);
        game.G1.HandCards[rally.Cid] = rally;

        await game.Play(game.P1, rally, 3);

        Assert.Equal((3, 4, 1), (left.Attack, right.Attack, far.Attack));
    }

    [Fact]
    public async Task InsightDrawsCards()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var insight = NewCard(1, 1, ability: AbilityIds.Insight, value: 2);
        game.G1.HandCards[insight.Cid] = insight;
        var hand = game.G1.HandCards.Count;

        await game.Play(game.P1, insight, 0);

        Assert.Equal(hand - 1 + 2, game.G1.HandCards.Count);
    }

    [Fact]
    public async Task InfernoDamagesEveryEnemyCard()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var a = game.Put(game.P2, NewCard(1, 2), 0);
        var b = game.Put(game.P2, NewCard(1, 5), 3);
        var friend = game.Put(game.P1, NewCard(1, 2), 0);
        var inferno = NewCard(1, 1, ability: AbilityIds.Inferno, value: 2);
        game.G1.HandCards[inferno.Cid] = inferno;

        await game.Play(game.P1, inferno, 1);

        Assert.True(a.IsDead);
        Assert.Equal(3, b.Health);
        Assert.Equal(2, friend.Health);
        Assert.Equal(20, game.G2.Health);
    }

    [Fact]
    public async Task RegenerateAndGrowWorkAtTheStartOfTheTurn()
    {
        var game = TestGame.Start();
        var troll = game.Put(game.P2, NewCard(1, 6, ability: AbilityIds.Regenerate, value: 2), 0);
        var grower = game.Put(game.P2, NewCard(2, 2, ability: AbilityIds.Grow, value: 1), 1);
        troll.Health = 1;

        await game.EndTurn(game.P1);

        Assert.Equal(3, troll.Health);
        Assert.Equal((3, 3, 3), (grower.Attack, grower.Health, grower.MaxHealth));
        Assert.Contains(game.Events(game.P2), e => (string?)e["t"] == "trigger" && (int?)e["abilityId"] == AbilityIds.Grow);
    }

    [Fact]
    public async Task DrainDamagesAnEnemyAndHealsTheHero()
    {
        var game = TestGame.Start();
        var drainer = game.Put(game.P1, NewCard(1, 3, ability: AbilityIds.Drain, value: 3), 0);
        game.G1.Health = 10;

        await game.Ability(game.P1, drainer, TargetType.OwnHero);
        Assert.False(drainer.HasAttacked);
        await game.Ability(game.P1, drainer, TargetType.EnemyHero);

        Assert.Equal(17, game.G2.Health);
        Assert.Equal(13, game.G1.Health);
    }

    [Fact]
    public async Task BroodLeavesLostSoulsBehind()
    {
        var game = TestGame.Start();
        var brood = game.Put(game.P2, NewCard(1, 1, ability: AbilityIds.Brood, value: 2), 3);
        var attacker = game.Put(game.P1, NewCard(5, 9), 0);

        await game.Attack(game.P1, attacker.Cid, brood.Cid, 0);

        var tokens = game.G2.BoardCards.Values.Where(c => c.IsToken).OrderBy(c => c.SlotId).ToList();
        Assert.Equal(2, tokens.Count);
        Assert.Equal(3, tokens[0].SlotId);
    }

    [Fact]
    public async Task SummonValueSummonsSeveralLostSouls()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var summoner = NewCard(1, 1, ability: AbilityIds.Summon, value: 2);
        game.G1.HandCards[summoner.Cid] = summoner;

        await game.Play(game.P1, summoner, 0);

        Assert.Equal(2, game.G1.BoardCards.Values.Count(c => c.IsToken));
    }

    [Fact]
    public void CardJsonCarriesRarityAbilityTextAndWard()
    {
        var entity = SeedData.Cards.Single(c => c.Name == "Crimson Duelist");
        var json = Card.FromEntity(entity).NewInstance().ToJson();

        Assert.Equal(Rarity.Rare, (int?)json["rarity"]);
        Assert.True((bool?)json["ward"]);
        Assert.Equal("Ward", (string?)json["ability"]!["label"]);
        Assert.False(string.IsNullOrEmpty((string?)json["ability"]!["text"]));
        Assert.False(string.IsNullOrEmpty((string?)json["flavor"]));
    }

    [Theory]
    [InlineData(1, TargetType.EnemyHero, 19, 15, 0)]
    [InlineData(2, TargetType.EnemyHero, 19, 16, 0)]
    [InlineData(3, TargetType.OwnHero, 20, 17, 0)]
    [InlineData(4, TargetType.OwnHero, 20, 15, 2)]
    public async Task HeroPowersCostTwoManaOncePerTurn(int type, TargetType target, int enemyHealth, int ownHealth, int ownArmor)
    {
        var game = TestGame.Start(type1: new PlayerTypeInfo(type, 1, 20, 0));
        game.G1.Health = 15;
        game.G1.Mana = 5;

        await game.Power(game.P1, target);
        await game.Power(game.P1, target);

        Assert.Equal(3, game.G1.Mana);
        Assert.Equal(enemyHealth, game.G2.Health);
        Assert.Equal(ownHealth, game.G1.Health);
        Assert.Equal(ownArmor, game.G1.Armor);
    }

    [Fact]
    public void EveryClassPicksOneOfTwoPowersAndTheFirstIsTheDefault()
    {
        foreach (var type in SeedData.PlayerTypes)
        {
            var powers = GameRules.PowersOf(type.Id);
            Assert.Equal(2, powers.Count);
            Assert.Equal(type.Id, powers[0]); // the power every class had before keeps its id and stays the default
            Assert.Equal(type.Id, GameRules.PowerOf(type.Id, null));
            Assert.Equal(powers[1], GameRules.PowerOf(type.Id, powers[1]));
        }

        // A power of another class (an old pick after a class change) falls back to the default.
        Assert.Equal(GameRules.Powers.RabidBite, GameRules.PowerOf(1, GameRules.Powers.BloodGift));
    }

    [Fact]
    public void TheChosenPowerIsPlayedAndSentToTheClients()
    {
        var game = TestGame.Start(type1: new PlayerTypeInfo(1, 1, 20, 0), power1: GameRules.Powers.Ravage);
        Assert.Equal(GameRules.Powers.Ravage, game.G1.Power);
        Assert.Equal(GameRules.Powers.Ravage, (int?)game.Room.SyncPayload()["heroes"]!["1"]!["power"]);
        Assert.Equal(GameRules.Powers.Ravage, (int?)game.Room.SpectatorSnapshot()["player"]!["info"]!["power"]);
        Assert.Equal(GameRules.Powers.Ravage, game.Room.Copy().Players.First.GPlayer!.Power);

        var other = TestGame.Start(type1: new PlayerTypeInfo(2, 1, 20, 0), power1: GameRules.Powers.Ravage);
        Assert.Equal(GameRules.Powers.Drain, other.G1.Power);
    }

    [Fact]
    public async Task RavageOnlyHitsEnemyCards()
    {
        var game = TestGame.Start(type1: new PlayerTypeInfo(1, 1, 20, 0), power1: GameRules.Powers.Ravage);
        var enemy = game.Put(game.P2, NewCard(3, 3), 0);
        game.G1.Mana = 10;
        game.Messages(game.P2);

        await game.Power(game.P1, TargetType.EnemyHero);
        Assert.False(game.G1.HeroPowerUsed);
        Assert.Equal(20, game.G2.Health);
        await game.Power(game.P1, TargetType.EnemyCard, enemy.Cid);

        Assert.Equal(3 - GameRules.RavageDamage, enemy.Health);
        Assert.Equal(20 - GameRules.RavageSelfDamage, game.G1.Health);
        Assert.Equal(8, game.G1.Mana);
        var events = game.Events(game.P2);
        Assert.Contains(events, e => (string?)e["t"] == "heroPower" && (int?)e["power"] == GameRules.Powers.Ravage && (string?)e["name"] == "Ravage");
        Assert.Contains(events, e => (string?)e["t"] == "damage" && (int?)e["amount"] == GameRules.RavageDamage);
    }

    [Fact]
    public async Task BloodGiftAegisAndThickHideOnlyTargetFriendlyCards()
    {
        var gift = TestGame.Start(type1: new PlayerTypeInfo(2, 1, 20, 0), power1: GameRules.Powers.BloodGift);
        var card = gift.Put(gift.P1, NewCard(2, 2), 0);
        gift.G1.Mana = 10;
        await gift.Power(gift.P1, TargetType.OwnHero);
        Assert.False(gift.G1.HeroPowerUsed);
        await gift.Power(gift.P1, TargetType.FriendlyCard, card.Cid);
        Assert.Equal((2 + GameRules.BloodGiftAttack, 2 + GameRules.BloodGiftHealth, 2 + GameRules.BloodGiftHealth), (card.Attack, card.Health, card.MaxHealth));
        Assert.Equal(8, gift.G1.Mana);

        var aegis = TestGame.Start(type1: new PlayerTypeInfo(3, 1, 20, 0), power1: GameRules.Powers.Aegis);
        var warded = aegis.Put(aegis.P1, NewCard(2, 2, ability: AbilityIds.Ward), 0);
        var plain = aegis.Put(aegis.P1, NewCard(2, 2), 1);
        aegis.G1.Mana = 10;
        aegis.Messages(aegis.P2);
        await aegis.Power(aegis.P1, TargetType.FriendlyCard, warded.Cid);
        Assert.False(aegis.G1.HeroPowerUsed);
        await aegis.Power(aegis.P1, TargetType.FriendlyCard, plain.Cid);
        Assert.True(plain.Ward);
        Assert.Contains(aegis.Events(aegis.P2), e => (string?)e["t"] == "ward" && (bool?)e["on"] == true);

        var hide = TestGame.Start(type1: new PlayerTypeInfo(4, 1, 20, 0), power1: GameRules.Powers.ThickHide);
        var bear = hide.Put(hide.P1, NewCard(3, 3), 0);
        var enemy = hide.Put(hide.P2, NewCard(3, 3), 0);
        hide.G1.Mana = 10;
        await hide.Power(hide.P1, TargetType.EnemyCard, enemy.Cid);
        Assert.Equal(0, enemy.Armor);
        await hide.Power(hide.P1, TargetType.FriendlyCard, bear.Cid);
        Assert.Equal(GameRules.ThickHideArmor, bear.Armor);
        Assert.Equal(0, hide.G1.Armor);
    }

    [Fact]
    public void ClassCardsAreTwoPerClassOfItsRaceAndOnlyItsOwn()
    {
        Assert.All(SeedData.PlayerTypes, type =>
        {
            var cards = SeedData.Cards.Where(c => c.ClassId == type.Id).ToList();
            Assert.Equal(2, cards.Count);
            Assert.All(cards, c =>
            {
                Assert.Equal(type.RaceId, c.RaceId);
                Assert.NotEqual(1, c.Level); // never a starter card
                Assert.NotEqual(Rarity.Legendary, c.Rarity); // never a season reward
            });
        });
        Assert.True(GameRules.CanUse(null, 1));
        Assert.True(GameRules.CanUse(3, 3));
        Assert.False(GameRules.CanUse(3, 1));
    }

    [Fact]
    public async Task EmptyDecksDealGrowingFatigueAndFullHandsBurnCards()
    {
        var game = TestGame.Start(deck2: [.. Enumerable.Range(0, 5).Select(_ => Definition(1, 1))]);
        Assert.Single(game.G2.Deck);

        await game.EndTurn(game.P1); // draws the last card
        await game.EndTurn(game.P2);
        await game.EndTurn(game.P1); // fatigue 1
        await game.EndTurn(game.P2);
        await game.EndTurn(game.P1); // fatigue 2

        Assert.Equal(17, game.G2.Health);
        Assert.Equal(2, game.G2.Fatigue);

        var full = TestGame.Start();
        while (full.G1.HandCards.Count < GamePlayer.MaxHandCards)
        {
            var c = NewCard(1, 1);
            full.G1.HandCards[c.Cid] = c;
        }

        var deckBefore = full.G1.Deck.Count;
        await full.EndTurn(full.P1);
        await full.EndTurn(full.P2);
        Assert.Equal(deckBefore - 1, full.G1.Deck.Count);
        Assert.Equal(GamePlayer.MaxHandCards, full.G1.HandCards.Count);
        Assert.Contains(full.Events(full.P2), e => (string?)e["t"] == "burned");
    }

    [Fact]
    public async Task KillingTheHeroEndsTheGame()
    {
        var game = TestGame.Start();
        game.G2.Health = 2;
        var attacker = game.Put(game.P1, NewCard(5, 9), 0);

        await game.Attack(game.P1, attacker.Cid, -1, 1);

        Assert.True(game.Room.IsEnded);
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameVictory);
    }

    [Fact]
    public async Task TurnsEndWhenTheTimerRunsOutAndIdlePlayersForfeit()
    {
        var game = TestGame.Start(turnTime: TimeSpan.FromSeconds(30));
        var room = game.Room;

        game.Clock.Now += TimeSpan.FromSeconds(29);
        await game.Engine.CheckTurnTimersAsync();
        Assert.True(game.G1.IsPlayerTurn());

        for (var i = 0; i < 5 && !room.IsEnded; i++)
        {
            game.Clock.Now += TimeSpan.FromSeconds(31);
            await game.Engine.CheckTurnTimersAsync();
        }

        Assert.True(room.IsEnded);
        Assert.Same(game.P2, room.Winner); // player one timed out three times first
    }

    [Fact]
    public async Task MulliganReplacesTheChosenCardsOnceThenTheGameStarts()
    {
        var game = TestGame.Start(deck1: Named(), deck2: Named(), mulligan: true);
        var before = game.G1.HandCards.Values.ToList();
        Assert.Equal(GameRules.StartingHand, before.Count);
        Assert.Equal(GameRules.StartingHand, game.G2.HandCards.Count); // the extra card comes after the mulligan
        Assert.Equal(0, (int?)game.Room.SyncPayload()["current"]); // nobody's turn
        var create = GameData.Get(game.Room, playerOne: true)["mulligan"]!;
        Assert.Equal((30000L, false), ((long)create["endsIn"]!, (bool)create["done"]!));

        await game.Mulligan(game.P1, before[0].Cid, before[2].Cid);

        var after = game.G1.HandCards.Values.ToList();
        Assert.Equal(before[1].Name, after[1].Name); // kept in its place
        Assert.DoesNotContain(after[0].Name, before.Select(c => c.Name)); // new cards, not the replaced ones
        Assert.DoesNotContain(after[2].Name, before.Select(c => c.Name));
        Assert.Equal(Named().Select(c => c.Name).Order(), after.Concat(game.G1.Deck).Select(c => c.Name).Order()); // nothing lost
        var sent = Assert.Single(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameMulligan)["Payload"]!;
        Assert.Equal(2, (int?)sent["replaced"]);
        Assert.Equal(after.Select(c => c.Name), sent["hand"]!.AsArray().Select(c => (string?)c!["name"]));
        Assert.True((bool?)GameData.Get(game.Room, playerOne: true)["mulligan"]!["done"]); // what a reconnect gets

        // A second mulligan is ignored, and nobody may act yet.
        await game.Mulligan(game.P1, after[1].Cid);
        await game.Play(game.P1, after[1], 0);
        await game.EndTurn(game.P1);
        Assert.Equal(after.Select(c => c.Cid), game.G1.HandCards.Keys);
        Assert.Empty(game.G1.BoardCards);
        Assert.True(game.Room.InMulligan);

        await game.Mulligan(game.P2);

        Assert.False(game.Room.InMulligan);
        Assert.True(game.G1.IsPlayerTurn());
        Assert.Equal(2, game.G1.Mana);
        Assert.Equal(GameRules.StartingHand + GameRules.SecondPlayerExtraCards, game.G2.HandCards.Count);
        Assert.Equal(GameRules.DeckSize, game.G2.HandCards.Count + game.G2.Deck.Count);
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameNextTurn && (bool?)m["Payload"]!["yourTurn"] == true);
    }

    [Fact]
    public async Task MulliganRefusesCardsOutsideTheStartingHand()
    {
        var game = TestGame.Start(mulligan: true);
        var hand = game.G1.HandCards.Keys.ToList();
        game.Messages(game.P1);

        await game.Mulligan(game.P1, hand[0], game.G2.HandCards.Keys.First());
        await game.Mulligan(game.P1, game.G1.Deck[0].Cid);
        await Assert.ThrowsAsync<ProtocolException>(() => game.Engine.RequestMulliganAsync(game.P1, Message.Create(GameRequest.Mulligan, new JsonObject { ["replace"] = "all" })));

        Assert.Equal(hand, game.G1.HandCards.Keys);
        Assert.False(game.G1.MulliganDone);
        Assert.Equal(2, game.Messages(game.P1).Count(m => (int?)m["Type"] == (int)GameResponse.GameGeneralMessage));

        await game.Mulligan(game.P1, hand[0]); // a valid choice still counts
        Assert.True(game.G1.MulliganDone);
        Assert.DoesNotContain(hand[0], game.G1.HandCards.Keys);
    }

    [Fact]
    public async Task UndecidedPlayersKeepTheirHandWhenTheMulliganRunsOut()
    {
        var game = TestGame.Start(deck2: Named(), mulligan: true);
        var kept = game.G2.HandCards.Values.Select(c => c.Name).ToList();
        await game.Mulligan(game.P1, game.G1.HandCards.Keys.First());

        game.Clock.Now += TimeSpan.FromSeconds(29);
        await game.Engine.CheckTurnTimersAsync();
        Assert.True(game.Room.InMulligan);

        game.Clock.Now += TimeSpan.FromSeconds(2);
        await game.Engine.CheckTurnTimersAsync();

        Assert.False(game.Room.InMulligan);
        Assert.True(game.G1.IsPlayerTurn());
        Assert.Equal(game.Clock.Now + game.Room.TurnTime, game.Room.TurnDeadline); // a full first turn
        Assert.Equal(kept, game.G2.HandCards.Values.Take(GameRules.StartingHand).Select(c => c.Name));
        Assert.Equal(GameRules.StartingHand + GameRules.SecondPlayerExtraCards, game.G2.HandCards.Count);
        Assert.Equal(0, game.G2.TimeoutsInARow); // not a turn timeout
        Assert.DoesNotContain(game.Events(game.P1), e => (string?)e["t"] == "timeout");
    }

    [Fact]
    public async Task LeavingDuringTheMulliganForfeits()
    {
        var game = TestGame.Start(mulligan: true);

        await game.Engine.ForfeitAsync(game.P2);

        Assert.True(game.Room.IsEnded);
        Assert.Same(game.P1, game.Room.Winner);
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameVictory);
    }

    [Fact]
    public async Task OpponentsAndSpectatorsOnlyLearnHowManyCardsWereReplaced()
    {
        var game = TestGame.Start(mulligan: true);
        var before = game.G1.HandCards.Keys.ToList();
        game.Messages(game.P2);

        await game.Mulligan(game.P1, before[1]);

        var seen = Assert.Single(game.Messages(game.P2), m => (int?)m["Type"] == (int)GameResponse.GameOpponentMulligan)["Payload"]!;
        Assert.Equal(1, (int?)seen["replaced"]);
        Assert.All(seen["hand"]!.AsArray(), c => Assert.Single(c!.AsObject())); // instance ids only
        var cids = seen["hand"]!.AsArray().Select(c => (int)c!["cid"]!).ToList();
        Assert.Equal(game.G1.HandCards.Keys, cids);
        Assert.Empty(cids.Intersect(before)); // all new, so the kept cards cannot be told apart
        Assert.Empty(game.G1.Deck.Select(c => c.Cid).Intersect(before)); // nor can the replaced ones when drawn again

        // Spectators and the replay get player one's new hand without the cards.
        var replayed = game.Room.Replay.Select(r => r["m"]!).Last(m => (int?)m["Type"] == (int)GameResponse.GameMulligan)["Payload"]!;
        Assert.True((bool?)replayed["hidden"]);
        Assert.Equal(cids, replayed["hand"]!.AsArray().Select(c => (int)c!["cid"]!));
        Assert.All(replayed["hand"]!.AsArray(), c => Assert.Single(c!.AsObject()));
    }

    [Fact]
    public void SpectatorsSeePlayerOnesViewWithoutTheHand()
    {
        var game = TestGame.Start();
        var snapshot = game.Room.SpectatorSnapshot();
        var hand = snapshot["player"]!["hand"]!.AsArray();

        Assert.Equal(3, hand.Count);
        Assert.All(hand, card => Assert.Single(card!.AsObject()));
        Assert.True((bool?)snapshot["spectator"]);
        Assert.Contains(game.Room.Replay, r => (int?)r["m"]!["Type"] == (int)GameResponse.SpectateStart);
        Assert.DoesNotContain(game.Room.Replay, r => (int?)r["m"]!["Type"] == (int)GameResponse.GameCreate);
    }

    [Fact]
    public void OpponentHandOnlyRevealsInstanceIds()
    {
        var game = TestGame.Start();
        var data = GameData.Get(game.Room, playerOne: true);
        var opponentHand = data["opponent"]!["hand"]!.AsArray();

        Assert.Equal(GameRules.StartingHand + GameRules.SecondPlayerExtraCards, opponentHand.Count);
        Assert.All(opponentHand, card => Assert.Single(card!.AsObject()));
        Assert.Equal("Filler", (string?)data["player"]!["hand"]!.AsObject().First().Value!["name"]);
    }

    [Fact]
    public void DecksAreBuiltFromOwnedCards()
    {
        var owned = Enumerable.Range(1, 5).Select(i => new Model.Entities.Card { Id = i, Name = "c" + i }).ToList();
        var auto = Decks.Build(owned, c => c.Id, c => c.Rarity, []);
        Assert.Equal(GameRules.DeckSize, auto.Count);
        Assert.All(auto.GroupBy(c => c.Id), g => Assert.Equal(4, g.Count()));

        var saved = Decks.Build(owned, c => c.Id, c => c.Rarity, [(1, 4), (2, 4), (3, 4), (4, 4), (5, 4)]);
        Assert.Equal(GameRules.DeckSize, saved.Count);

        var ownedIds = owned.ToDictionary(c => c.Id, c => c.Rarity);
        Assert.Null(Decks.Validate([(1, 4), (2, 4), (3, 4), (4, 4), (5, 4)], ownedIds));
        Assert.NotNull(Decks.Validate([(1, 5), (2, 4), (3, 4), (4, 4), (5, 3)], ownedIds));
        Assert.NotNull(Decks.Validate([(1, 4), (2, 4), (3, 4), (4, 4), (9, 4)], ownedIds));
        Assert.NotNull(Decks.Validate([(1, 4), (2, 4)], ownedIds));
    }

    [Fact]
    public void RarerCardsAllowFewerCopies()
    {
        var owned = new Dictionary<int, int> { [1] = Rarity.Common, [2] = Rarity.Rare, [3] = Rarity.Epic, [4] = Rarity.Legendary, [5] = Rarity.Common, [6] = Rarity.Common, [7] = Rarity.Common };
        Assert.Null(Decks.Validate([(1, 4), (2, 3), (3, 2), (4, 1), (5, 4), (6, 4), (7, 2)], owned));
        Assert.Contains("1 copy of a legendary", Decks.Validate([(1, 4), (2, 3), (3, 2), (4, 2), (5, 4), (6, 4), (7, 1)], owned)?.ToString());
        Assert.Contains("2 copies of an epic", Decks.Validate([(1, 4), (2, 3), (3, 3), (4, 1), (5, 4), (6, 4), (7, 1)], owned)?.ToString());

        // The automatic deck respects the limits too.
        var cards = owned.Select(x => new Model.Entities.Card { Id = x.Key, Name = "c" + x.Key, Rarity = x.Value }).ToList();
        var deck = Decks.Build(cards, c => c.Id, c => c.Rarity, []);
        Assert.Equal(GameRules.DeckSize, deck.Count);
        Assert.All(deck.GroupBy(c => c.Id), g => Assert.True(g.Count() <= Rarity.MaxCopies(g.First().Rarity)));
    }

    [Fact]
    public void ThemedDecksAreFullAndLegal()
    {
        var pool = SeedData.Cards;
        for (var seed = 0; seed < 50; seed++)
        {
            var deck = Decks.Themed(pool, c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, new Random(seed));
            Assert.Equal(GameRules.DeckSize, deck.Count);
            Assert.Null(Decks.Validate(deck.GroupBy(c => c.Id).Select(g => (g.Key, g.Count())), pool.ToDictionary(c => c.Id, c => c.Rarity)));
            Assert.InRange(deck.Select(c => c.RaceId).Distinct().Count(), 1, 2);
        }
    }

    /// <summary>
    /// The budget formula is only a first guess (the simulator decides, see docs/balance.md), so this only catches
    /// gross mistakes such as a typo in a card's stats.
    /// </summary>
    [Fact]
    public void EveryCardIsWithinItsStatBudget()
    {
        foreach (var card in SeedData.Cards)
        {
            var value = CardPower.Value(card);
            var budget = CardPower.Budget(card);
            Assert.True(Math.Abs(value - budget) <= 3.5, $"{card.Name} is worth {value:0.##} points for a budget of {budget:0.##}");
            Assert.True(card.AbilityId is null || GameRules.Abilities.ContainsKey(card.AbilityId.Value), $"{card.Name} has an unknown ability");
        }

        Assert.Equal(SeedData.Cards.Length, SeedData.Cards.Select(c => c.Id).Distinct().Count());
        Assert.All(new[] { Races.Darkness, Races.Vampiric, Races.Lightbringer, Races.Ferocious }, race =>
        {
            // Cards every class can play (class cards: see ClassCardsAreTwoPerClassOfItsRaceAndOnlyItsOwn).
            Assert.InRange(SeedData.Cards.Count(c => c.RaceId == race && c.ClassId == null && c.Kind == CardKind.Minion), 10, 11);
            Assert.InRange(SeedData.Cards.Count(c => c.RaceId == race && c.ClassId == null && c.Kind == CardKind.Spell), 2, 3);
        });
        Assert.All(SeedData.Abilities, a => Assert.Contains(SeedData.Cards, c => c.AbilityId == a.Id));

        // Spells: no attack or health, an ability a spell can cast, never a starter card or a legendary.
        Assert.All(SeedData.Cards.Where(c => c.Kind == CardKind.Spell), spell =>
        {
            Assert.Equal((0, 0, 0), (spell.Attack, spell.Health, spell.Armor));
            Assert.True(GameRules.IsSpellAbility(spell.AbilityId), $"{spell.Name} cannot be cast");
            Assert.NotEqual(1, spell.Level);
            Assert.NotEqual(Rarity.Legendary, spell.Rarity);
        });
    }

    [Fact]
    public void AbilityLabelsAndTextsShowTheCardsNumbers()
    {
        Assert.Equal("Burn 3", GameRules.AbilityLabel(AbilityIds.Burn, 3));
        Assert.Equal("Burn 2", GameRules.AbilityLabel(AbilityIds.Burn, null));
        Assert.Equal("Rally +1", GameRules.AbilityLabel(AbilityIds.Rally, 1));
        Assert.Equal("Summon", GameRules.AbilityLabel(AbilityIds.Summon, 1));
        Assert.Equal("Summon 2", GameRules.AbilityLabel(AbilityIds.Summon, 2));
        Assert.Equal("Taunt", GameRules.AbilityLabel(AbilityIds.Taunt, null));
        Assert.Equal("Deals 3 damage to an enemy card or hero.", GameRules.AbilityText(AbilityIds.Burn, 3));
        Assert.Equal("When played, summons 2 1/1 Lost Souls next to it.", GameRules.AbilityText(AbilityIds.Summon, 2));
        Assert.Equal("When played, draw a card.".Replace("a card", "1 card", StringComparison.Ordinal), GameRules.AbilityText(AbilityIds.Insight, 1));
        Assert.StartsWith("Restores 5 health", GameRules.AbilityText(AbilityIds.Heal, 3, Races.Lightbringer));
    }

    [Fact]
    public async Task ACopyOfTheGameIsIndependentAndSilent()
    {
        var game = TestGame.Start();
        var mine = game.Put(game.P1, NewCard(3, 3), 0);
        var theirs = game.Put(game.P2, NewCard(2, 2, race: Races.Darkness), 0);
        game.Messages(game.P1);
        game.Messages(game.P2);
        var (logs, replay) = (game.Room.Logger.Records.Count, game.Room.Replay.Count);

        var copy = game.Room.Copy();
        Assert.Equal(game.Room.SyncPayload().ToJsonString(), copy.SyncPayload().ToJsonString());
        Assert.Equal(game.G1.Deck.Select(c => c.Cid).Order(), copy.Players.First.GPlayer!.Deck.Select(c => c.Cid).Order());
        Assert.NotSame(game.Room.Random, copy.Random);
        Assert.Null(copy.Players.First.GameContext);

        // Kill the enemy card (its death curse draws from the copy's random numbers), then the enemy hero.
        var p1 = copy.Players.First;
        await game.Engine.RequestAttackAsync(p1, Message.Create(GameRequest.Attack, new JsonObject { ["source"] = mine.Cid, ["target"] = theirs.Cid, ["type"] = 0 }));
        copy.Players.Second.GPlayer!.Health = 1;
        await game.Engine.RequestAttackAsync(p1, Message.Create(GameRequest.Attack, new JsonObject { ["source"] = -1, ["target"] = -1, ["type"] = 3 }));

        Assert.True(copy.IsEnded);
        Assert.Empty(copy.Players.Second.GPlayer!.BoardCards);
        Assert.False(game.Room.IsEnded);
        Assert.Same(theirs, game.G2.BoardCards[0]);
        Assert.Equal((3, 2, 20), (mine.Health, theirs.Health, game.G2.Health));
        Assert.False(game.G1.HasAttacked);
        Assert.Empty(game.Messages(game.P1));
        Assert.Empty(game.Messages(game.P2));
        Assert.Equal((logs, replay), (game.Room.Logger.Records.Count, game.Room.Replay.Count));
    }

    [Fact]
    public void CopyToCopiesEveryFieldOfACard()
    {
        // CopyTo (a reused copy's card) must stay in step with Copy (MemberwiseClone): a new field has to be added to both.
        var card = NewCard(3, 4);
        var n = 0;
        foreach (var field in typeof(Card).GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
        {
            if (field.FieldType == typeof(int))
            {
                field.SetValue(card, ++n * 7);
            }
            else if (field.FieldType == typeof(bool))
            {
                field.SetValue(card, !(bool)field.GetValue(card)!);
            }
        }

        var copied = card.CopyTo(NewCard(1, 1));
        foreach (var field in typeof(Card).GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
        {
            Assert.Equal(field.GetValue(card), field.GetValue(copied));
        }
    }

    [Fact]
    public async Task CopiesOfACopyShareItsDeckUntilTheyDraw()
    {
        var game = TestGame.Start();
        var copy = game.Room.Copy();
        var deck = copy.Players.Second.GPlayer!.Deck;

        // The first copy has its own deck cards; a copy of it (the bot's lookahead) shares them.
        Assert.DoesNotContain(deck, c => game.G2.Deck.Contains(c));
        var nested = copy.Copy();
        Assert.Equal(deck, nested.Players.Second.GPlayer!.Deck);

        // Ending the nested copy's turn makes player two draw: the drawn card is the nested copy's own.
        var top = deck[^1];
        var (count, health) = (deck.Count, top.Health);
        await game.Engine.RequestNextTurnAsync(nested.Players.First);
        var drawn = nested.Players.Second.GPlayer!.HandCards.Values.Single(c => c.Cid == top.Cid);
        Assert.NotSame(top, drawn);
        drawn.Health += 5;
        Assert.Equal((count, health), (deck.Count, top.Health));
        Assert.Same(top, deck[^1]);
    }

    [Fact]
    public async Task SpellsAreCastOnTheirTargetAndNeverTakeASlot()
    {
        var game = TestGame.Start();
        game.G1.Mana = 5;
        var victim = game.Put(game.P2, NewCard(2, 3), 0);
        var spell = GiveSpell(game.G1, AbilityIds.Burn, value: 3, cost: 2);
        game.Messages(game.P1);
        game.Messages(game.P2);

        await game.Cast(game.P1, spell, TargetType.EnemyCard, victim.Cid);

        Assert.True(victim.IsDead);
        Assert.DoesNotContain(spell.Cid, game.G1.HandCards.Keys);
        Assert.Same(spell, Assert.Single(game.G1.Used));
        Assert.Empty(game.G1.BoardCards);
        Assert.Equal((3, 1), (game.G1.Mana, game.G1.CardsPlayed));
        Assert.Equal(0, game.G1.AbilitiesUsed);

        var mine = game.Messages(game.P1);
        var cast = mine.Single(m => (int?)m["Type"] == (int)GameResponse.GameUseCardSpell)["Payload"]!;
        Assert.Equal(("spell", spell.Cid, victim.Cid), ((string?)cast["card"]!["kind"], (int)cast["card"]!["cid"]!, (int)cast["target"]!["cid"]!));
        Assert.DoesNotContain(mine, m => (int?)m["Type"] == (int)GameResponse.GameUseCardOk);
        var theirs = game.Messages(game.P2);
        Assert.Contains(theirs, m => (int?)m["Type"] == (int)GameResponse.GameOpponentUseCardSpell);
        var ability = theirs.Where(m => (int?)m["Type"] == (int)GameResponse.GameEvents).SelectMany(m => m["Payload"]!["events"]!.AsArray()).First(e => (string?)e!["t"] == "ability")!;
        Assert.Equal((AbilityIds.Burn, spell.Cid), ((int)ability["abilityId"]!, (int)ability["src"]!["cid"]!));

        // Logged as a card played, with the target in the battle log line.
        var log = game.Room.Logger.Records.Last(r => r.GameLogTypeId == (int)Model.Entities.GameLogKind.UseCard);
        Assert.Equal((game.P1.Id, spell.Id), (log.Obj1Id, log.Obj2Id));
        Assert.Equal("p1 casts Spell on Test.", log.Text);

        // A full board does not stop a spell, and it can hit the enemy hero.
        for (var slot = 0; slot < GamePlayer.BoardSlots; slot++)
        {
            game.Put(game.P1, NewCard(1, 1), slot);
        }

        await game.Cast(game.P1, GiveSpell(game.G1, AbilityIds.Burn, value: 3, cost: 2), TargetType.EnemyHero);
        Assert.Equal(17, game.G2.Health);
        Assert.Equal(GamePlayer.BoardSlots, game.G1.BoardCards.Count);
    }

    [Theory]
    [InlineData(AbilityIds.Empower, TargetType.FriendlyCard, true)]
    [InlineData(AbilityIds.Empower, TargetType.OwnHero, false)]
    [InlineData(AbilityIds.Empower, TargetType.EnemyCard, false)]
    [InlineData(AbilityIds.Heal, TargetType.OwnHero, true)]
    [InlineData(AbilityIds.Heal, TargetType.FriendlyCard, true)]
    [InlineData(AbilityIds.Heal, TargetType.EnemyHero, false)]
    [InlineData(AbilityIds.Paralyze, TargetType.EnemyCard, true)]
    [InlineData(AbilityIds.Paralyze, TargetType.EnemyHero, false)]
    [InlineData(AbilityIds.Drain, TargetType.EnemyHero, true)]
    [InlineData(AbilityIds.Drain, TargetType.EnemyCard, true)]
    [InlineData(AbilityIds.Burn, TargetType.FriendlyCard, false)]
    [InlineData(AbilityIds.Burn, null, false)]
    public async Task SpellTargetsAreCheckedLikeAbilityTargets(int ability, TargetType? type, bool allowed)
    {
        var game = TestGame.Start();
        game.G1.Mana = 5;
        game.G1.Health = 10;
        var friend = game.Put(game.P1, NewCard(2, 3), 0);
        var enemy = game.Put(game.P2, NewCard(4, 5), 0);
        var spell = GiveSpell(game.G1, ability, value: 2);
        game.Messages(game.P1);

        await game.Cast(game.P1, spell, type, type == TargetType.FriendlyCard ? friend.Cid : type == TargetType.EnemyCard ? enemy.Cid : -1);

        Assert.Equal(allowed, !game.G1.HandCards.ContainsKey(spell.Cid));
        Assert.Equal(allowed ? 4 : 5, game.G1.Mana);
        var messages = game.Messages(game.P1);
        Assert.Equal(!allowed, messages.Any(m => (int?)m["Type"] == (int)GameResponse.GameGeneralMessage));
        Assert.Equal(!allowed, messages.Any(m => (int?)m["Type"] == (int)GameResponse.GameRelease));
        if (allowed && ability == AbilityIds.Empower)
        {
            Assert.Equal((4, 5, 5), (friend.Attack, friend.Health, friend.MaxHealth));
        }

        if (allowed && ability == AbilityIds.Paralyze)
        {
            Assert.True(enemy.Paralyzed);
        }
    }

    [Fact]
    public async Task UntargetedSpellsDrawOrBurnTheEnemyLine()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        var a = game.Put(game.P2, NewCard(1, 2), 0);
        var b = game.Put(game.P2, NewCard(1, 5), 3);
        var hand = game.G1.HandCards.Count;

        await game.Cast(game.P1, GiveSpell(game.G1, AbilityIds.Inferno, value: 2));
        await game.Cast(game.P1, GiveSpell(game.G1, AbilityIds.Insight, value: 2));

        Assert.True(a.IsDead);
        Assert.Equal(3, b.Health);
        Assert.Equal(hand + 2, game.G1.HandCards.Count);
        Assert.Equal(2, game.G1.Used.Count);
        Assert.Empty(game.G1.BoardCards);
    }

    [Fact]
    public async Task SpellsNeedManaAndTheirOwnersTurn()
    {
        var game = TestGame.Start(mulligan: true);
        var spell = GiveSpell(game.G1, AbilityIds.Burn, cost: 3);
        game.G1.Mana = 10;

        await game.Cast(game.P1, spell, TargetType.EnemyHero); // during the mulligan
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameNotYourTurn);

        await game.Mulligan(game.P1);
        await game.Mulligan(game.P2);
        spell = game.G1.HandCards.Values.Single(c => c.IsSpell); // a kept card gets a new cid
        game.G1.Mana = 2;
        game.Messages(game.P1);
        await game.Cast(game.P1, spell, TargetType.EnemyHero);
        Assert.Contains(game.Messages(game.P1), m => (int?)m["Type"] == (int)GameResponse.GameUseCardOom);

        var theirs = GiveSpell(game.G2, AbilityIds.Burn);
        await game.Cast(game.P2, theirs, TargetType.EnemyHero);
        Assert.Contains(game.Messages(game.P2), m => (int?)m["Type"] == (int)GameResponse.GameNotYourTurn);

        Assert.Equal((20, 20), (game.G1.Health, game.G2.Health));
        Assert.Contains(spell.Cid, game.G1.HandCards.Keys);
        Assert.Contains(theirs.Cid, game.G2.HandCards.Keys);
    }

    [Fact]
    public async Task SpellsKeepTheirRacePassives()
    {
        var game = TestGame.Start();
        game.G1.Mana = 10;
        game.G1.Health = 10;

        await game.Cast(game.P1, GiveSpell(game.G1, AbilityIds.Burn, value: 2, race: Races.Vampiric), TargetType.EnemyHero);
        Assert.Equal((12, 18), (game.G1.Health, game.G2.Health)); // lifesteal

        await game.Cast(game.P1, GiveSpell(game.G1, AbilityIds.Harden, value: 4, race: Races.Lightbringer), TargetType.OwnHero);
        Assert.Equal((14, 4), (game.G1.Health, game.G1.Armor)); // blessing
    }

    [Fact]
    public void UpgradedSpellsGetAStrongerEffectInsteadOfStats()
    {
        var entity = SeedData.Cards.Single(c => c.Name == "Soul Rend");
        var card = Card.FromEntity(entity, level: 3).NewInstance();
        var json = card.ToJson();

        var upgraded = entity.AbilityValue!.Value + 2;
        Assert.True(card.IsSpell);
        Assert.Equal((0, 0, upgraded), (card.Attack, card.Health, card.AbilityValue));
        Assert.Equal(("spell", $"Burn {upgraded}"), ((string?)json["kind"], (string?)json["ability"]!["label"]));
        Assert.Equal(GameRules.AbilityValue(AbilityIds.Paralyze, null), Card.FromEntity(SeedData.Cards.Single(c => c.Name == "Frostbite"), level: 2).AbilityValue);
    }

    [Fact]
    public void RatingsMoveTowardsTheResult()
    {
        // Expected values from an independent Glicko-2 that reproduces Glickman's worked example (1464.06, 151.52).
        static void AssertUpdate(Ratings.Glicko player, double opponent, double opponentDeviation, double score, double rating, double deviation)
        {
            var after = Ratings.Update(player, opponent, opponentDeviation, score);
            Assert.Equal(rating, after.Rating, 0.01);
            Assert.Equal(deviation, after.Deviation, 0.01);
            Assert.InRange(after.Volatility, 0.0599, 0.0601);
        }

        // A new player's first win moves a lot, a settled player's about 15 (the Elo K of 32 before).
        AssertUpdate(new(1000, 350, 0.06), 1000, 350, 1, 1162.31, 290.32);
        AssertUpdate(new(1000, 75, 0.06), 1000, 75, 1, 1015.36, 75);
        AssertUpdate(new(1000, 75, 0.06), 1000, 75, 0, 984.64, 75);
        AssertUpdate(new(1050, 120, 0.06), 1040, 120, 0, 1013.73, 114.59);
        AssertUpdate(new(1000, 75, 0.06), 1400, 75, 1, 1028.57, 75.14);

        // Away for a year: the deviation grows (one rating period a week), but never past a new player's.
        Assert.Equal(75, Ratings.Aged(75, 0.06, TimeSpan.Zero));
        Assert.InRange(Ratings.Aged(75, 0.06, TimeSpan.FromDays(364)), 100, 110);
        Assert.Equal(Ratings.InitialDeviation, Ratings.Aged(300, 0.5, TimeSpan.FromDays(3650)));

        Assert.Equal(1, Ratings.RankOf(900));
        Assert.Equal(1, Ratings.RankOf(1000));
        Assert.Equal(3, Ratings.RankOf(1100));
    }

    [Fact]
    public void SeasonsResetRatingsHalfwayAndRewardTheFinalTier()
    {
        Assert.Equal(1200, Seasons.ResetRating(1400));
        Assert.Equal(950, Seasons.ResetRating(900));
        Assert.Equal(1000, Seasons.ResetRating(1000));
        Assert.Equal(1000, Seasons.ResetRating(1001)); // rounds towards the initial rating
        Assert.Equal(999, Seasons.ResetRating(997));

        Assert.Equal((5, false), Seasons.Reward(Ratings.RankOf(900))); // Bronze
        Assert.Equal((10, false), Seasons.Reward(Ratings.RankOf(1150))); // Silver III
        Assert.Equal((20, false), Seasons.Reward(Ratings.RankOf(1449))); // Gold I
        Assert.Equal((30, false), Seasons.Reward(Ratings.RankOf(1450))); // Platinum III
        Assert.Equal((40, true), Seasons.Reward(Ratings.RankOf(1600))); // Diamond III
        Assert.Equal((50, true), Seasons.Reward(Ratings.RankOf(2400))); // Champion
    }

    [Theory]
    [InlineData("  hello  ", "hello")]
    [InlineData("a\u0000b\u0007c", "abc")]
    [InlineData("<script>", "<script>")]
    public void ChatMessagesAreTrimmedAndStripped(string input, string expected) =>
        Assert.Equal(expected, ChatEngine.Sanitize(input));

    [Fact]
    public void ChatMessagesAreTruncated() =>
        Assert.Equal(ChatEngine.MaxMessageLength, ChatEngine.Sanitize(new string('x', 5000)).Length);
}
