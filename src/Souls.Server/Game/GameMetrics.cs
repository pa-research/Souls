using System.Diagnostics.Metrics;
using Souls.Server.Network;

namespace Souls.Server.Game;

/// <summary>Game server metrics on the <c>Souls.Server</c> meter, exported when OpenTelemetry is configured.</summary>
public sealed class GameMetrics
{
    public const string MeterName = "Souls.Server";

    private readonly Histogram<double> _queueWait;
    private readonly Counter<long> _gamesFinished;
    private readonly UpDownCounter<long> _connections;
    private readonly Counter<long> _errors;

    public GameMetrics(IMeterFactory meterFactory, ServerState state)
    {
        var meter = meterFactory.Create(MeterName);

        // Read without the state lock: a count that is a moment old is fine for a gauge.
        meter.CreateObservableGauge("souls.games.running", () => state.Rooms.Count, "{game}", "Games in progress.");
        meter.CreateObservableGauge<int>("souls.queue.players", () =>
        [
            new(state.NormalQueue.Count, Tag("mode", "normal")),
            new(state.PracticeQueue.Count, Tag("mode", "practice")),
        ], "{player}", "Players waiting for a game.");
        _queueWait = meter.CreateHistogram("souls.queue.wait_time", "s", "Time from joining the queue to the start of the game.",
            advice: new InstrumentAdvice<double> { HistogramBucketBoundaries = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600] });
        _gamesFinished = meter.CreateCounter<long>("souls.games.finished", "{game}", "Games ended, by mode and result (win, draw, forfeit).");
        _connections = meter.CreateUpDownCounter<long>("souls.websocket.connections", "{connection}", "Open WebSocket connections.");
        _errors = meter.CreateCounter<long>("souls.errors", "{error}", "Unhandled errors, by where they were caught.");
    }

    /// <param name="mode"><c>normal</c> or <c>practice</c>.</param>
    public void QueueWaited(string mode, TimeSpan wait) => _queueWait.Record(wait.TotalSeconds, Tag("mode", mode));

    public void GameFinished(string mode, string result) => _gamesFinished.Add(1, Tag("mode", mode), Tag("result", result));

    public void ConnectionOpened(ServiceKind kind) => _connections.Add(1, Tag("service", Service(kind)));

    public void ConnectionClosed(ServiceKind kind) => _connections.Add(-1, Tag("service", Service(kind)));

    public void Error(string source) => _errors.Add(1, Tag("source", source));

    private static string Service(ServiceKind kind) => kind switch
    {
        ServiceKind.Game => "game",
        ServiceKind.Chat => "chat",
        _ => "admin",
    };

    private static KeyValuePair<string, object?> Tag(string key, string value) => new(key, value);
}
