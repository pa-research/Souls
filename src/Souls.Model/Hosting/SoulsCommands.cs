using Microsoft.Extensions.Hosting;

namespace Souls.Model.Hosting;

/// <summary>
/// Container entry point commands shared by both applications:
/// <list type="bullet">
/// <item><c>migrate</c> – apply database migrations and seed data, then exit (used by the init container / compose job).</item>
/// <item><c>healthcheck</c> – probe <c>/healthz/live</c> on the local port (distroless images have no curl).</item>
/// </list>
/// </summary>
public static class SoulsCommands
{
    public static bool IsMigrate(string[] args) => args.Length > 0 && args[0] == "migrate";

    /// <summary>Removes the command verb so the rest can be passed to the configuration system.</summary>
    public static string[] HostArgs(string[] args) => args.Length > 0 && args[0] is "migrate" or "healthcheck" ? args[1..] : args;

    public static async Task<int?> TryRunHealthCheckAsync(string[] args)
    {
        if (args.Length == 0 || args[0] != "healthcheck")
        {
            return null;
        }

        var port = (Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS") ?? "8080").Split([';', ','])[0];
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        try
        {
            using var response = await client.GetAsync(new Uri($"http://127.0.0.1:{port}/healthz/live"));
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return 1;
        }
    }

    public static async Task RunMigrationsAsync(IHost host)
    {
        await DatabaseSetup.MigrateAndSeedAsync(host.Services);
    }
}
