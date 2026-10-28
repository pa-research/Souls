using Souls.Server.Chat;
using Souls.Server.Game;
using Souls.Server.Objects;

namespace Souls.Tests.Unit;

public class GameRulesTests
{
    private static Card NewCard(int attack, int health) => new Card { Id = 1, Name = "Test", Attack = attack, Health = health }.NewInstance();

    private static Player NewPlayer(int id, params Card[] cards) => new()
    {
        Id = id,
        Name = "p" + id,
        PlayerType = new PlayerTypeInfo(1, Attack: 5, Health: 20, Mana: 1),
        OwningCards = cards,
    };

    [Fact]
    public void CardsDamageEachOtherAndDie()
    {
        var attacker = NewCard(attack: 3, health: 2);
        var defender = NewCard(attack: 2, health: 3);

        attacker.AttackCard(defender);

        Assert.Equal(0, attacker.Health);
        Assert.Equal(0, defender.Health);
        Assert.True(attacker.IsDead);
        Assert.True(defender.IsDead);
        Assert.True(attacker.HasAttacked);
    }

    [Fact]
    public void NewInstancesGetUniqueIds()
    {
        var definition = new Card { Id = 1, Name = "Test" };
        Assert.NotEqual(definition.NewInstance().Cid, definition.NewInstance().Cid);
    }

    [Fact]
    public void GameStartsWithThreeCardsAndPlayerOneToMove()
    {
        var p1 = NewPlayer(1, NewCard(1, 1));
        var p2 = NewPlayer(2, NewCard(1, 1));
        p1.ConstructGamePlayer(true);
        p2.ConstructGamePlayer(false);

        var room = new GameRoom(new Pair<Player>(p1, p2), TimeProvider.System);

        Assert.Equal(3, p1.GPlayer!.HandCards.Count);
        Assert.Equal(3, p2.GPlayer!.HandCards.Count);
        Assert.True(p1.GPlayer.IsPlayerTurn());
        Assert.False(p2.GPlayer.IsPlayerTurn());
        Assert.Equal(2, p1.GPlayer.Mana); // type mana + round 1
        Assert.Same(p2, p1.GetOpponent());

        room.NextTurn();
        Assert.True(p2.GPlayer.IsPlayerTurn());
        Assert.Equal(1, p2.GPlayer.Mana);

        room.NextTurn();
        Assert.True(p1.GPlayer.IsPlayerTurn());
        Assert.Equal(2, room.Round);
        Assert.Equal(2, p1.GPlayer.Mana);
    }

    [Fact]
    public void ManaIsCappedAtTen()
    {
        var p1 = NewPlayer(1, NewCard(1, 1));
        var p2 = NewPlayer(2, NewCard(1, 1));
        p1.ConstructGamePlayer(true);
        p2.ConstructGamePlayer(false);
        var room = new GameRoom(new Pair<Player>(p1, p2), TimeProvider.System);

        for (var i = 0; i < 40; i++)
        {
            room.NextTurn();
        }

        Assert.Equal(10, room.CurrentPlaying.GPlayer!.Mana);
    }

    [Fact]
    public void PlayersWithoutCardsDrawNothing() =>
        Assert.Empty(GameRoom.GetRandomCards(NewPlayer(1), 3));

    [Fact]
    public void OpponentHandOnlyRevealsInstanceIds()
    {
        var p1 = NewPlayer(1, NewCard(1, 1));
        var p2 = NewPlayer(2, NewCard(1, 1));
        p1.ConstructGamePlayer(true);
        p2.ConstructGamePlayer(false);
        var room = new GameRoom(new Pair<Player>(p1, p2), TimeProvider.System);

        var data = GameData.Get(room, playerOne: true);
        var opponentHand = data["opponent"]!["hand"]!.AsArray();

        Assert.Equal(3, opponentHand.Count);
        Assert.All(opponentHand, card => Assert.Single(card!.AsObject()));
        Assert.Equal("Test", (string?)data["player"]!["hand"]!.AsObject().First().Value!["name"]);
    }

    [Theory]
    [InlineData("  hello  ", "hello")]
    [InlineData("a\u0000b\u0007c", "abc")]
    [InlineData("<script>", "<script>")]
    public void ChatMessagesAreTrimmedAndStripped(string input, string expected) =>
        Assert.Equal(expected, ChatEngine.Sanitize(input));

    [Fact]
    public void ChatMessagesAreTruncated() =>
        Assert.Equal(ChatEngine.MaxMessageLength, ChatEngine.Sanitize(new string('x', 5000)).Length);
}
