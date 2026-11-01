using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Model.Localization;
using static Souls.Web.Services.Localized;

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
    public const string DefaultPortrait = "/Content/Images/Card/Portraits/0.jpg";

    public int Armor { get; init; }

    /// <summary>Upgrade level of the player's copy (1 if not owned).</summary>
    public int Level { get; init; } = 1;

    /// <summary>Coins to reach the next level, or <c>null</c> at the maximum level.</summary>
    public int? UpgradeCost { get; init; }

    /// <summary>Rules text: ability and race passive.</summary>
    public string? Description { get; init; }

    public int Rarity { get; init; } = Model.Rarity.Common;
    public string RarityName => T(Model.Rarity.Text(Rarity));
    public string RarityCss => Model.Rarity.Css(Rarity);
    public int MaxCopies => Model.Rarity.MaxCopies(Rarity);
    public string? RaceName { get; init; }
    public string? AbilityText { get; init; }
    public string? Flavor { get; init; }

    /// <summary>A spell: no attack or health; its level raises its value instead.</summary>
    public bool Spell { get; init; }

    /// <summary>The class that alone can play a class card (<see cref="Card.Class"/> must be loaded), else <c>null</c>.</summary>
    public string? ClassName { get; init; }

    /// <summary>A card in the language of the request (its name and class stay as they are).</summary>
    public static CardTile From(Card c, bool owned = false, int level = 1)
    {
        var spell = c.Kind == CardKind.Spell;
        var bonus = spell ? 0 : GameRules.LevelBonus(level);
        var value = spell && c.AbilityId is { } a ? GameRules.SpellValue(a, c.AbilityValue, level) : c.AbilityValue;
        var lines = new List<string>();
        var abilityText = c.AbilityId is { } ability && GameRules.Abilities.ContainsKey(ability) ? T(GameRules.AbilityRules(ability, value, c.RaceId)) : null;
        if (c.Class?.Name is { } className)
        {
            lines.Add(T(new GameText("card.classOnly", ("className", className))));
        }

        if (spell)
        {
            lines.Add(T(GameRules.Keywords.Spell));
        }

        if (c.AbilityId is { } id && !string.IsNullOrEmpty(abilityText))
        {
            lines.Add($"{T(GameRules.AbilityLabelText(id, value))}: {abilityText}");
        }

        if (c.RaceId is { } race && (!spell || GameRules.RaceWorksForSpells(race)) && GameRules.RaceTexts.TryGetValue(race, out var raceText))
        {
            lines.Add($"{T(raceText.Name)}. {T(raceText.Text)}");
        }

        return new CardTile(c.Id, c.Name, c.Cost, c.Attack + bonus, c.Health + bonus, c.AbilityId is { } l ? T(GameRules.AbilityLabelText(l, value)) : null,
            c.Race?.CardUrl, c.Portrait ?? DefaultPortrait, c.VendorPrice, owned)
        {
            Armor = c.Armor,
            Level = level,
            UpgradeCost = owned && level < GameRules.MaxCardLevel ? GameRules.UpgradeCost(c, level) : null,
            Description = string.Join(" ", lines),
            Rarity = c.Rarity,
            RaceName = c.RaceId is { } raceId ? T(GameRules.RaceName(raceId)) : c.Race?.Name,
            AbilityText = abilityText,
            Flavor = c.Flavor is null ? null : Strings.Has(Language, $"flavor.{c.Id}") ? Strings.Get(Language, $"flavor.{c.Id}") : c.Flavor,
            Spell = spell,
            ClassName = c.Class?.Name,
        };
    }
}

public sealed class ShopViewModel
{
    public required IReadOnlyList<CardTile> Cards { get; init; }
    public required PlayerSummary Player { get; init; }
}

/// <summary>A card from a pack: the player's copy after the pack, and the coins paid back for a duplicate at the highest level.</summary>
public sealed record PackCard(CardTile Card, int Coins);

public sealed record PlayerSummary(string Name, int Money, int Rank, string Type, int Health, int BonusMana, string? Race)
{
    public int Rating { get; init; } = Ratings.Initial;
}

public sealed record QuestView(string Text, int Progress, int Target, int Reward, bool Done);

public sealed record LeaderboardEntry(int Position, string Name, int Rating, int Rank, string? Type);

public sealed record HomeProfile(string Name, int Type, string TypeName, int Rating, int Rank, int Money, int Games, int Wins);

public sealed class HomeViewModel
{
    public HomeProfile? Profile { get; init; }
    public IReadOnlyList<QuestView>? Quests { get; init; }
    public required IReadOnlyList<LeaderboardEntry> TopPlayers { get; init; }

    /// <summary>The signed in player's current season.</summary>
    public SeasonProfile? Season { get; init; }

    /// <summary>The current season's ladder (see <see cref="LadderRung.Of"/>).</summary>
    public IReadOnlyList<LadderRung> Ladder { get; init; } = [];
}

/// <summary>A player's normal games and wins in the current season and their best final place in an earlier one.</summary>
public sealed record SeasonProfile(Season Season, int Games, int Wins, SeasonStanding? BestFinish);

