using Souls.Server.Network;

namespace Souls.Server.Objects;

public sealed record PlayerTypeInfo(int Id, int Attack, int Health, int Mana);

/// <summary>A connected player (or the practice bot) and its links to the game and chat connections.</summary>
public sealed class Player
{
    public required int Id { get; init; }
    public required string Name { get; set; }
    public int Rank { get; init; }
    public required PlayerTypeInfo PlayerType { get; init; }

    /// <summary>The cards the player owns; games draw random copies from these.</summary>
    public required IReadOnlyList<Card> OwningCards { get; init; }

    public bool IsBot { get; init; }
    public bool InQueue { get; set; }
    public GamePlayer? GPlayer { get; set; }
    public ChatPlayer? ChPlayer { get; set; }
    public Connection? GameContext { get; set; }
    public Connection? ChatContext { get; set; }

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
        Mana = PlayerType.Mana,
        Attack = PlayerType.Attack,
        Health = PlayerType.Health,
        Rank = Rank,
        IsPlayerOne = playerOne,
        Type = PlayerType.Id,
    };

    public void Send(Response response) => GameContext?.Send(response);
}
