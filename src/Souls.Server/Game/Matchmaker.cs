using Microsoft.Extensions.Options;
using Souls.Model.Security;
using Souls.Server.Ai;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

public sealed class MatchmakerOptions
{
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>How long a disconnected player may take to reconnect before forfeiting the game.</summary>
    public TimeSpan ReconnectGracePeriod { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>How often open connections are checked against the session store (logout, bans).</summary>
    public TimeSpan SessionRevalidationInterval { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>Pairs queued players, starts practice games against the bot and cleans up abandoned players.</summary>
public sealed class Matchmaker(
    ServerState state,
    GameEngine engine,
    GameService gameService,
    PlayerRepository players,
    ConnectionRegistry registry,
    IServiceScopeFactory scopes,
    TimeProvider time,
    IOptions<MatchmakerOptions> options,
    IOptions<AiOptions> aiOptions,
    ILoggerFactory loggerFactory) : BackgroundService
{
    private readonly ILogger _logger = loggerFactory.CreateLogger<Matchmaker>();
    private readonly List<Task> _bots = [];
    private DateTimeOffset _lastRevalidation;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Value.Interval, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _logger.LogError(e, "Matchmaking failed");
            }
        }

        await Task.WhenAll(_bots);
    }

    internal async Task TickAsync(CancellationToken ct)
    {
        // Database work happens outside the state lock.
        var practiceWaiting = await state.RunExclusiveAsync(() => state.PracticeQueue.Where(p => p.GameContext?.IsOpen == true).Select(p => p.PracticeDifficulty).ToList());
        var bots = new List<Player>(practiceWaiting.Count);
        if (practiceWaiting.Count > 0)
        {
            var names = await players.GetBotNamesAsync(ct);
            foreach (var difficulty in practiceWaiting)
            {
                var name = names.Count > 0 ? names[Random.Shared.Next(names.Count)] : "Bot";
                bots.Add(await players.CreateBotAsync($"[BOT] {name} ({DifficultyNames[difficulty]})", difficulty, ct));
            }
        }

        await state.RunExclusiveAsync(async () =>
        {
            RemoveDisconnected(state.NormalQueue);
            RemoveDisconnected(state.PracticeQueue);
            MatchNormal();
            MatchPractice(bots, ct);
            await ForfeitAbandonedAsync();
            await engine.CheckTurnTimersAsync();
        });

        _bots.RemoveAll(t => t.IsCompleted);

        if (time.GetUtcNow() - _lastRevalidation >= options.Value.SessionRevalidationInterval)
        {
            _lastRevalidation = time.GetUtcNow();
            await RevalidateSessionsAsync(ct);
        }
    }

    private void RemoveDisconnected(LinkedList<Player> queue)
    {
        foreach (var player in queue.Where(p => p.GameContext?.IsOpen != true).ToList())
        {
            engine.RemoveFromQueues(player);
        }
    }

    private static readonly string[] DifficultyNames = ["Easy", "Normal", "Hard"];

    /// <summary>
    /// Pairs players by rating: the longest waiting player gets the closest rated opponent within a window that
    /// widens while they wait.
    /// </summary>
    private void MatchNormal()
    {
        var now = time.GetUtcNow();
        var waiting = state.NormalQueue.OrderBy(p => p.QueuedAt).ToList();
        while (waiting.Count > 1)
        {
            var first = waiting[0];
            var window = Model.Ratings.MatchWindow(now - first.QueuedAt);
            var partner = waiting.Skip(1)
                .Where(p => Math.Abs(p.Rating - first.Rating) <= Math.Max(window, Model.Ratings.MatchWindow(now - p.QueuedAt)))
                .OrderBy(p => Math.Abs(p.Rating - first.Rating))
                .FirstOrDefault();
            waiting.Remove(first);
            if (partner is null)
            {
                continue;
            }

            waiting.Remove(partner);
            engine.RemoveFromQueues(first);
            engine.RemoveFromQueues(partner);
            engine.CreateGame(new Pair<Player>(first, partner));
        }
    }

    private void MatchPractice(List<Player> bots, CancellationToken ct)
    {
        foreach (var bot in bots)
        {
            var human = state.PracticeQueue.FirstOrDefault(p => p.GameContext?.IsOpen == true && p.PracticeDifficulty == bot.Difficulty)
                ?? state.PracticeQueue.FirstOrDefault(p => p.GameContext?.IsOpen == true);
            if (human is null)
            {
                return;
            }

            engine.RemoveFromQueues(human);

            var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
            bot.GameContext = connection;
            bot.ChatContext = connection;
            bot.ChPlayer = new ChatPlayer(bot.Name) { ChatContext = connection };
            state.GameClients[connection] = bot;

            var logger = loggerFactory.CreateLogger<AiPlayer>();
            var ai = new AiPlayer(
                connection,
                message => state.RunExclusiveAsync(() => WebSocketEndpoints.ProcessAsync(gameService, connection, message, logger)),
                aiOptions.Value,
                bot.Difficulty,
                logger);
            _bots.Add(Task.Run(() => ai.RunAsync(ct), ct));

            engine.CreateGame(new Pair<Player>(human, bot), practice: true);
        }
    }

    private async Task ForfeitAbandonedAsync()
    {
        var now = time.GetUtcNow();
        foreach (var (connection, player) in state.GameClients.Where(x => x.Value.DisconnectedAt is { } at && now - at > options.Value.ReconnectGracePeriod).ToList())
        {
            _logger.LogInformation("{Player} did not reconnect, forfeiting", player.Name);
            await engine.ForfeitAsync(player);
            state.GameClients.Remove(connection);
        }
    }

    /// <summary>Closes connections whose session was revoked (logout, ban, expiry).</summary>
    private async Task RevalidateSessionsAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var sessions = scope.ServiceProvider.GetRequiredService<SessionService>();
        foreach (var connection in registry.Snapshot())
        {
            if (connection.Principal is not null && await sessions.ValidateAsync(connection.Principal, ct) is null)
            {
                _logger.LogInformation("Session of {Connection} is no longer valid, disconnecting", connection);
                connection.Close("Session ended");
            }
        }
    }
}
