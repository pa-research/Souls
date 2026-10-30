using System.Diagnostics.Metrics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Tests.Unit;

public class GameMetricsTests
{
    private sealed record Measured(string Name, double Value, Dictionary<string, object?> Tags);

    [Fact]
    public async Task GameMetricsArePublishedOnTheServerMeter()
    {
        var services = new ServiceCollection().AddMetrics().BuildServiceProvider();
        var meterFactory = services.GetRequiredService<IMeterFactory>();
        var state = new ServerState();
        var metrics = new GameMetrics(meterFactory, state);
        var engine = new GameEngine(state, new ChatEngine(state, NullLogger<ChatEngine>.Instance), services.GetRequiredService<IServiceScopeFactory>(),
            TimeProvider.System, Options.Create(new GameOptions()), metrics, NullLogger<GameEngine>.Instance);

        var measured = new List<Measured>();
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, l) =>
        {
            // Only this test's meter: other tests create their own.
            if (instrument.Meter.Name == GameMetrics.MeterName && instrument.Meter.Scope == meterFactory)
            {
                l.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<int>((i, value, tags, _) => measured.Add(new(i.Name, value, new(tags.ToArray()))));
        listener.SetMeasurementEventCallback<long>((i, value, tags, _) => measured.Add(new(i.Name, value, new(tags.ToArray()))));
        listener.SetMeasurementEventCallback<double>((i, value, tags, _) => measured.Add(new(i.Name, value, new(tags.ToArray()))));
        listener.Start();

        bool Has(string name, double value, params (string Key, string Value)[] tags) =>
            measured.Any(m => m.Name == name && m.Value == value && tags.All(t => Equals(m.Tags.GetValueOrDefault(t.Key), t.Value)));

        // A running game and a queued player.
        var p1 = NewPlayer(1);
        var p2 = NewPlayer(2);
        engine.CreateGame(new Pair<Player>(p1, p2));
        state.PracticeQueue.AddLast(NewPlayer(3));
        listener.RecordObservableInstruments();
        Assert.True(Has("souls.games.running", 1));
        Assert.True(Has("souls.queue.players", 0, ("mode", "normal")));
        Assert.True(Has("souls.queue.players", 1, ("mode", "practice")));

        // Player two leaves: the game ends as a forfeit (and cannot be stored without a database).
        await engine.ForfeitAsync(p2);
        Assert.True(Has("souls.games.finished", 1, ("mode", "normal"), ("result", "forfeit")));
        Assert.True(Has("souls.errors", 1, ("source", "store")));
        measured.Clear();
        listener.RecordObservableInstruments();
        Assert.True(Has("souls.games.running", 0));

        metrics.QueueWaited("normal", TimeSpan.FromSeconds(12));
        metrics.ConnectionOpened(ServiceKind.Chat);
        Assert.True(Has("souls.queue.wait_time", 12, ("mode", "normal")));
        Assert.True(Has("souls.websocket.connections", 1, ("service", "chat")));
    }

    private static Player NewPlayer(int id)
    {
        IReadOnlyList<Card> deck = [.. Enumerable.Range(0, GameRules.DeckSize).Select(_ => new Card { Id = 1, Name = "c", BaseAttack = 1, BaseHealth = 1, Cost = 1 })];
        return new Player
        {
            Id = id,
            Name = "p" + id,
            PlayerType = new PlayerTypeInfo(1, Attack: 1, Health: 20, Mana: 1),
            OwningCards = deck,
            Deck = deck,
            GameContext = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true },
        };
    }
}
