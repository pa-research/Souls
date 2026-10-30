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

        public static TestGame Start(IReadOnlyList<Card>? deck1 = null, IReadOnlyList<Card>? deck2 = null, PlayerTypeInfo? type1 = null, PlayerTypeInfo? type2 = null, TimeSpan? turnTime = null)
        {
            var clock = new ManualTime();
            var state = new ServerState();
            var services = new ServiceCollection().BuildServiceProvider();
            var options = Options.Create(new GameOptions { TurnTime = turnTime ?? TimeSpan.FromSeconds(75) });
            var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), services.GetRequiredService<IServiceScopeFactory>(), clock, options, NullLogger<GameEngine>.Instance);
            var game = new TestGame(clock, engine, NewPlayer(1, deck1 ?? Filler(), type1), NewPlayer(2, deck2 ?? Filler(), type2));
            game._room = engine.CreateGame(new Pair<Player>(game.P1, game.P2));
            return game;
        }

        private static IReadOnlyList<Card> Filler() => [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => Definition(1, 1, name: "Filler"))];

        private static Player NewPlayer(int id, IReadOnlyList<Card> deck, PlayerTypeInfo? type) => new()
        {
            Id = id,
            Name = "p" + id,
            PlayerType = type ?? new PlayerTypeInfo(1, Attack: 5, Health: 20, Mana: 1),
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
            while (inbox.TryRead(out var json))
            {
                list.Add(JsonNode.Parse(json)!);
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

        public Task EndTurn(Player p) => Engine.RequestNextTurnAsync(p);
    }

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
        Assert.Contains("1 copy of a legendary", Decks.Validate([(1, 4), (2, 3), (3, 2), (4, 2), (5, 4), (6, 4), (7, 1)], owned));
        Assert.Contains("2 copies of a epic", Decks.Validate([(1, 4), (2, 3), (3, 3), (4, 1), (5, 4), (6, 4), (7, 1)], owned));

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
        Assert.All(new[] { Races.Darkness, Races.Vampiric, Races.Lightbringer, Races.Ferocious },
            race => Assert.InRange(SeedData.Cards.Count(c => c.RaceId == race), 10, 11));
        Assert.All(SeedData.Abilities, a => Assert.Contains(SeedData.Cards, c => c.AbilityId == a.Id));
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
    public void RatingsMoveTowardsTheResult()
    {
        Assert.Equal(16, Ratings.Change(1000, 1000, 1));
        Assert.Equal(-16, Ratings.Change(1000, 1000, 0));
        Assert.True(Ratings.Change(1000, 1400, 1) > 16);
        Assert.Equal(1, Ratings.RankOf(900));
        Assert.Equal(1, Ratings.RankOf(1000));
        Assert.Equal(3, Ratings.RankOf(1100));
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
