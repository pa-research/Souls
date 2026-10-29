using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Security;
using Souls.Server.Game;

namespace Souls.Server.Network;

/// <summary>
/// The <c>/ws/admin</c> endpoint used by the admin players page. Only connections authenticated as an
/// administrator reach this service (enforced when the WebSocket is accepted).
/// </summary>
public sealed class AdminService(ServerState state, GameEngine engine, IServiceScopeFactory scopes, TimeProvider time, ILogger<AdminService> logger) : IClientService
{
    public async Task ProcessAsync(Connection connection, Message message)
    {
        if (connection.User is not { IsAdmin: true } admin)
        {
            connection.Close("Forbidden");
            return;
        }

        var request = (AdminRequest)message.Type;
        if (!connection.LoggedIn && request != AdminRequest.Login)
        {
            return;
        }

        switch (request)
        {
            case AdminRequest.Login:
                connection.LoggedIn = true;
                connection.Send(new Response(AdminRequest.Login, "ok"));
                break;

            case AdminRequest.OnlineUsers:
                var online = new JsonObject();
                var i = 0;
                foreach (var player in state.GameClients.Where(x => x.Key.LoggedIn && !x.Value.IsBot && x.Value.DisconnectedAt is null).Select(x => x.Value).Distinct())
                {
                    online[(i++).ToString(CultureInfo.InvariantCulture)] = player.Id;
                }

                connection.Send(new Response(AdminRequest.OnlineUsers, online));
                break;

            case AdminRequest.KickUser:
                await KickAsync(message.GetInt("pId"), "Kicked by an administrator");
                connection.Send(new Response(AdminRequest.KickUser, "ok"));
                break;

            case AdminRequest.BanUser:
                await BanAsync(admin, message);
                connection.Send(new Response(AdminRequest.BanUser, "ok"));
                break;

            case AdminRequest.Reset:
                await ResetAsync(message.GetInt("pId"));
                connection.Send(new Response(AdminRequest.Reset, "ok"));
                break;
        }
    }

    public Task OnDisconnectedAsync(Connection connection) => Task.CompletedTask;

    private async Task KickAsync(int playerId, string reason)
    {
        var player = state.FindPlayer(playerId);
        if (player is null)
        {
            return;
        }

        await engine.ForfeitAsync(player, GameLogKind.Kicked);
        engine.RemoveFromQueues(player);
        player.GameContext?.Close(reason);
        player.ChatContext?.Close(reason);
        logger.LogInformation("Kicked player {PlayerId}", playerId);
    }

    private async Task BanAsync(SessionPlayer admin, Message message)
    {
        var playerId = message.GetInt("pId");
        if (!DateTimeOffset.TryParse(message.GetString("until", 64), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var until) || until <= time.GetUtcNow())
        {
            throw new ProtocolException("'until' must be a future date");
        }

        if (playerId == admin.Id)
        {
            throw new ProtocolException("You cannot ban yourself");
        }

        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
            if (!await db.Players.AnyAsync(p => p.Id == playerId && !p.IsSystem))
            {
                return;
            }

            db.PlayerBans.Add(new PlayerBan { PlayerId = playerId, Until = until });
            await db.SaveChangesAsync();

            // Revoke the session so the web application logs the player out as well.
            await scope.ServiceProvider.GetRequiredService<SessionService>().EndAsync(playerId);
        }

        logger.LogInformation("Player {PlayerId} banned until {Until} by {Admin}", playerId, until, admin.Name);
        await KickAsync(playerId, "Banned");
    }

    /// <summary>Resets money and rank and replaces the player's cards with the starter cards.</summary>
    private async Task ResetAsync(int playerId)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var player = await db.Players.SingleOrDefaultAsync(p => p.Id == playerId && !p.IsSystem);
        if (player is null)
        {
            return;
        }

        player.Money = 0;
        player.Rank = 1;
        await db.PlayerCards.Where(pc => pc.PlayerId == playerId).ExecuteDeleteAsync();
        var starters = await db.Cards.Where(c => c.Level == 1).OrderBy(c => c.Id).Take(5).Select(c => c.Id).ToListAsync();
        db.PlayerCards.AddRange(starters.Select(id => new PlayerCard { PlayerId = playerId, CardId = id, ObtainedAt = time.GetUtcNow() }));
        await db.SaveChangesAsync();
        logger.LogInformation("Reset player {PlayerId}", playerId);
    }
}
