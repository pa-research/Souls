using System.ComponentModel.DataAnnotations;
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

    public static CardTile From(Card c, bool owned = false) =>
        new(c.Id, c.Name, c.Cost, c.Attack, c.Health, c.Ability?.Name, c.Race?.CardUrl, c.Portrait ?? DefaultPortrait, c.VendorPrice, owned);
}

public sealed class ShopViewModel
{
    public required IReadOnlyList<CardTile> Cards { get; init; }
    public required PlayerSummary Player { get; init; }
}

public sealed record PlayerSummary(string Name, int Money, int Rank, string Type, int Health, int BonusMana, string? Race);

public sealed record GameConfig(string WsBase, IReadOnlyList<CardPortrait> Cards);

public sealed record CardPortrait(int Id, string Portrait);

public sealed class GameStatsViewModel
{
    public required int GameId { get; init; }
    public required IReadOnlyList<Player> Players { get; init; }
    public Player? Winner { get; init; }
    public bool IsDraw { get; init; }
    public required IReadOnlyList<string> Log { get; init; }
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
