using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Souls.Model;
using Souls.Model.Entities;

namespace Souls.Web.Models;

public sealed class LoginViewModel
{
    [Required(ErrorMessage = "Username is empty!")]
    [StringLength(32)]
    public string Name { get; set; } = string.Empty;

    [Required(ErrorMessage = "Password is empty!")]
    [StringLength(128)]
    [DataType(DataType.Password)]
    public string Password { get; set; } = string.Empty;

    public string? ReturnUrl { get; set; }
}

public sealed class RegisterViewModel
{
    public const string UsernamePattern = "^[A-Za-z0-9_-]{3,20}$";

    [Required(ErrorMessage = "You must input a username")]
    [RegularExpression(UsernamePattern, ErrorMessage = "Usernames are 3-20 letters, digits, '-' or '_'")]
    public string Username { get; set; } = string.Empty;

    [Required(ErrorMessage = "You must input a password")]
    [DataType(DataType.Password)]
    public string Password { get; set; } = string.Empty;

    [Required(ErrorMessage = "You must input a confirmation password")]
    [DataType(DataType.Password)]
    [Compare(nameof(Password), ErrorMessage = "Password does not match!")]
    public string ConfirmPassword { get; set; } = string.Empty;

    [Required(ErrorMessage = "You must select a class")]
    public int? PlayerType { get; set; }

    public List<int> Cards { get; set; } = [];
}

public sealed record RaceClasses(Race Race, IReadOnlyList<PlayerType> Types);

public sealed class RegisterPageModel
{
    public required RegisterViewModel Form { get; init; }
    public required IReadOnlyList<RaceClasses> Classes { get; init; }
    public required IReadOnlyList<CardTile> StarterCards { get; init; }
}

/// <summary>Display data for a card.</summary>
public sealed record CardTile(int Id, string Name, int Cost, int Attack, int Health, string? Ability, string? RaceTexture, string Portrait, int VendorPrice, bool Owned)
{
    public const string DefaultPortrait = "/Content/Images/Card/Portraits/0.png";

    public int Armor { get; init; }

    /// <summary>Upgrade level of the player's copy (1 if not owned).</summary>
    public int Level { get; init; } = 1;

    /// <summary>Coins to reach the next level, or <c>null</c> at the maximum level.</summary>
    public int? UpgradeCost { get; init; }

    /// <summary>Rules text: ability and race passive.</summary>
    public string? Description { get; init; }

    public static CardTile From(Card c, bool owned = false, int level = 1)
    {
        var bonus = GameRules.LevelBonus(level);
        var lines = new List<string>();
        if (c.AbilityId is { } ability && GameRules.AbilityTexts.TryGetValue(ability, out var abilityText))
        {
            lines.Add($"{abilityText.Name}: {abilityText.Text}");
        }

        if (c.RaceId is { } race && GameRules.RaceTexts.TryGetValue(race, out var raceText))
        {
            lines.Add($"{raceText.Name}. {raceText.Text}");
        }

        return new CardTile(c.Id, c.Name, c.Cost, c.Attack + bonus, c.Health + bonus, c.Ability?.Name, c.Race?.CardUrl, c.Portrait ?? DefaultPortrait, c.VendorPrice, owned)
        {
            Armor = c.Armor,
            Level = level,
            UpgradeCost = owned && level < GameRules.MaxCardLevel ? GameRules.UpgradeCost(c, level) : null,
            Description = string.Join(" ", lines),
        };
    }
}

public sealed class ShopViewModel
{
    public required IReadOnlyList<CardTile> Cards { get; init; }
    public required PlayerSummary Player { get; init; }
}

public sealed record PlayerSummary(string Name, int Money, int Rank, string Type, int Health, int BonusMana, string? Race)
{
    public int Rating { get; init; } = Ratings.Initial;
}

public sealed record QuestView(string Text, int Progress, int Target, int Reward, bool Done);

public sealed record LeaderboardEntry(int Position, string Name, int Rating, int Rank, string? Type);

public sealed class HomeViewModel
{
    public IReadOnlyList<QuestView>? Quests { get; init; }
    public required IReadOnlyList<LeaderboardEntry> TopPlayers { get; init; }
}

public sealed record DeckEntry(CardTile Card, int Count);

public sealed class DeckViewModel
{
    public required IReadOnlyList<DeckEntry> Entries { get; init; }
    public bool Custom { get; init; }
    public int DeckSize => GameRules.DeckSize;
    public int MaxCopies => GameRules.MaxCopiesInDeck;
}

public sealed record GameConfig(string WsBase, IReadOnlyList<CardPortrait> Cards)
{
    public RulesConfig? Rules { get; init; }

    /// <summary>Game id to spectate (3D client).</summary>
    public int? Watch { get; init; }