public sealed record SeasonEntry(int Position, string Name, int Rating, int Rank, int Games, int Wins)
{
    /// <summary>The reward paid at the end of the season (past seasons only).</summary>
    public int? RewardCoins { get; init; }
    public string? RewardCard { get; init; }
}

/// <summary>A game on a player's profile, seen from their side. Result: "won", "lost" or "draw".</summary>
public sealed record ProfileGame(int GameId, DateTimeOffset? Date, bool IsPractice, string Opponent, int OpponentType, bool OpponentIsBot, string Result, int RatingChange, int Turns);

/// <summary>A player's final place in an ended season.</summary>
public sealed record ProfileSeason(Season Season, int Position, int Rank, int Rating);

public sealed class ProfileViewModel
{
    public required string Name { get; init; }
    public int Type { get; init; }
    public required string TypeName { get; init; }
    public int Rating { get; init; }
    public int Rank { get; init; }
    public DateTimeOffset? Created { get; init; }
    public int RankedGames { get; init; }
    public int RankedWins { get; init; }
    public int OtherGames { get; init; }

    /// <summary>The rating before each ranked game of the current season, oldest first, then the rating now.</summary>
    public required IReadOnlyList<int> RatingHistory { get; init; }
    public required IReadOnlyList<ProfileGame> Games { get; init; }
    public required IReadOnlyList<ProfileSeason> Seasons { get; init; }
    public bool IsMe { get; init; }
}

/// <summary>One rank of the season's ladder (16: Champion) and how many players stand on it.</summary>
public sealed record LadderRung(int Rank, int Players)
{
    /// <summary>The ladder from Champion down to Bronze III for the players' ranks (every rank above Champion is Champion).</summary>
    public static IReadOnlyList<LadderRung> Of(IReadOnlyCollection<int> ranks) =>
        [.. Enumerable.Range(1, Ratings.ChampionRank).Reverse().Select(rank => new LadderRung(rank, ranks.Count(r => Math.Min(r, Ratings.ChampionRank) == rank)))];
}

/// <summary>Where the signed-in player stands in the season: place (none before a ranked game), rating and rank.</summary>
public sealed record LadderMe(int? Position, int Rating, int Rank);

public sealed class SeasonViewModel
{
    public required Season Season { get; init; }
    public bool IsCurrent { get; init; }

    /// <summary>The ranks from Champion down to Bronze III with their players.</summary>
    public required IReadOnlyList<LadderRung> Ladder { get; init; }

    /// <summary>Players who played a ranked game in the season.</summary>
    public int Players { get; init; }
    public LadderMe? Me { get; init; }

    /// <summary>Every season, newest first.</summary>
    public required IReadOnlyList<Season> Seasons { get; init; }
    public required IReadOnlyList<SeasonEntry> Standings { get; init; }
}

public sealed record DeckEntry(CardTile Card, int Count);

/// <summary>One of the class's hero powers on the deck page.</summary>
public sealed record HeroPowerOption(int Id, GameRules.HeroPowerText Power, bool Selected);

public sealed class DeckViewModel
{
    public required IReadOnlyList<DeckEntry> Entries { get; init; }
    public bool Custom { get; init; }
    public required string ClassName { get; init; }
    public required IReadOnlyList<HeroPowerOption> HeroPowers { get; init; }
    public int HeroPowerCost => GameRules.HeroPowerCost;
    public int DeckSize => GameRules.DeckSize;
    public int MaxCopies => GameRules.MaxCopiesInDeck;
    public int MaxRare => Model.Rarity.MaxCopies(Model.Rarity.Rare);
    public int MaxEpic => Model.Rarity.MaxCopies(Model.Rarity.Epic);
    public int MaxLegendary => Model.Rarity.MaxCopies(Model.Rarity.Legendary);
}

public sealed record GameConfig(string WsBase, IReadOnlyList<CardPortrait> Cards)
{
    public RulesConfig? Rules { get; init; }

    /// <summary>Game id to spectate (3D client).</summary>
    public int? Watch { get; init; }

    /// <summary>Where the replay to play back is (3D client).</summary>
    public string? ReplayUrl { get; init; }
    public int? ReplayGameId { get; init; }

    /// <summary>The signed in player, for the game menu.</summary>
    public GameProfile? Profile { get; init; }

    /// <summary>The page's language and the string table the clients show their texts from (see <c>/js/l10n.js</c>).</summary>
    public string Lang { get; init; } = Model.Localization.Strings.Default;
    public IReadOnlyDictionary<string, string> Strings { get; init; } = Model.Localization.Strings.Table(Model.Localization.Strings.Default);

    /// <summary>The languages a player can switch to (code and name), for the clients' settings.</summary>
    public IReadOnlyList<LanguageOption> Languages { get; init; } = [];
}

public sealed record LanguageOption(string Code, string Name);

