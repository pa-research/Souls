using Souls.Server.Game;
using Souls.Server.Network;

namespace Souls.Server.Objects;

public sealed record PlayerTypeInfo(int Id, int Attack, int Health, int Mana, int Armor = 0, int? RaceId = null);

/// <summary>A connected player (or the practice bot) and its links to the game and chat connections.</summary>
public sealed class Player
{
    public required int Id { get; init; }
    public required string Name { get; set; }
    public int Rank { get; init; }
    public int Rating { get; init; } = Model.Ratings.Initial;
    public required PlayerTypeInfo PlayerType { get; init; }

    /// <summary>The hero power the player picked; <c>null</c> (or another class's power) uses the class's default.</summary>
    public int? HeroPower { get; init; }

    /// <summary>The cards the player owns (with their upgrade level).</summary>
    public required IReadOnlyList<Card> OwningCards { get; init; }

    /// <summary>The player's deck (<see cref="Model.GameRules.DeckSize"/> cards), shuffled into each game.</summary>
    public required IReadOnlyList<Card> Deck { get; init; }

    public bool IsBot { get; init; }

    /// <summary>Bot strength: 0 easy, 1 normal, 2 hard.</summary>
    public int Difficulty { get; init; } = 1;

    /// <summary>The skill of a persona of the AI community (a bot, see <see cref="Ai.AiCommunity"/>); <c>null</c> for others.</summary>
    public double? Skill { get; init; }

    public bool IsPersona => Skill is not null;

    public bool InQueue { get; set; }
    public DateTimeOffset QueuedAt { get; set; }

    /// <summary>The difficulty a player asked for when queueing for a practice game.</summary>
    public int PracticeDifficulty { get; set; } = 1;
    public GamePlayer? GPlayer { get; set; }
    public ChatPlayer? ChPlayer { get; set; }
    public Connection? GameContext { get; set; }
    public Connection? ChatContext { get; set; }

    /// <summary>The game this player is watching, if any.</summary>
    public GameRoom? Spectating { get; set; }

    /// <summary>When the game connection dropped; the player may reconnect within the grace period.</summary>
    public DateTimeOffset? DisconnectedAt { get; set; }

    public Player? GetOpponent()
    {
        var players = GPlayer?.GameRoom?.Players;
        if (players is null)
        {
            return null;
        }

        return players.First == this ? players.Second : players.Second == this ? players.First : null;
    }

    public void ConstructGamePlayer(bool playerOne) => GPlayer = new GamePlayer
    {
        Name = Name,
        Mana = 0,
        BonusMana = PlayerType.Mana,
        Attack = PlayerType.Attack,
        Health = PlayerType.Health,
        MaxHealth = PlayerType.Health,
        Armor = PlayerType.Armor,
        Rank = Rank,
        Rating = Rating,
        IsPlayerOne = playerOne,
        Type = PlayerType.Id,
        Power = Model.GameRules.PowerOf(PlayerType.Id, HeroPower),
        RaceId = PlayerType.RaceId,
    };

    /// <summary>Sends to the player. Everything player one sees also goes (without secrets) to spectators and the replay.</summary>
    public void Send(Response response)
    {
        GameContext?.Send(response);
        if (GPlayer is { IsPlayerOne: true, GameRoom: { } room })
        {
            room.Mirror(response);
        }
    }
}