    /// <summary>Where the replay to play back is (3D client).</summary>
    public string? ReplayUrl { get; init; }
    public int? ReplayGameId { get; init; }
}

public sealed record RuleInfo(string Name, string Text);

public sealed record AbilityInfo(string Name, string Text, bool Activated, IReadOnlyList<string> Targets);

public sealed record HeroPowerInfo(string Name, string Text, int Cost, IReadOnlyList<string> Targets);

public sealed record HeroTypeInfo(string Name, int Attack, int Health, int Armor, int Mana, int? Race);

/// <summary>Rules text for tooltips; dictionary keys are ids.</summary>
public sealed record RulesConfig(
    IReadOnlyDictionary<string, AbilityInfo> Abilities,
    IReadOnlyDictionary<string, RuleInfo> Races,
    IReadOnlyDictionary<string, HeroPowerInfo> HeroPowers,
    IReadOnlyDictionary<string, HeroTypeInfo> HeroTypes,
    IReadOnlyDictionary<string, string> Keywords,
    int DeckSize,
    int MaxHandCards)
{
    public static RulesConfig Create(IEnumerable<PlayerType> heroTypes)
    {
        static string Key(int id) => id.ToString(CultureInfo.InvariantCulture);
        return new RulesConfig(
            GameRules.AbilityTexts.ToDictionary(x => Key(x.Key), x => new AbilityInfo(x.Value.Name, x.Value.Text, GameRules.IsActivated(x.Key), GameRules.AbilityTargets(x.Key))),
            GameRules.RaceTexts.ToDictionary(x => Key(x.Key), x => new RuleInfo(x.Value.Name, x.Value.Text)),
            GameRules.HeroPowers.ToDictionary(x => Key(x.Key), x => new HeroPowerInfo(x.Value.Name, x.Value.Text, GameRules.HeroPowerCost, GameRules.PowerTargets(x.Value.Target))),
            heroTypes.ToDictionary(t => Key(t.Id), t => new HeroTypeInfo(t.Name, t.Attack, t.Health, t.Armor, t.Mana, t.RaceId)),
            new Dictionary<string, string>
            {
                ["summoningSick"] = GameRules.Keywords.SummoningSick,
                ["paralyzed"] = GameRules.Keywords.Paralyzed,
                ["armor"] = GameRules.Keywords.Armor,
                ["fatigue"] = GameRules.Keywords.Fatigue,
                ["burned"] = GameRules.Keywords.Burned,
            },
            GameRules.DeckSize,
            10);
    }
}

public sealed record CardPortrait(int Id, string Portrait);

public sealed class GameStatsViewModel
{
    public required int GameId { get; init; }
    public required IReadOnlyList<Player> Players { get; init; }
    public Player? Winner { get; init; }
    public bool IsDraw { get; init; }
    public required IReadOnlyList<string> Log { get; init; }
    public bool IsPractice { get; init; }
    public int Turns { get; init; }
    public bool HasReplay { get; init; }

    /// <summary>Rating change of each player, in <see cref="Players"/> order.</summary>
    public IReadOnlyList<int> RatingChanges { get; init; } = [0, 0];
}

public sealed class AdminPlayersViewModel
{
    public required IReadOnlyList<Player> Players { get; init; }
    public required IReadOnlyList<PlayerPermission> Permissions { get; init; }
}

public sealed class CardEditorModel
{
    public int? Id { get; set; }

    [Required, StringLength(64)]
    public string Name { get; set; } = string.Empty;

    [Range(0, 10)]
    public int Cost { get; set; }

    [Range(0, 100)]
    public int Attack { get; set; }

    [Range(1, 100)]
    public int Health { get; set; } = 1;

    [Range(0, 100)]
    public int Armor { get; set; }

    [Range(1, 10)]
    public int Level { get; set; } = 1;

    [Range(0, 1_000_000)]
    public int VendorPrice { get; set; }

    public int? AbilityId { get; set; }

    [Required]
    public int? RaceId { get; set; }

    [StringLength(255)]
    public string? Portrait { get; set; }
}

public sealed class CardEditorViewModel
{
    public required CardEditorModel Card { get; init; }
    public required IReadOnlyList<Ability> Abilities { get; init; }
    public required IReadOnlyList<Race> Races { get; init; }
    public required IReadOnlyList<Card> Cards { get; init; }
}

public sealed class NewsEditorModel
{
    public int? Id { get; set; }

    [Required, StringLength(255)]
    public string Title { get; set; } = string.Empty;

    [Required, StringLength(20_000)]
    public string Text { get; set; } = string.Empty;
}

public sealed class NewsEditorViewModel
{
    public required NewsEditorModel Post { get; init; }
    public required IReadOnlyList<News> News { get; init; }
}
