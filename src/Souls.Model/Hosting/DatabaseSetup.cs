using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Souls.Model.Entities;
using Souls.Model.Security;

namespace Souls.Model.Hosting;

/// <summary>Applies migrations and creates the runtime seed rows (bot account, first season, optional bootstrap admin).</summary>
public static class DatabaseSetup
{
    public static async Task MigrateAndSeedAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var passwords = scope.ServiceProvider.GetRequiredService<PasswordService>();
        var time = scope.ServiceProvider.GetRequiredService<TimeProvider>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DatabaseSetup));

        if (db.Database.IsNpgsql())
        {
            // EF Core takes a database lock while migrating, so concurrent init containers are safe.
            await db.Database.MigrateAsync(ct);
        }
        else
        {
            await db.Database.EnsureCreatedAsync(ct);
        }

        logger.LogInformation("Database schema is up to date");

        // Create the shared Data Protection key up front, so the web app and the game server (which start
        // after this job) encrypt and decrypt the login cookie with the same key.
        var keyManager = scope.ServiceProvider.GetService<IKeyManager>();
        var now = time.GetUtcNow();
        if (keyManager is not null && !keyManager.GetAllKeys().Any(k => !k.IsRevoked && k.ActivationDate <= now && k.ExpirationDate > now.AddDays(7)))
        {
            keyManager.CreateNewKey(now, now.AddDays(90));
            logger.LogInformation("Created a Data Protection key");
        }

        if (!await db.Players.AnyAsync(p => p.IsSystem && p.NormalizedName == SeedData.BotPlayerName, ct))
        {
            db.Players.Add(new Player
            {
                Name = SeedData.BotPlayerName,
                NormalizedName = SeedData.BotPlayerName,
                Password = "!", // not a valid hash: the bot can never log in
                IsSystem = true,
                PlayerTypeId = 3,
                Rank = 5,
                Created = time.GetUtcNow(),
            });
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Created system account for the practice bot");
        }

        if (!await db.Seasons.AnyAsync(ct))
        {
            var length = scope.ServiceProvider.GetRequiredService<IOptions<SeasonOptions>>().Value.Length;
            db.Seasons.Add(new Season { Number = 1, Name = "Season 1", StartsAt = now, EndsAt = now + length });
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Started season 1, it ends {EndsAt}", now + length);
        }

        await EnsureAdminAsync(db, configuration, passwords, time, logger, ct);
    }

    private static async Task EnsureAdminAsync(SoulsDbContext db, IConfiguration configuration, PasswordService passwords, TimeProvider time, ILogger logger, CancellationToken ct)
    {
        var username = configuration["Souls:Admin:Username"]?.Trim();
        var password = configuration["Souls:Admin:Password"];
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            return;
        }

        if (PasswordService.ValidatePolicy(password) is { } problem)
        {
            throw new InvalidOperationException($"Souls:Admin:Password is not acceptable: {problem}");
        }

        var normalized = Player.Normalize(username);
        var admin = await db.Players.SingleOrDefaultAsync(p => p.NormalizedName == normalized, ct);
        if (admin is null)
        {
            admin = new Player
            {
                Name = username,
                NormalizedName = normalized,
                Password = passwords.Hash(password),
                PlayerTypeId = 1,
                Rank = 1,
                Created = time.GetUtcNow(),
                PlayerPermissionId = PlayerPermission.Admin,
            };
            db.Players.Add(admin);
            await db.SaveChangesAsync(ct);

            var starterCards = await db.Cards.Where(c => c.Level == 1).Select(c => c.Id).ToListAsync(ct);
            db.PlayerCards.AddRange(starterCards.Select(id => new PlayerCard { PlayerId = admin.Id, CardId = id, ObtainedAt = time.GetUtcNow() }));
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Created bootstrap administrator {Username}", username);
        }
        else if (!admin.IsAdmin && !admin.IsSystem)
        {
            admin.PlayerPermissionId = PlayerPermission.Admin;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Granted administrator permission to {Username}", username);
        }
    }
}
