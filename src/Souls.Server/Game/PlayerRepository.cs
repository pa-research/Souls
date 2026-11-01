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

    /// <summary>
    /// Loads a player with the cards they own, or <c>null</c> if the account does not exist. With a
    /// <paramref name="skill"/>, a persona of the community (a bot, see <see cref="Ai.AiCommunity"/>).
    /// </summary>
    public async Task<Objects.Player?> LoadPlayerAsync(int playerId, CancellationToken ct = default, double? skill = null)
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

        var owned = await db.PlayerCards.AsNoTracking()
            .Where(pc => pc.PlayerId == playerId)
            .Include(pc => pc.Card).ThenInclude(c => c!.Ability)
            .Include(pc => pc.Card).ThenInclude(c => c!.Race)
            .ToListAsync(ct);
        // Another class's cards never reach a game: a saved deck with one is invalid and the automatic deck is used.
        var cards = owned.Where(pc => pc.Card is not null && GameRules.CanUse(pc.Card.ClassId, player.PlayerTypeId))
            .Select(pc => Objects.Card.FromEntity(pc.Card!, pc.Level)).OrderBy(c => c.Id).ToList();
        var deck = await db.DeckCards.AsNoTracking().Where(d => d.PlayerId == playerId).ToListAsync(ct);

        return new Objects.Player
        {
            Id = player.Id,
            Name = player.Name,
            Rank = player.Rank,
            Rating = player.Rating,
            PlayerType = ToInfo(player.PlayerType),
            HeroPower = player.HeroPowerId,
            OwningCards = cards,
            Deck = Decks.Build(cards, c => c.Id, c => c.Rarity, deck.Select(d => (d.CardId, d.Count))),
            IsBot = skill is not null,
            Skill = skill,
        };
    }

    /// <summary>
    /// Creates the practice bot. It plays a deck of one or two races from every card its class can play, and one of its
    /// class's hero powers at random; on Hard its cards are upgraded.
    /// </summary>
    public async Task<Objects.Player> CreateBotAsync(string displayName, int difficulty = 1, CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();

        var (id, type) = await GetBotAccountAsync(db, ct);
        var level = difficulty >= 2 ? 2 : 1;
        var cards = (await db.Cards.AsNoTracking().Include(c => c.Ability).Include(c => c.Race)
                .Where(c => c.ClassId == null || c.ClassId == type.Id).OrderBy(c => c.Id).ToListAsync(ct))
            .Select(c => Objects.Card.FromEntity(c, level)).ToList();
        var powers = GameRules.PowersOf(type.Id);
        return new Objects.Player
        {
            Id = id,
            Name = displayName,
            Rank = 1,
            PlayerType = type,
            HeroPower = powers.Count == 0 ? null : powers[Random.Shared.Next(powers.Count)],
            OwningCards = cards,
            Deck = Decks.Themed(cards, c => c.Id, c => c.Rarity, c => c.RaceId, c => c.Cost, Random.Shared),
            IsBot = true,
            Difficulty = difficulty,
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

    private static PlayerTypeInfo ToInfo(PlayerType t) => new(t.Id, t.Attack, t.Health, t.Mana, t.Armor, t.RaceId);
}
