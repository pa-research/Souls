using System.Diagnostics.Metrics;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Localization;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;
using Card = Souls.Server.Objects.Card;
using Player = Souls.Server.Objects.Player;
using Races = Souls.Model.GameRules.Races;

namespace Souls.Tests.Unit;

public partial class LocalizationTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 31, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static Card NewCard(int attack, int health, int? ability = null, int? race = null, string name = "Test", int? value = null, int cost = 1, CardKind kind = CardKind.Minion) =>
        new Card { Id = 1, Name = name, BaseAttack = attack, BaseHealth = health, AbilityId = ability, AbilityValueOverride = value, RaceId = race, Cost = cost, Kind = kind }.NewInstance();

    private static Player NewPlayer(int id, PlayerTypeInfo type)
    {
        var deck = Enumerable.Range(0, GameRules.DeckSize).Select(_ => new Card { Id = 1, Name = "Filler", BaseAttack = 1, BaseHealth = 1 }).ToList();
        return new Player
        {
            Id = id,
            Name = "p" + id,
            PlayerType = type,
            OwningCards = deck,
            Deck = deck,
            GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true },
        };
    }

    /// <summary>
    /// Plays a game that makes the server say nearly everything it can (every battle log line, the errors, the
    /// result) and checks every message both players got: each text has its key, the key has an English and a
    /// Norwegian text, and the English text is exactly what the server sent.
    /// </summary>
    [Fact]
    public async Task ServerSendsAKeyWithEveryText()
    {
        var clock = new ManualTime();
        var state = new ServerState();
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), services.GetRequiredService<IServiceScopeFactory>(), clock,
            Options.Create(new GameOptions()), new GameMetrics(services.GetRequiredService<IMeterFactory>(), state), NullLogger<GameEngine>.Instance);
        var p1 = NewPlayer(1, new PlayerTypeInfo(1, Attack: 5, Health: 30, Mana: 1));
        var p2 = NewPlayer(2, new PlayerTypeInfo(3, Attack: 2, Health: 30, Mana: 1));
        var room = engine.CreateGame(new Pair<Player>(p1, p2));
        var (g1, g2) = (p1.GPlayer!, p2.GPlayer!);

        Task Send(Player p, GameRequest type, JsonObject payload) => type switch
        {
            GameRequest.Attack => engine.RequestAttackAsync(p, Message.Create(type, payload)),
            GameRequest.UseCard => engine.RequestUseCardAsync(p, Message.Create(type, payload)),
            GameRequest.UseAbility => engine.RequestUseAbilityAsync(p, Message.Create(type, payload)),
            GameRequest.HeroPower => engine.RequestHeroPowerAsync(p, Message.Create(type, payload)),
            GameRequest.Mulligan => engine.RequestMulliganAsync(p, Message.Create(type, payload)),
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
        Task UseAbility(Player p, Card source, TargetType type, int target = -1) =>
            Send(p, GameRequest.UseAbility, new JsonObject { ["source"] = source.Cid, ["target"] = target, ["type"] = (int)type });
        Task Attack(Player p, int source, int target, int type) =>
            Send(p, GameRequest.Attack, new JsonObject { ["source"] = source, ["target"] = target, ["type"] = type });
        Task Play(Player p, Card card, int slot) => Send(p, GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = slot });
        Task Cast(Player p, Card spell, TargetType? type = null, int target = -1) => Send(p, GameRequest.UseCard, type is { } t
            ? new JsonObject { ["cid"] = spell.Cid, ["target"] = target, ["type"] = (int)t }
            : new JsonObject { ["cid"] = spell.Cid });
        Card Put(GamePlayer gp, Card card, int slot)
        {
            card.SlotId = slot;
            gp.BoardCards[slot] = card;
            return card;
        }

        Card Hand(GamePlayer gp, Card card)
        {
            gp.HandCards[card.Cid] = card;
            return card;
        }

        // The mulligan: player one replaces a card, player two keeps the hand.
        await Send(p1, GameRequest.Mulligan, new JsonObject { ["replace"] = new JsonArray(g1.HandCards.Keys.First()) });
        await Send(p2, GameRequest.Mulligan, new JsonObject { ["replace"] = new JsonArray() });
        g1.Mana = 30;
        g1.Health = 20;

        // Not your turn.
        await Attack(p2, -1, -1, 3);
        await Play(p2, g2.HandCards.Values.First(), 0);

        var taunt = Put(g2, NewCard(1, 30, Ability.Taunt), 0);
        var ward = Put(g2, NewCard(1, 5, Ability.Ward), 1);
        var dark = Put(g2, NewCard(1, 1, race: Races.Darkness), 2);
        var haunt = Put(g2, NewCard(1, 1, Ability.Haunt), 3);
        var brood = Put(g2, NewCard(1, 1, Ability.Brood, value: 2), 4);
        var regenerate = Put(g2, NewCard(1, 5, Ability.Regenerate), 5);
        Put(g2, NewCard(1, 5, Ability.Grow), 6);

        await Attack(p1, -1, -1, 3); // the Taunt card is in the way
        var burner = Put(g1, NewCard(1, 5, Ability.Burn, value: 1), 0);
        await UseAbility(p1, burner, TargetType.EnemyCard, taunt.Cid);
        await UseAbility(p1, burner, TargetType.EnemyCard, taunt.Cid); // used this turn already
        var healer = Put(g1, NewCard(1, 5, Ability.Heal), 1);
        await UseAbility(p1, healer, TargetType.EnemyHero);
        await UseAbility(p1, healer, TargetType.OwnHero);
        await UseAbility(p1, Put(g1, NewCard(1, 5, Ability.Harden), 2), TargetType.OwnHero);
        var paralyzer = Put(g1, NewCard(1, 5, Ability.Paralyze), 3);
        await UseAbility(p1, paralyzer, TargetType.FriendlyCard, burner.Cid);
        await UseAbility(p1, paralyzer, TargetType.EnemyCard, regenerate.Cid);
        await UseAbility(p1, Put(g1, NewCard(1, 5, Ability.Drain, value: 1), 4), TargetType.EnemyHero);
        var sacrifice = Put(g1, NewCard(1, 5, Ability.Sacrifice), 5);
        await UseAbility(p1, sacrifice, TargetType.FriendlyCard, sacrifice.Cid);
        await UseAbility(p1, sacrifice, TargetType.OwnHero);

        var venom = Put(g1, NewCard(1, 9, Ability.Venom), 5);
        venom.Paralyzed = true;
        await Attack(p1, venom.Cid, taunt.Cid, 0); // paralyzed
        venom.Paralyzed = false;
        g2.BoardCards.Remove(taunt.SlotId); // out of the way
        await Attack(p1, venom.Cid, ward.Cid, 0); // the ward breaks
        venom.HasAttacked = false;
        await Attack(p1, venom.Cid, ward.Cid, 0); // venom kills
        await Attack(p1, Put(g1, NewCard(2, 9, race: Races.Vampiric), 6).Cid, dark.Cid, 0); // lifesteal, death curse
        await Attack(p1, -1, haunt.Cid, 2); // the hero kills the Haunt card: it returns
        await Cast(p1, Hand(g1, NewCard(0, 0, Ability.Burn, value: 5, kind: CardKind.Spell)), TargetType.EnemyCard, brood.Cid);

        // Spells, on-play abilities, a full hand.
        g1.BoardCards.Remove(1);
        g1.BoardCards.Remove(2);
        await Play(p1, Hand(g1, NewCard(1, 1, Ability.Summon, Races.Lightbringer)), 1);
        g1.BoardCards.Remove(3);
        await Play(p1, Hand(g1, NewCard(1, 1, Ability.Rally)), 3);
        await Cast(p1, Hand(g1, NewCard(0, 0, Ability.Inferno, kind: CardKind.Spell)));
        await Cast(p1, Hand(g1, NewCard(0, 0, Ability.Empower, kind: CardKind.Spell)), TargetType.FriendlyCard, venom.Cid);
        while (g1.HandCards.Count < GamePlayer.MaxHandCards - 1)
        {
            Hand(g1, NewCard(1, 1));
        }

        await Cast(p1, Hand(g1, NewCard(0, 0, Ability.Insight, value: 2, kind: CardKind.Spell)));
        await Play(p1, g1.HandCards.Values.First(c => !c.IsSpell), 0); // slot taken
        g1.Mana = 0;
        g1.BoardCards.Remove(2);
        await Play(p1, g1.HandCards.Values.First(c => !c.IsSpell), 2); // no mana
        await Send(p1, GameRequest.HeroPower, new JsonObject { ["target"] = -1, ["type"] = (int)TargetType.EnemyHero }); // no mana
        g1.Mana = 30;
        await Send(p1, GameRequest.HeroPower, new JsonObject { ["target"] = -1, ["type"] = (int)TargetType.EnemyHero });
        await Send(p1, GameRequest.HeroPower, new JsonObject { ["target"] = -1, ["type"] = (int)TargetType.EnemyHero }); // used

        // Emotes, a challenge and spectating while in a game.
        for (var i = 0; i < 5; i++)
        {
            engine.RequestEmote(p1, i);
        }

        engine.RequestChallenge(p1, "p2");
        engine.Spectate(p1, room.GameId);

        // Player two's turn: start-of-turn abilities and fatigue from an empty deck.
        regenerate.Health = 2;
        g2.Deck.Clear();
        await engine.RequestNextTurnAsync(p1);
        await Send(p2, GameRequest.HeroPower, new JsonObject { ["target"] = -1, ["type"] = (int)TargetType.EnemyHero }); // Holy Light targets friends

        // The turn runs out; then player one wins with the hero power.
        clock.Now += TimeSpan.FromMinutes(2);
        await engine.CheckTurnTimersAsync();
        g1.Mana = 30;
        g2.Health = 1;
        g2.Armor = 0;
        await Send(p1, GameRequest.HeroPower, new JsonObject { ["target"] = -1, ["type"] = (int)TargetType.EnemyHero });

        var problems = new List<string>();
        var keys = new HashSet<string>();
        foreach (var player in new[] { p1, p2 })
        {
            var inbox = ((BotConnection)player.GameContext!).Inbox;
            while (inbox.TryRead(out var json))
            {
                CheckTexts(JsonNode.Parse(json)!, problems, keys);
            }
        }

        Assert.True(problems.Count == 0, string.Join("\n", problems.Distinct()));

        string[] expected =
        [
            "log.gameStart", "log.mulliganReplace", "log.mulliganKeep", "log.plays", "log.cast", "log.castOn", "log.turn", "log.secondExtraMana", "log.attack",
            "log.timeout", "log.heroFallen", "log.win", "log.wardBreaks", "log.venom", "log.lifesteal", "log.dies", "log.deathCurse", "log.haunt", "log.fatigue",
            "log.burned", "log.summon", "log.blessing", "log.insight", "log.inferno", "log.regenerate", "log.grow", "log.heal", "log.sacrifice",
            "log.paralyze", "log.harden", "log.burn", "log.drain", "log.empower", "log.heroPower",
            "error.notYourTurn", "error.mana", "error.slotOccupied", "error.taunt", "error.powerUsed", "error.powerTargetFriendly", "error.paralyzed",
            "error.notYet", "error.healEnemy", "error.paralyzeEnemy", "error.notItself", "error.emoteTooFast", "challenge.busySelf", "spectate.busy",
            "emote.0", "ability.8.name", "ability.label.value", "ability.8.text", "power.1.name",
        ];
        var unseen = expected.Where(k => !keys.Contains(k)).ToList();
        Assert.True(unseen.Count == 0, "Not sent: " + string.Join(", ", unseen));
        Assert.True(keys.Contains("log.rally") || keys.Contains("log.rally2"));
    }

    /// <summary>
    /// Each text field (<c>text</c>, <c>error</c>, <c>message</c>, <c>label</c>, <c>tier</c>, a string payload) must
    /// have its key; each key must have English and Norwegian texts, and render to exactly the English text sent.
    /// </summary>
    private static void CheckTexts(JsonNode? node, List<string> problems, HashSet<string> keys)
    {
        switch (node)
        {
            case JsonObject o:
                if (o["Payload"] is JsonValue payload && payload.GetValueKind() == System.Text.Json.JsonValueKind.String && o["PayloadKey"] is null)
                {
                    problems.Add($"Type {o["Type"]}: string payload without a key: {payload}");
                }

                foreach (var field in new[] { "text", "error", "message", "label", "tier" })
                {
                    if (o[field] is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.String && o[field + "Key"] is null)
                    {
                        problems.Add($"'{field}' without a key: {o.ToJsonString()}");
                    }
                }

                foreach (var (name, value) in o.ToList())
                {
                    if (name.EndsWith("Key", StringComparison.Ordinal) && value is JsonValue k && k.GetValueKind() == System.Text.Json.JsonValueKind.String)
                    {
                        var key = k.GetValue<string>();
                        var field = name[..^3];
                        keys.Add(key);
                        var text = GameText.FromJson(key, o[field + "Args"]?.ToJsonString());
                        foreach (var language in Strings.Languages)
                        {
                            if (!Strings.Has(language, key) && !Strings.Has(language, key + "_other") && !(language == Strings.Default && field == "flavor"))
                            {
                                problems.Add($"{key}: no {language} text");
                            }
                        }

                        if (field != "flavor" && (string?)o[field] != text.ToString())
                        {
                            problems.Add($"{key}: sent '{o[field]}', English table says '{text}'");
                        }
                    }

                    CheckTexts(value, problems, keys);
                }

                break;
            case JsonArray a:
                foreach (var item in a)
                {
                    CheckTexts(item, problems, keys);
                }

                break;
        }
    }
}
