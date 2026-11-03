namespace Souls.Web.Services;

/// <summary>
/// With Discord configured: registers the linked roles and the <c>/souls</c> command once at start (with a bot token),
/// then keeps the players' linked roles up to date (every <c>Souls:Discord:SyncInterval</c>, default 10 minutes).
/// </summary>
public sealed class DiscordSync(IServiceScopeFactory scopes, DiscordActivity discord, IConfiguration configuration, ILogger<DiscordSync> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!discord.Enabled)
        {
            return;
        }

        await using (var scope = scopes.CreateAsyncScope())
        {
            var league = scope.ServiceProvider.GetRequiredService<DiscordLeague>();
            if (league.CanRegister)
            {
                try
                {
                    await league.RegisterAsync(stoppingToken);
                }
                catch (HttpRequestException e)
                {
                    logger.LogWarning(e, "Could not register the Discord linked roles and commands");
                }
            }
        }

        using var timer = new PeriodicTimer(configuration.GetValue("Souls:Discord:SyncInterval", TimeSpan.FromMinutes(10)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<DiscordLeague>().SyncAsync(stoppingToken);
        }
    }
}