public sealed record GameProfile(string Name, int Type, string TypeName, int Rating, int Rank, string Tier, string TierCss, double RankProgress, int Money, IReadOnlyList<QuestView> Quests);

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
    /// <summary>The emotes players can send in a game, by id.</summary>
    public required IReadOnlyList<string> Emotes { get; init; }

    /// <summary>The rules in the language of the request.</summary>
    public static RulesConfig Create(IEnumerable<PlayerType> heroTypes)
    {
        static string Key(int id) => id.ToString(CultureInfo.InvariantCulture);
        return new RulesConfig(
            GameRules.AbilityTexts.ToDictionary(x => Key(x.Key), x => new AbilityInfo(T(x.Value.Name), T(x.Value.Text), GameRules.IsActivated(x.Key), GameRules.AbilityTargets(x.Key))),
            GameRules.RaceTexts.ToDictionary(x => Key(x.Key), x => new RuleInfo(T(x.Value.Name), T(x.Value.Text))),
            GameRules.HeroPowers.ToDictionary(x => Key(x.Key), x => new HeroPowerInfo(T(x.Value.Name), T(x.Value.Text), GameRules.HeroPowerCost, GameRules.PowerTargets(x.Value.Target))),
            heroTypes.ToDictionary(t => Key(t.Id), t => new HeroTypeInfo(t.Name, t.Attack, t.Health, t.Armor, t.Mana, t.RaceId)),
            new Dictionary<string, string>
            {
                ["summoningSick"] = T(GameRules.Keywords.SummoningSick),
                ["paralyzed"] = T(GameRules.Keywords.Paralyzed),
                ["armor"] = T(GameRules.Keywords.Armor),
                ["fatigue"] = T(GameRules.Keywords.Fatigue),
                ["burned"] = T(GameRules.Keywords.Burned),
                ["ward"] = T(GameRules.Keywords.Ward),
                ["spell"] = T(GameRules.Keywords.Spell),
            },
            GameRules.DeckSize,
            10)
        {
            Emotes = [.. GameRules.Emotes.Select(T)],
        };
    }
}

public sealed record CardPortrait(int Id, string Portrait);

/// <summary>A line of a finished game's history, and its key in the string tables (none for older games).</summary>
public sealed record StatsLine(string Text, string? Key);

public sealed class GameStatsViewModel
{
    public required int GameId { get; init; }
    public required IReadOnlyList<Player> Players { get; init; }
    public Player? Winner { get; init; }
    public bool IsDraw { get; init; }
    public required IReadOnlyList<StatsLine> Log { get; init; }
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

    /// <summary>Per player: cards owned and the sum of their levels (packs and upgrades raise it).</summary>
    public required IReadOnlyDictionary<int, (int Count, int Levels)> Cards { get; init; }
}

/// <summary>Games in which a card was played and how many of them its player won.</summary>
public sealed record WinRate(int Games, int Wins)
{
    public double? Rate => Games == 0 ? null : Wins / (double)Games;

    public string Percent => Rate is { } rate ? (rate * 100).ToString("0.0", CultureInfo.InvariantCulture) + "%" : "-";
}

/// <summary>A card's win rate in all games and per hero class (in the order of <see cref="CardStatisticsViewModel.Classes"/>).</summary>
public sealed record CardStatistics(Card Card, WinRate Total, IReadOnlyList<WinRate> ByClass);

public sealed class CardStatisticsViewModel
{
    /// <summary>Win rates from fewer games than this are marked as unreliable.</summary>
    public const int FewGames = 30;

    public required IReadOnlyList<PlayerType> Classes { get; init; }
    public required IReadOnlyList<CardStatistics> Cards { get; init; }
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

    /// <summary>At least 1 for a card; spells have none (saved as 0).</summary>
    [Range(0, 100)]
    public int Health { get; set; } = 1;

    public CardKind Kind { get; set; }

    [Range(0, 100)]
    public int Armor { get; set; }

    [Range(1, 10)]
    public int Level { get; set; } = 1;

    [Range(0, 1_000_000)]
    public int VendorPrice { get; set; }

    public int? AbilityId { get; set; }

    /// <summary>The ability's strength (Burn 3); empty for the ability's default.</summary>
    [Range(0, 20)]
    public int? AbilityValue { get; set; }

    [Range(Model.Rarity.Common, Model.Rarity.Legendary)]
    public int Rarity { get; set; } = Model.Rarity.Common;

    [StringLength(500)]
    public string? Flavor { get; set; }

    [Required]
    public int? RaceId { get; set; }

    /// <summary>A class card can only be owned and played by this class; empty for every class.</summary>
    public int? ClassId { get; set; }

    [StringLength(255)]
    public string? Portrait { get; set; }
}

public sealed class CardEditorViewModel
{
    public required CardEditorModel Card { get; init; }
    public required IReadOnlyList<Ability> Abilities { get; init; }
    public required IReadOnlyList<Race> Races { get; init; }
    public required IReadOnlyList<PlayerType> Classes { get; init; }
    public required IReadOnlyList<Card> Cards { get; init; }
}

public sealed class SeasonEditorModel
{
    public int Number { get; set; }

    [Required, StringLength(64)]
    public string Name { get; set; } = string.Empty;

    /// <summary>The end of the season in UTC.</summary>
    public DateTime EndsAt { get; set; }
}

public sealed class AdminSeasonViewModel
{
    public required Season Current { get; init; }
    public required SeasonEditorModel Form { get; init; }
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
