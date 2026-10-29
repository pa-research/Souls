using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Souls.Model.Entities;

namespace Souls.Model.Security;

/// <summary>An authenticated, non-banned player with a live session.</summary>
public sealed record SessionPlayer(int Id, string Name, bool IsAdmin);

/// <summary>
/// Server-side login sessions. A random 256-bit token is placed in the (encrypted, HttpOnly) auth cookie and
/// its SHA-256 hash is stored in <c>player_login</c>. Deleting the row revokes the session for both the web
/// application and the game server. A player has at most one session, like the original application.
/// </summary>
public sealed class SessionService(SoulsDbContext db, TimeProvider time)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    public async Task<string> StartAsync(Player player, CancellationToken ct = default)
    {
        var token = Base64UrlToken(32);
        var now = time.GetUtcNow();

        var login = await db.PlayerLogins.SingleOrDefaultAsync(x => x.PlayerId == player.Id, ct);
        if (login is null)
        {
            login = new PlayerLogin { PlayerId = player.Id, TokenHash = HashToken(token) };
            db.PlayerLogins.Add(login);
        }

        login.TokenHash = HashToken(token);
        login.CreatedAt = now;
        login.ExpiresAt = now + Lifetime;
        await db.SaveChangesAsync(ct);
        return token;
    }

    public async Task<SessionPlayer?> ValidateAsync(ClaimsPrincipal? principal, CancellationToken ct = default)
    {
        var playerId = principal?.GetPlayerId();
        var token = principal?.FindFirstValue(SoulsClaims.SessionToken);
        if (playerId is null || string.IsNullOrEmpty(token))
        {
            return null;
        }

        var now = time.GetUtcNow();
        var hash = HashToken(token);
        var player = await db.PlayerLogins
            .Where(x => x.TokenHash == hash && x.PlayerId == playerId && x.ExpiresAt > now)
            .Select(x => x.Player!)
            .Where(p => !p.IsSystem)
            .Select(p => new SessionPlayer(p.Id, p.Name, p.PlayerPermissionId == PlayerPermission.Admin))
            .SingleOrDefaultAsync(ct);

        if (player is null || await IsBannedAsync(player.Id, ct))
        {
            return null;
        }

        return player;
    }

    public Task<bool> IsBannedAsync(int playerId, CancellationToken ct = default)
    {
        var now = time.GetUtcNow();
        return db.PlayerBans.AnyAsync(b => b.PlayerId == playerId && b.Until > now, ct);
    }

    public Task EndAsync(int playerId, CancellationToken ct = default) =>
        db.PlayerLogins.Where(x => x.PlayerId == playerId).ExecuteDeleteAsync(ct);

    public static string HashToken(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Base64UrlToken(int bytes) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
