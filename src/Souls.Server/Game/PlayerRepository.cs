using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Objects;

namespace Souls.Server.Game;

/// <summary>Loads players and cards from the database.</summary>
public sealed class PlayerRepository(IServiceScopeFactory scopes)
{
    private readonly SemaphoreSlim _botLock = new(1, 1);
    private (int Id, PlayerTypeInfo Type)? _bot;

    /// <summary>Loads a player with the cards they own, or <c>null</c> if the account does not exist.</summary>
    public async Task<Objects.Player?> LoadPlayerAsync(int playerId, CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();

        var player = await db.Players.AsNoTracking()
            .Include(p => p.PlayerType)
            .SingleOrDefaultAsync(p => p.Id == playerId && !p.IsSystem, ct);
        if (player?.PlayerType is null)
        {
            return null;
        }

        var cards = await db.Cards.AsNoTracking()
            .Where(c => db.PlayerCards.Any(pc => pc.PlayerId == playerId && pc.CardId == c.Id))
            .Include(c => c.Ability)
            .Include(c => c.Race)
            .ToListAsync(ct);

        return new Objects.Player
        {
            Id = player.Id,
            Name = player.Name,
            Rank = player.Rank,
            PlayerType = ToInfo(player.PlayerType),
            OwningCards = [.. cards.Select(Objects.Card.FromEntity)],
        };
    }

    /// <summary>Creates the practice bot. It plays with every card in the game.</summary>
    public async Task<Objects.Player> CreateBotAsync(string displayName, CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();

        var (id, type) = await GetBotAccountAsync(db, ct);
        var cards = await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race).ToListAsync(ct);
        return new Objects.Player
        {
            Id = id,
            Name = displayName,
            Rank = 5,
            PlayerType = type,
            OwningCards = [.. cards.Select(Objects.Card.FromEntity)],
            IsBot = true,
        };
    }

    public async Task<IReadOnlyList<string>> GetBotNamesAsync(CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        return await db.BotNames.AsNoTracking().Select(b => b.Name).ToListAsync(ct);
    }

    private async Task<(int, PlayerTypeInfo)> GetBotAccountAsync(SoulsDbContext db, CancellationToken ct)
    {
        await _botLock.WaitAsync(ct);
        try
        {
            if (_bot is null)
            {
                var bot = await db.Players.AsNoTracking().Include(p => p.PlayerType)
                    .SingleOrDefaultAsync(p => p.IsSystem && p.NormalizedName == SeedData.BotPlayerName, ct)
                    ?? throw new InvalidOperationException("The bot account is missing. Run the 'migrate' command.");
                _bot = (bot.Id, ToInfo(bot.PlayerType!));
            }

            return _bot.Value;
        }
        finally
        {
            _botLock.Release();
        }
    }

    private static PlayerTypeInfo ToInfo(PlayerType t) => new(t.Id, t.Attack, t.Health, t.Mana);
}
