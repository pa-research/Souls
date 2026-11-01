using Microsoft.Extensions.Options;
using Souls.Model;
using Souls.Model.Localization;
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

    /// <summary>How often the end of the current season is checked.</summary>
    public TimeSpan SeasonCheckInterval { get; set; } = TimeSpan.FromMinutes(1);
}

/// <summary>
/// Pairs queued players, starts practice games against the bot and the AI community's games on the server, cleans up
/// abandoned players and ends seasons. It also restores the running games saved by the previous instance when the
/// server starts, and saves them when it stops (see <see cref="GameStore"/>).
/// </summary>
public sealed class Matchmaker(
    ServerState state,
    GameEngine engine,
    GameService gameService,
    GameStore store,
    PlayerRepository players,
    ConnectionRegistry registry,
    IServiceScopeFactory scopes,
    TimeProvider time,
    IOptions<MatchmakerOptions> options,
    IOptions<AiOptions> aiOptions,
    IOptions<CommunityOptions> community,
    IOptions<SeasonOptions> seasonOptions,
    GameMetrics metrics,
    ILoggerFactory loggerFactory) : BackgroundService, IHostedLifecycleService
{
    /// <summary>Why a stopping server closes the connections (the clients reconnect).</summary>
    public const string RestartReason = "Server restarting";

    private readonly ILogger _logger = loggerFactory.CreateLogger<Matchmaker>();
    private readonly List<Task> _bots = [];
    private DateTimeOffset _lastRevalidation;
    private DateTimeOffset _lastSeasonCheck;

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
                metrics.Error("matchmaker");
            }
        }

        await Task.WhenAll(_bots);
    }

    /// <summary>Restores the games of the previous instance. Runs before the web host accepts connections.</summary>
    public async Task StartingAsync(CancellationToken cancellationToken)
    {
        var rooms = await store.LoadAsync(cancellationToken);
        await state.RunExclusiveAsync(() =>
        {
            foreach (var room in rooms)
            {
                engine.Resume(room);
            }

            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// The server is stopping (SIGTERM on a restart or redeploy), before the web host stops: saves every game for the
    /// next instance (and waits until everything is written) and closes all connections so the clients reconnect to
    /// it. Afterwards nothing changes the games.
    /// </summary>
    public Task StoppingAsync(CancellationToken cancellationToken) => state.RunExclusiveAsync(async () =>
    {
        state.ShuttingDown = true;
        store.Save(all: true);
        await store.FlushAsync();
        foreach (var connection in registry.Snapshot())
        {
            connection.Close(RestartReason);
        }

        _logger.LogInformation("Stopping: {Count} running games saved for the next start", state.Rooms.Count);
    });

    public Task StartedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

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
                bots.Add(await players.CreateBotAsync(Strings.BotName(name, difficulty), difficulty, ct));
            }
        }

        await state.RunExclusiveAsync(async () =>
        {
            if (state.ShuttingDown)
            {
                return;
            }

            RemoveDisconnected(state.NormalQueue);
            RemoveDisconnected(state.PracticeQueue);
            MatchNormal();
            MatchPractice(bots, ct);
            MatchPersonas(ct);
            SeatRestoredBots(ct);
            await ForfeitAbandonedAsync();
            await engine.CheckTurnTimersAsync();
            engine.ExpireChallenges();
            store.Save();
        });

        _bots.RemoveAll(t => t.IsCompleted);

        if (time.GetUtcNow() - _lastRevalidation >= options.Value.SessionRevalidationInterval)
        {
            _lastRevalidation = time.GetUtcNow();
            await RevalidateSessionsAsync(ct);
        }

        if (time.GetUtcNow() - _lastSeasonCheck >= options.Value.SeasonCheckInterval)
        {
            _lastSeasonCheck = time.GetUtcNow();
            await EndSeasonIfDueAsync(ct);
        }
    }

    private void RemoveDisconnected(LinkedList<Player> queue)
    {
        foreach (var player in queue.Where(p => p.GameContext?.IsOpen != true).ToList())
        {
            engine.RemoveFromQueues(player);
        }
    }

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
            metrics.QueueWaited("normal", now - first.QueuedAt);
            metrics.QueueWaited("normal", now - partner.QueuedAt);
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

            metrics.QueueWaited("practice", time.GetUtcNow() - human.QueuedAt);
            engine.RemoveFromQueues(human);
            SeatBot(bot, ct);
            engine.CreateGame(new Pair<Player>(human, bot), practice: true);
        }
    }

    /// <summary>
    /// The AI community on the server (see <see cref="AiCommunity"/>): a persona accepts a challenge after a moment, and a
    /// few games between online personas run here at human pace, for players to watch. One game starts a tick.
    /// </summary>
    private void MatchPersonas(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        foreach (var challenge in state.Challenges.Where(c => c.To.IsPersona && now - c.Sent >= community.Value.AnswerDelay).ToList())
        {
            SeatBot(challenge.To, ct);
            engine.AnswerChallenge(challenge.To, accept: true);
        }

        var live = state.Rooms.Values.Count(r => r.Players.First.IsPersona && r.Players.Second.IsPersona);
        var free = state.Personas.Values.Where(state.IsFree).ToList();
        if (live >= community.Value.LiveGames || free.Count < 2)
        {
            return;
        }

        var one = free[Random.Shared.Next(free.Count)];
        var two = free.Where(p => p != one).MinBy(p => Math.Abs(p.Rating - one.Rating))!;
        SeatBot(one, ct);
        SeatBot(two, ct);
        engine.CreateGame(new Pair<Player>(one, two));
    }

    /// <summary>Connects an AI to the bot player; it plays through an in-memory connection.</summary>
    private void SeatBot(Player bot, CancellationToken ct)
    {
        var connection = new BotConnection { Kind = ServiceKind.Game, LoggedIn = true };
        bot.GameContext = connection;
        bot.ChatContext = connection;
        // A restored bot keeps its place in the game's chat room.
        bot.ChPlayer ??= new ChatPlayer(bot.Name);
        bot.ChPlayer.ChatContext = connection;
        state.GameClients[connection] = bot;

        var logger = loggerFactory.CreateLogger<AiPlayer>();
        var ai = new AiPlayer(
            connection,
            message => state.RunExclusiveAsync(() => WebSocketEndpoints.ProcessAsync(gameService, connection, message, logger, metrics)),
            aiOptions.Value,
            bot.Difficulty,
            logger,
            engine,
            () => state.RunExclusiveAsync(() => bot.GPlayer?.GameRoom?.Copy()),
            bot.Skill);
        _bots.Add(Task.Run(() => ai.RunAsync(ct), ct));
    }

    /// <summary>A restored practice game has its bot but no AI yet: a new one reads the game and plays on.</summary>
    private void SeatRestoredBots(CancellationToken ct)
    {
        foreach (var bot in state.Rooms.Values.SelectMany(r => new[] { r.Players.First, r.Players.Second }).Where(p => p.IsBot && p.GameContext is null).ToList())
        {
            SeatBot(bot, ct);
            GameEngine.SendState(bot, bot.GPlayer!.GameRoom!);
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

    /// <summary>
    /// Season rollover happens only here, in the single game server, under the state lock so that no game result is
    /// stored while ratings reset. <see cref="Seasons.EndIfDueAsync"/> is transactional and runs at most once per season.
    /// </summary>
    private async Task EndSeasonIfDueAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        await state.RunExclusiveAsync(async () =>
        {
            if (await Seasons.EndIfDueAsync(db, time, seasonOptions.Value, ct) is { } season)
            {
                _logger.LogInformation("{Season} ended: standings stored, rewards paid, ratings reset", season.Name);
            }
        });
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
