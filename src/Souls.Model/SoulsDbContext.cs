using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Souls.Model.Entities;

namespace Souls.Model;

public class SoulsDbContext(DbContextOptions<SoulsDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<Ability> Abilities => Set<Ability>();
    public DbSet<BotName> BotNames => Set<BotName>();
    public DbSet<Card> Cards => Set<Card>();
    public DbSet<Game> Games => Set<Game>();
    public DbSet<GameLog> GameLogs => Set<GameLog>();
    public DbSet<GameLogType> GameLogTypes => Set<GameLogType>();
    public DbSet<News> News => Set<News>();
    public DbSet<Player> Players => Set<Player>();
    public DbSet<PlayerBan> PlayerBans => Set<PlayerBan>();
    public DbSet<PlayerCard> PlayerCards => Set<PlayerCard>();
    public DbSet<PlayerLogin> PlayerLogins => Set<PlayerLogin>();
    public DbSet<PlayerPermission> PlayerPermissions => Set<PlayerPermission>();
    public DbSet<PlayerType> PlayerTypes => Set<PlayerType>();
    public DbSet<Race> Races => Set<Race>();
    public DbSet<UploadedImage> UploadedImages => Set<UploadedImage>();
    public DbSet<DeckCard> DeckCards => Set<DeckCard>();
    public DbSet<PlayerQuest> PlayerQuests => Set<PlayerQuest>();
    public DbSet<GameReplay> GameReplays => Set<GameReplay>();

    /// <summary>ASP.NET Core Data Protection key ring, shared by the web and game server.</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Ability>(e =>
        {
            e.ToTable("ability");
            Key(e);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.Property(x => x.Parameter).HasColumnName("parameter").HasMaxLength(255);
            e.HasData(SeedData.Abilities);
        });

        modelBuilder.Entity<Race>(e =>
        {
            e.ToTable("race");
            Key(e);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.Property(x => x.CardUrl).HasColumnName("card_url").HasMaxLength(255);
            e.HasData(SeedData.Races);
        });

        modelBuilder.Entity<Card>(e =>
        {
            e.ToTable("card");
            Key(e);
            e.Property(x => x.AbilityId).HasColumnName("fk_ability");
            e.Property(x => x.RaceId).HasColumnName("fk_race");
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.Property(x => x.Attack).HasColumnName("attack");
            e.Property(x => x.Health).HasColumnName("health");
            e.Property(x => x.Armor).HasColumnName("armor");
            e.Property(x => x.Cost).HasColumnName("cost");
            e.Property(x => x.VendorPrice).HasColumnName("vendor_price");
            e.Property(x => x.Level).HasColumnName("level");
            e.Property(x => x.Portrait).HasColumnName("portrait").HasMaxLength(255);
            e.Property(x => x.AbilityValue).HasColumnName("ability_value");
            e.Property(x => x.Rarity).HasColumnName("rarity").HasDefaultValue(Rarity.Common);
            e.Property(x => x.Flavor).HasColumnName("flavor").HasMaxLength(500);
            e.HasOne(x => x.Ability).WithMany().HasForeignKey(x => x.AbilityId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Race).WithMany().HasForeignKey(x => x.RaceId).OnDelete(DeleteBehavior.SetNull);
            e.HasData(SeedData.Cards);
        });

        modelBuilder.Entity<PlayerType>(e =>
        {
            e.ToTable("player_type");
            Key(e);
            e.Property(x => x.AbilityId).HasColumnName("fk_ability");
            e.Property(x => x.RaceId).HasColumnName("fk_race");
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.Property(x => x.Attack).HasColumnName("attack");
            e.Property(x => x.Armor).HasColumnName("armor");
            e.Property(x => x.Health).HasColumnName("health");
            e.Property(x => x.Mana).HasColumnName("mana");
            e.HasOne(x => x.Ability).WithMany().HasForeignKey(x => x.AbilityId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Race).WithMany().HasForeignKey(x => x.RaceId).OnDelete(DeleteBehavior.SetNull);
            e.HasData(SeedData.PlayerTypes);
        });

        modelBuilder.Entity<PlayerPermission>(e =>
        {
            e.ToTable("player_permission");
            Key(e);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.HasData(SeedData.PlayerPermissions);
        });

        modelBuilder.Entity<Player>(e =>
        {
            e.ToTable("player");
            Key(e);
            e.Property(x => x.PlayerTypeId).HasColumnName("fk_type");
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(32);
            e.Property(x => x.NormalizedName).HasColumnName("normalized_name").HasMaxLength(32);
            e.Property(x => x.Password).HasColumnName("password").HasMaxLength(255);
            e.Property(x => x.Money).HasColumnName("money");
            e.Property(x => x.Rank).HasColumnName("rank");
            e.Property(x => x.Rating).HasColumnName("rating").HasDefaultValue(Ratings.Initial);
            e.Property(x => x.Created).HasColumnName("created");
            e.Property(x => x.PlayerPermissionId).HasColumnName("fk_permission");
            e.Property(x => x.IsSystem).HasColumnName("is_system");
            e.Ignore(x => x.IsAdmin);
            e.HasIndex(x => x.Name).IsUnique();
            e.HasIndex(x => x.NormalizedName).IsUnique();
            e.HasOne(x => x.PlayerType).WithMany().HasForeignKey(x => x.PlayerTypeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.PlayerPermission).WithMany().HasForeignKey(x => x.PlayerPermissionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PlayerCard>(e =>
        {
            e.ToTable("player_cards");
            Key(e);
            e.Property(x => x.PlayerId).HasColumnName("fk_player");
            e.Property(x => x.CardId).HasColumnName("fk_card");
            e.Property(x => x.ObtainedAt).HasColumnName("obtained_at");
            e.Property(x => x.Level).HasColumnName("level").HasDefaultValue(1);
            e.HasIndex(x => new { x.PlayerId, x.CardId }).IsUnique();
            e.HasOne(x => x.Player).WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Card).WithMany().HasForeignKey(x => x.CardId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PlayerBan>(e =>
        {
            e.ToTable("player_bans");
            Key(e);
            e.Property(x => x.PlayerId).HasColumnName("fk_player");
            e.Property(x => x.Until).HasColumnName("until");
            e.HasOne(x => x.Player).WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PlayerLogin>(e =>
        {
            e.ToTable("player_login");
            Key(e);
            e.Property(x => x.PlayerId).HasColumnName("fk_player");
            e.Property(x => x.TokenHash).HasColumnName("token_hash").HasMaxLength(64).IsFixedLength();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.ExpiresAt).HasColumnName("expires_at");
            e.HasIndex(x => x.PlayerId).IsUnique();
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasOne(x => x.Player).WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Game>(e =>
        {
            e.ToTable("game");
            Key(e);
            e.Property(x => x.Player1Id).HasColumnName("fk_player1");
            e.Property(x => x.Player2Id).HasColumnName("fk_player2");
            e.Property(x => x.Created).HasColumnName("created");
            e.Property(x => x.IsPractice).HasColumnName("is_practice");
            e.Property(x => x.WinnerId).HasColumnName("fk_winner");
            e.Property(x => x.Player1RatingChange).HasColumnName("player1_rating_change");
            e.Property(x => x.Player2RatingChange).HasColumnName("player2_rating_change");
            e.Property(x => x.Turns).HasColumnName("turns");
            e.HasIndex(x => x.Created);
            e.HasOne<Player>().WithMany().HasForeignKey(x => x.WinnerId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Player1).WithMany().HasForeignKey(x => x.Player1Id).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Player2).WithMany().HasForeignKey(x => x.Player2Id).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GameLogType>(e =>
        {
            e.ToTable("game_log_type");
            Key(e);
            e.Property(x => x.Title).HasColumnName("title").HasMaxLength(255);
            e.Property(x => x.Text).HasColumnName("text");
            e.Property(x => x.Description).HasColumnName("description").HasMaxLength(255);
            e.HasData(SeedData.GameLogTypes);
        });

        modelBuilder.Entity<GameLog>(e =>
        {
            e.ToTable("game_log");
            Key(e);
            e.Property(x => x.GameLogTypeId).HasColumnName("fk_log_type");
            e.Property(x => x.GameId).HasColumnName("fk_game");
            e.Property(x => x.Obj1Id).HasColumnName("obj1_id");
            e.Property(x => x.Obj2Id).HasColumnName("obj2_id");
            e.Property(x => x.Obj1Type).HasColumnName("obj1_type").HasMaxLength(16);
            e.Property(x => x.Obj2Type).HasColumnName("obj2_type").HasMaxLength(16);
            e.Property(x => x.Text).HasColumnName("text").HasMaxLength(500);
            e.HasOne(x => x.GameLogType).WithMany().HasForeignKey(x => x.GameLogTypeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Game).WithMany().HasForeignKey(x => x.GameId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<News>(e =>
        {
            e.ToTable("news");
            Key(e);
            e.Property(x => x.Title).HasColumnName("title").HasMaxLength(255);
            e.Property(x => x.Text).HasColumnName("text");
            e.Property(x => x.Author).HasColumnName("author").HasMaxLength(255);
            e.Property(x => x.Date).HasColumnName("date");
            e.Property(x => x.Enabled).HasColumnName("enabled");
        });

        modelBuilder.Entity<BotName>(e =>
        {
            e.ToTable("bot_names");
            Key(e);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
            e.HasData(SeedData.BotNames);
        });

        modelBuilder.Entity<UploadedImage>(e =>
        {
            e.ToTable("uploaded_image");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            e.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(32);
            e.Property(x => x.Data).HasColumnName("data");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UploadedById).HasColumnName("fk_uploaded_by");
            e.Ignore(x => x.Url);
            e.HasOne<Player>().WithMany().HasForeignKey(x => x.UploadedById).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DeckCard>(e =>
        {
            e.ToTable("deck_card");
            e.HasKey(x => new { x.PlayerId, x.CardId });
            e.Property(x => x.PlayerId).HasColumnName("fk_player");
            e.Property(x => x.CardId).HasColumnName("fk_card");
            e.Property(x => x.Count).HasColumnName("count");
            e.HasOne(x => x.Player).WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Card).WithMany().HasForeignKey(x => x.CardId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PlayerQuest>(e =>
        {
            e.ToTable("player_quest");
            Key(e);
            e.Property(x => x.PlayerId).HasColumnName("fk_player");
            e.Property(x => x.Kind).HasColumnName("kind");
            e.Property(x => x.Day).HasColumnName("day");
            e.Property(x => x.Progress).HasColumnName("progress");
            e.Property(x => x.CompletedAt).HasColumnName("completed_at");
            e.HasIndex(x => new { x.PlayerId, x.Day, x.Kind }).IsUnique();
            e.HasOne(x => x.Player).WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GameReplay>(e =>
        {
            e.ToTable("game_replay");
            e.HasKey(x => x.GameId);
            e.Property(x => x.GameId).HasColumnName("fk_game").ValueGeneratedNever();
            e.Property(x => x.Data).HasColumnName("data");
            e.HasOne(x => x.Game).WithOne().HasForeignKey<GameReplay>(x => x.GameId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DataProtectionKey>(e => e.ToTable("data_protection_keys"));
    }

    /// <summary>
    /// Maps the "id" primary key. Identity values start at 1000 so rows created at runtime never
    /// collide with the explicitly numbered seed rows.
    /// </summary>
    private static void Key<T>(EntityTypeBuilder<T> e) where T : class
    {
        e.HasKey("Id");
        e.Property<int>("Id").HasColumnName("id").UseIdentityByDefaultColumn().HasIdentityOptions(startValue: 1000);
    }
}
