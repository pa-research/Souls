using System.Diagnostics.Metrics;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Server.Ai;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Tests.Unit;

/// <summary>Runs the real bot in-process against a player who only ends their turn.</summary>
public class BotTests
{
    [Theory]
    [InlineData(0, false)]
    [InlineData(1, false)]
    [InlineData(2, false)]
    [InlineData(2, true)]
    public async Task BotPlaysCardsAttacksAndEndsItsTurns(int difficulty, bool lookahead)
    {
        var state = new ServerState();
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), state);
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), scopes, TimeProvider.System, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);
        var service = new GameService(state, engine, new PlayerRepository(scopes), TimeProvider.System, NullLogger<GameService>.Instance);

        Card Definition(int id, int attack, int health, int cost, int? ability = null) =>
            new() { Id = id, Name = "c" + id, BaseAttack = attack, BaseHealth = health, Cost = cost, AbilityId = ability };
        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(i => Definition(i % 3 + 1, 2 + i % 3, 3, i % 4 == 3 ? 5 : 1 + i % 3, i % 5 == 0 ? Model.Entities.Ability.Heal : null))];

        var human = new Player { Id = 1, Name = "human", PlayerType = new PlayerTypeInfo(1, 0, 30, 0), OwningCards = deck, Deck = deck, GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true } };
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var bot = new Player { Id = 2, Name = "bot", PlayerType = new PlayerTypeInfo(1, 1, 30, 0), OwningCards = deck, Deck = deck, IsBot = true, Difficulty = difficulty, GameContext = connection };
        state.GameClients[connection] = bot;
        var ai = new AiPlayer(connection, m => state.RunExclusiveAsync(() => service.ProcessAsync(connection, m)),
            new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero }, difficulty, NullLogger.Instance,
            lookahead ? engine : null, () => state.RunExclusiveAsync(() => bot.GPlayer?.GameRoom?.Copy()));
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var running = Task.Run(() => ai.RunAsync(cts.Token));

        GameRoom? room = null;
        var expensive = 0;
        await state.RunExclusiveAsync(async () =>
        {
            room = engine.CreateGame(new Pair<Player>(human, bot), practice: true);
            expensive = bot.GPlayer!.HandCards.Values.Count(c => c.Cost > 4);
            await engine.RequestMulliganAsync(human, Message.Create(GameRequest.Mulligan));
        });

        // The bot sends back its expensive starting cards (easy bots keep them), then the game starts.
        var mulliganEnds = DateTime.UtcNow.AddSeconds(15);
        while (room!.InMulligan && DateTime.UtcNow < mulliganEnds)
        {
            await Task.Delay(20);
        }

        var inbox = ((BotConnection)human.GameContext!).Inbox;
        var replaced = -1;
        while (inbox.TryRead(out var json))
        {
            var m = JsonNode.Parse(json)!;
            replaced = (int?)m["Type"] == (int)GameResponse.GameOpponentMulligan ? (int)m["Payload"]!["replaced"]! : replaced;
        }

        Assert.Equal(difficulty == 0 ? 0 : expensive, replaced);
        var botTurns = 0;
        for (var turn = 0; turn < 12 && !room!.IsEnded; turn++)
        {
            await state.RunExclusiveAsync(() => engine.RequestNextTurnAsync(human));
            // Wait for the bot to finish its turn.
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (!room.IsEnded && room.CurrentPlaying == bot && DateTime.UtcNow < deadline)
            {
                await Task.Delay(20);
            }

            Assert.True(room.IsEnded || room.CurrentPlaying == human, $"The bot did not end turn {turn}");
            botTurns++;
        }

        Assert.True(botTurns >= 3);
        // The bot has been playing: cards played and damage dealt to the passive human.
        var botGp = room!.Players.Second.GPlayer ?? bot.GPlayer;
        Assert.True(room.IsEnded || (botGp?.CardsPlayed ?? 0) > 0);
        Assert.True(room.IsEnded || human.GPlayer!.Health < 30);
        await cts.CancelAsync();
        connection.Close("done");
        await running;
    }

    [Fact]
    public async Task HardBotLooksAheadToLethalInsteadOfAGoodTrade()
    {
        var state = new ServerState();
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), state);
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), scopes, TimeProvider.System, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);
        var service = new GameService(state, engine, new PlayerRepository(scopes), TimeProvider.System, NullLogger<GameService>.Instance);

        Card Definition(int attack, int health, int cost) => new() { Id = 1, Name = "c", BaseAttack = attack, BaseHealth = health, Cost = cost };
        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => Definition(1, 1, 10))]; // nothing to play
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var bot = new Player { Id = 1, Name = "bot", PlayerType = new PlayerTypeInfo(1, 0, 30, 0), OwningCards = deck, Deck = deck, IsBot = true, Difficulty = 2, GameContext = connection };
        var human = new Player { Id = 2, Name = "human", PlayerType = new PlayerTypeInfo(1, 0, 30, 0), OwningCards = deck, Deck = deck, GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true } };
        state.GameClients[connection] = bot;

        // Two ready 3/3s against 6 health. Killing the 5/1 scores best after one action, but two hits to the face win.
        GameRoom room = null!;
        var trade = Definition(5, 1, 1).NewInstance();
        await state.RunExclusiveAsync(async () =>
        {
            room = engine.CreateGame(new Pair<Player>(bot, human), practice: true);
            foreach (var slot in new[] { 0, 1 })
            {
                var card = Definition(3, 3, 1).NewInstance();
                card.SlotId = slot;
                bot.GPlayer!.BoardCards[slot] = card;
            }

            human.GPlayer!.BoardCards[0] = trade;
            human.GPlayer.Health = 6;
            room.Sync();
            // The human keeps the starting hand; the bot answers the mulligan when it runs, then its turn starts.
            await engine.RequestMulliganAsync(human, Message.Create(GameRequest.Mulligan));
        });

        var ai = new AiPlayer(connection, m => state.RunExclusiveAsync(() => service.ProcessAsync(connection, m)),
            new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero }, 2, NullLogger.Instance,
            engine, () => state.RunExclusiveAsync(() => bot.GPlayer?.GameRoom?.Copy()));
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await ai.RunAsync(cts.Token); // returns when the game is over

        Assert.True(room.IsEnded);
        Assert.Same(bot, room.Winner);
        Assert.Equal(1, trade.Health);
        Assert.Equal(2, ai.PlanTimes.Count);
    }

    [Theory]
    [InlineData(1, false)]
    [InlineData(2, true)]
    public async Task BotCastsALethalBurnPastATaunt(int difficulty, bool lookahead)
    {
        var spell = new Card { Id = 60, Name = "Soul Rend", Kind = Model.Entities.CardKind.Spell, AbilityId = Model.Entities.Ability.Burn, AbilityValueOverride = 3, Cost = 1 }.NewInstance();
        var (room, bot, me, _) = await PlayFirstTurnAsync(difficulty, lookahead, (side, enemy) =>
        {
            side.HandCards[spell.Cid] = spell;
            enemy.BoardCards[0] = new Card { Id = 2, Name = "wall", BaseAttack = 1, BaseHealth = 9, AbilityId = Model.Entities.Ability.Taunt }.NewInstance();
            enemy.Health = 3;
        });

        Assert.Same(bot, room.Winner);
        Assert.Equal("Soul Rend", Assert.Single(me.Used).Name);
    }

    [Fact]
    public async Task LookaheadCastsASpellToSetUpLethal()
    {
        var empower = new Card { Id = 68, Name = "Primal Might", Kind = Model.Entities.CardKind.Spell, AbilityId = Model.Entities.Ability.Empower, AbilityValueOverride = 2, Cost = 1 }.NewInstance();
        var (room, bot, me, ai) = await PlayFirstTurnAsync(2, true, (side, enemy) =>
        {
            side.HandCards[empower.Cid] = empower;
            side.BoardCards[0] = new Card { Id = 3, Name = "wolf", BaseAttack = 3, BaseHealth = 3 }.NewInstance();
            enemy.Health = 5;
        });

        // 3 damage is not enough; empowered to 5/5 it is.
        Assert.Same(bot, room.Winner);
        Assert.Single(me.Used);
        Assert.Equal(2, ai.PlanTimes.Count);
    }

    /// <summary>
    /// The bot (player one, nothing affordable in its deck) plays its first turn after <paramref name="setup"/> changed
    /// its side and the enemy's; returns when the game is over (or after 10 seconds).
    /// </summary>
    private static async Task<(GameRoom Room, Player Bot, GamePlayer Me, AiPlayer Ai)> PlayFirstTurnAsync(int difficulty, bool lookahead, Action<GamePlayer, GamePlayer> setup)
    {
        var state = new ServerState();
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        var metrics = new GameMetrics(services.GetRequiredService<IMeterFactory>(), state);
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), scopes, TimeProvider.System, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);
        var service = new GameService(state, engine, new PlayerRepository(scopes), TimeProvider.System, NullLogger<GameService>.Instance);

        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => new Card { Id = 1, Name = "c", BaseAttack = 1, BaseHealth = 1, Cost = 10 })];
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        var bot = new Player { Id = 1, Name = "bot", PlayerType = new PlayerTypeInfo(1, 0, 30, 0), OwningCards = deck, Deck = deck, IsBot = true, Difficulty = difficulty, GameContext = connection };
        var human = new Player { Id = 2, Name = "human", PlayerType = new PlayerTypeInfo(1, 0, 30, 0), OwningCards = deck, Deck = deck, GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true } };
        state.GameClients[connection] = bot;

        GameRoom room = null!;
        GamePlayer me = null!;
        await state.RunExclusiveAsync(async () =>
        {
            room = engine.CreateGame(new Pair<Player>(bot, human), practice: true);
            me = bot.GPlayer!;
            setup(me, human.GPlayer!);
            room.Sync();
            await engine.RequestMulliganAsync(human, Message.Create(GameRequest.Mulligan));
        });

        var ai = new AiPlayer(connection, m => state.RunExclusiveAsync(() => service.ProcessAsync(connection, m)),
            new AiOptions { ThinkDelay = TimeSpan.Zero, AttackDelay = TimeSpan.Zero }, difficulty, NullLogger.Instance,
            lookahead ? engine : null, () => state.RunExclusiveAsync(() => bot.GPlayer?.GameRoom?.Copy()));
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await ai.RunAsync(cts.Token); // returns when the game is over

        return (room, bot, me, ai);
    }
}
