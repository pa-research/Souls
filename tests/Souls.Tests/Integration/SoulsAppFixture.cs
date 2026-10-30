using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Souls.Model;
using Souls.Model.Hosting;
using Souls.Server;
using Souls.Web;
using Testcontainers.PostgreSql;

namespace Souls.Tests.Integration;

/// <summary>
/// Runs PostgreSQL in a container and hosts both the web application and the game server against it, the way
/// they run in production (shared database and Data Protection key ring). Requires Docker.
/// </summary>
public sealed class SoulsAppFixture : IAsyncLifetime
{
    public const string AdminName = "admin";
    public const string AdminPassword = "Adm1n-Passw0rd!";

    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:18-alpine").Build();
    private Dictionary<string, string?> _settings = [];

    public WebApplicationFactory<WebAssemblyMarker> Web { get; private set; } = null!;
    public WebApplicationFactory<ServerAssemblyMarker> Server { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        await _database.StartAsync();

        var settings = _settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Souls"] = _database.GetConnectionString(),
            ["Souls:SecureCookies"] = "false",
            ["Souls:Admin:Username"] = AdminName,
            ["Souls:Admin:Password"] = AdminPassword,
            ["Souls:Bot:ThinkDelay"] = "00:00:00",
            ["Souls:Bot:AttackDelay"] = "00:00:00",
            ["Souls:Matchmaker:Interval"] = "00:00:00.100",
            ["Souls:GameServerHealthUrl"] = string.Empty,
            ["Souls:RateLimits:AuthPerMinute"] = "1000",
        };

        Web = new WebApplicationFactory<WebAssemblyMarker>().WithWebHostBuilder(b => Configure(b, settings));
        Server = new WebApplicationFactory<ServerAssemblyMarker>().WithWebHostBuilder(b => Configure(b, settings));

        await DatabaseSetup.MigrateAndSeedAsync(Web.Services);
        _ = Server.Server;
    }

    public async ValueTask DisposeAsync()
    {
        await Web.DisposeAsync();
        await Server.DisposeAsync();
        await _database.DisposeAsync();
    }

    /// <summary>Stops the game server (as on SIGTERM) and starts a new one on the same database, like a redeploy.</summary>
    public async Task RestartServerAsync()
    {
        await Server.DisposeAsync();
        Server = new WebApplicationFactory<ServerAssemblyMarker>().WithWebHostBuilder(b => Configure(b, _settings));
        _ = Server.Server;
    }

    public TestBrowser CreateBrowser() => new(Web.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false }));

    public async Task<T> WithDbAsync<T>(Func<SoulsDbContext, Task<T>> action)
    {
        await using var scope = Web.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<SoulsDbContext>());
    }

    private static void Configure(IWebHostBuilder builder, Dictionary<string, string?> settings)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings));
    }
}

[CollectionDefinition(Name)]
public sealed class SoulsCollection : ICollectionFixture<SoulsAppFixture>
{
    public const string Name = "Souls application";
}
