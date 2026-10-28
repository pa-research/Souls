using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Ability = Souls.Model.Entities.Ability;
using GameLogKind = Souls.Model.Entities.GameLogKind;
using Souls.Server.Chat;
using Souls.Server.Network;
using Souls.Server.Objects;
using Souls.Server.Objects.Abilities;

namespace Souls.Server.Game;

/// <summary>
/// The game rules. Ported from the original GameEngine; all methods must be called while holding the
/// <see cref="ServerState"/> lock.
/// </summary>
public sealed class GameEngine(ServerState state, ChatEngine chat, IServiceScopeFactory scopes, TimeProvider time, ILogger<GameEngine> logger)
{
    /// <summary>Starts a game between two players.</summary>
    public void CreateGame(Pair<Player> players)
    {
        players.First.ConstructGamePlayer(true);
        players.Second.ConstructGamePlayer(false);

        var room = new GameRoom(players, time);
        state.Rooms[room.GameId] = room;

        var response = room.GenerateGameUpdate(create: true);
        players.First.Send(response.First);
        players.Second.Send(response.Second);

        room.Logger.Add(GameLogKind.GameCreated, players.First.Id, players.Second.Id, "Player", "Player");
        logger.LogInformation("Game {GameId} started: {Player1} vs {Player2}", room.GameId, players.First.Name, players.Second.Name);
    }

    public void RequestQueue(Player player, bool normal)
    {
        if (player.GPlayer?.GameRoom is { } room)
        {
            // Reconnected while in a game: send the current state.
            var response = room.GenerateGameUpdate();
            player.Send(player.GPlayer.IsPlayerOne ? response.First : response.Second);
            return;
        }

        if (player.InQueue)
        {
            player.Send(new Response(GameResponse.QueueAlreadyIn, "You are already in queue!"));
            return;
        }

        player.InQueue = true;
        (normal ? state.NormalQueue : state.PracticeQueue).AddLast(player);
        player.Send(new Response(GameResponse.QueueOk, "You are now in queue!"));
        logger.LogDebug("{Player} queued ({Mode})", player.Name, normal ? "normal" : "practice");
    }

    public void RemoveFromQueues(Player player)
    {
        player.InQueue = false;
        state.NormalQueue.Remove(player);
        state.PracticeQueue.Remove(player);
    }

    /// <summary>Relays the position of a dragged card to the opponent.</summary>
    public void RequestMoveCard(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out var opponent))
        {
            return;
        }

        var cid = message.GetInt("cid");
        if (!gp.HandCards.ContainsKey(cid))
        {
            return;
        }

        opponent.Send(new Response(GameResponse.GameOpponentMove, new JsonObject
        {
            ["cid"] = cid,
            ["x"] = message.GetDouble("x"),
            ["y"] = message.GetDouble("y"),
        }));
    }

    /// <summary>A dragged card was released: return it to its hand position on both clients.</summary>
    public void RequestReleaseCard(Player player, Message message)
    {
        if (!TryGetGame(player, out _, out var opponent))
        {
            return;
        }

        var cid = message.GetInt("cid");
        player.Send(new Response(GameResponse.GameRelease, new JsonObject { ["cid"] = cid }));
        opponent.Send(new Response(GameResponse.GameOpponentRelease, new JsonObject { ["cid"] = cid }));
    }

    public void RequestUseCard(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out var opponent))
        {
            return;
        }

        var slot = message.GetInt("slotId");
        var cid = message.GetInt("cid");

        if (!gp.HandCards.TryGetValue(cid, out var card))
        {
            return;
        }

        if (!gp.IsPlayerTurn())
        {
            player.Send(new Response(GameResponse.GameNotYourTurn, new JsonObject { ["card"] = cid, ["error"] = "Not your turn!" }));
            RequestReleaseCard(player, message);
            return;
        }

        if (slot is < 0 or >= GamePlayer.BoardSlots || gp.BoardCards.ContainsKey(slot))
        {
            RequestReleaseCard(player, message);
            player.Send(new Response(GameResponse.GameUseCardOccupied, new JsonObject { ["slot"] = slot, ["message"] = "Slot is already occupied!" }));
            return;
        }

        if (!gp.HasEnoughMana(card))
        {
            player.Send(new Response(GameResponse.GameUseCardOom, "Not enough mana!"));
            RequestReleaseCard(player, message);
            return;
        }

        gp.HandCards.Remove(cid);
        gp.BoardCards[slot] = card;
        gp.Mana -= card.Cost;
        card.SlotId = slot;

        JsonObject Payload() => new() { ["card"] = card.ToJson(), ["pInfo"] = gp.GetPlayerData() };
        player.Send(new Response(GameResponse.GameUseCardOk, Payload()));
        opponent.Send(new Response(GameResponse.GameOpponentUseCardOk, Payload()));

        gp.GameRoom!.Logger.Add(GameLogKind.UseCard, player.Id, card.Id, "Player", "Card");
    }

    public void RequestNextTurn(Player player)
    {
        if (!TryGetGame(player, out var gp, out var opponent) || !gp.IsPlayerTurn())
        {
            return;
        }

        var room = gp.GameRoom!;
        room.Logger.Add(GameLogKind.NextTurn, player.Id, opponent.Id, "Player", "Player");
        room.NextTurn();

        // The player whose turn starts draws a card.
        RequestNewCard(opponent);

        player.Send(new Response(GameResponse.GameNextTurn, new JsonObject
        {
            ["yourTurn"] = false,
            ["playerInfo"] = gp.GetPlayerData(),
            ["opponentInfo"] = opponent.GPlayer!.GetPlayerData(),
        }));
        opponent.Send(new Response(GameResponse.GameNextTurn, new JsonObject
        {
            ["yourTurn"] = true,
            ["playerInfo"] = opponent.GPlayer.GetPlayerData(),
            ["opponentInfo"] = gp.GetPlayerData(),
        }));
    }

    /// <summary>Deals a new card to the player (max 10 in hand). The opponent only learns its cid.</summary>
    public void RequestNewCard(Player player, int amount = 1)
    {
        var gp = player.GPlayer;
        if (gp?.GameRoom is null || gp.HandCards.Count >= GamePlayer.MaxHandCards)
        {
            return;
        }

        var cards = GameRoom.GetRandomCards(player, amount);
        if (cards.Count == 0)
        {
            return;
        }

        gp.GameRoom.Logger.Add(GameLogKind.NewCard, player.Id, cards[0].Id, "Player", "Card");
        gp.AddCardsToHand(cards);

        player.Send(new Response(GameResponse.GameNewCard, new JsonObject
        {
            ["card"] = new JsonArray([.. cards.Select(c => (JsonNode)c.ToJson())]),
        }));
        player.GetOpponent()?.Send(new Response(GameResponse.GameOpponentNewCard, new JsonObject
        {
            ["card"] = new JsonArray([.. cards.Select(c => (JsonNode)new JsonObject { ["cid"] = c.Cid })]),
        }));
    }

    public async Task RequestAttackAsync(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out var opponentPlayer))
        {
            return;
        }

        var source = message.GetInt("source");
        var target = message.GetInt("target");
        var type = message.GetInt("type");
        var opponent = opponentPlayer.GPlayer!;
        var room = gp.GameRoom!;

        if (!gp.IsPlayerTurn())
        {
            player.Send(new Response(GameResponse.GameNotYourTurn, new JsonObject { ["error"] = "Not your turn!" }));
            return;
        }

        JsonObject attackerJson;
        JsonObject defenderJson;
        switch (type)
        {
            case 0: // Card on card
            {
                var sourceCard = gp.FindBoardCard(source);
                var targetCard = opponent.FindBoardCard(target);
                if (sourceCard is null || targetCard is null)
                {
                    return;
                }

                if (sourceCard.HasAttacked)
                {
                    CannotAttackTwice(player);
                    return;
                }

                sourceCard.AttackCard(targetCard);
                if (sourceCard.IsDead)
                {
                    gp.RemoveBoardCard(sourceCard);
                }

                if (targetCard.IsDead)
                {
                    opponent.RemoveBoardCard(targetCard);
                }

                attackerJson = CardResult(sourceCard, damageTaken: targetCard.Attack, damageDone: sourceCard.Attack, attacker: true);
                defenderJson = CardResult(targetCard, damageTaken: sourceCard.Attack, damageDone: targetCard.Attack, attacker: false);
                room.Logger.Add(GameLogKind.CardAttackCard, sourceCard.Id, targetCard.Id, "Card", "Card");
                break;
            }

            case 1: // Card on opponent hero
            {
                var sourceCard = gp.FindBoardCard(source);
                if (sourceCard is null)
                {
                    return;
                }

                if (sourceCard.HasAttacked)
                {
                    CannotAttackTwice(player);
                    return;
                }

                sourceCard.AttackHero(opponent);
                if (sourceCard.IsDead)
                {
                    gp.RemoveBoardCard(sourceCard);
                }

                attackerJson = CardResult(sourceCard, damageTaken: opponent.Attack, damageDone: sourceCard.Attack, attacker: true);
                defenderJson = HeroResult(opponent, damageTaken: sourceCard.Attack, damageDone: opponent.Attack, attacker: false);
                room.Logger.Add(GameLogKind.CardAttackPlayer, sourceCard.Id, opponentPlayer.Id, "Card", "Player");
                break;
            }

            case 2: // Hero on card
            {
                var targetCard = opponent.FindBoardCard(target);
                if (targetCard is null)
                {
                    return;
                }

                if (gp.HasAttacked)
                {
                    CannotAttackTwice(player);
                    return;
                }

                gp.AttackCard(targetCard);
                if (targetCard.IsDead)
                {
                    opponent.RemoveBoardCard(targetCard);
                }

                attackerJson = HeroResult(gp, damageTaken: targetCard.Attack, damageDone: gp.Attack, attacker: true);
                defenderJson = CardResult(targetCard, damageTaken: gp.Attack, damageDone: targetCard.Attack, attacker: false);
                room.Logger.Add(GameLogKind.PlayerAttackCard, player.Id, targetCard.Id, "Player", "Card");
                break;
            }

            case 3: // Hero on hero
            {
                if (gp.HasAttacked)
                {
                    CannotAttackTwice(player);
                    return;
                }

                gp.AttackHero(opponent);
                attackerJson = HeroResult(gp, damageTaken: opponent.Attack, damageDone: gp.Attack, attacker: true);
                defenderJson = HeroResult(opponent, damageTaken: gp.Attack, damageDone: opponent.Attack, attacker: false);
                room.Logger.Add(GameLogKind.PlayerAttackPlayer, player.Id, opponentPlayer.Id, "Player", "Player");
                break;
            }

            default:
                throw new ProtocolException("Unknown attack type");
        }

        player.Send(new Response(GameResponse.GameAttack, new JsonObject
        {
            ["player"] = attackerJson.DeepClone(),
            ["opponent"] = defenderJson.DeepClone(),
            ["type"] = type,
        }));
        opponentPlayer.Send(new Response(GameResponse.GameAttack, new JsonObject
        {
            ["player"] = defenderJson,
            ["opponent"] = attackerJson,
            ["type"] = type,
        }));

        if (gp.IsDead || opponent.IsDead)
        {
            var isDraw = gp.IsDead && opponent.IsDead;
            room.Winner = gp.IsDead ? opponentPlayer : player;
            await EndGameAsync(room, isDraw);
        }
    }

    public void RequestUseAbility(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out _))
        {
            return;
        }

        if (!gp.IsPlayerTurn())
        {
            player.Send(new Response(GameResponse.GameNotYourTurn, new JsonObject { ["error"] = "Not your turn!" }));
            return;
        }

        // Target type: 0 = friendly card, 1 = own hero, 2 = opponent.
        var source = message.GetInt("source");
        var target = message.GetInt("target");
        var type = message.GetInt("type");

        var card = gp.FindBoardCard(source);
        if (card is null)
        {
            return;
        }

        if (card.HasAttacked)
        {
            CannotAttackTwice(player);
            return;
        }

        // The ability comes from the card definition, never from the client.
        switch (card.AbilityId, type)
        {
            case (Ability.Heal, 0):
                if (gp.FindBoardCard(target) is { } healTarget)
                {
                    AbilityEffects.Heal(player, card, healTarget);
                }
                else
                {
                    player.Send(new Response(GameResponse.GameGeneralMessage, "Cannot heal opponent!"));
                }

                break;
            case (Ability.Heal, 1):
                AbilityEffects.Heal(player, card, player);
                break;
            case (Ability.Heal, _):
                player.Send(new Response(GameResponse.GameGeneralMessage, "Cannot heal opponent!"));
                break;

            case (Ability.Sacrifice, 0):
                var sacrificeTarget = gp.FindBoardCard(target);
                if (sacrificeTarget is null)
                {
                    player.Send(new Response(GameResponse.GameGeneralMessage, "Can only target friendly!"));
                }
                else if (sacrificeTarget == card)
                {
                    player.Send(new Response(GameResponse.GameGeneralMessage, "Cannot cast on itself!"));
                }
                else
                {
                    AbilityEffects.Sacrifice(player, card, sacrificeTarget);
                }

                break;
            case (Ability.Sacrifice, 1):
                AbilityEffects.Sacrifice(player, card, player);
                break;
            case (Ability.Sacrifice, _):
                player.Send(new Response(GameResponse.GameGeneralMessage, "Can only target friendly!"));
                break;

            default:
                player.Send(new Response(GameResponse.GameGeneralMessage, "This card has no ability!"));
                break;
        }
    }

    /// <summary>
    /// Ends a game: stores it with its log, awards the winner, notifies both players and removes them from the
    /// server (clients navigate to the statistics page and reconnect for the next game).
    /// </summary>
    public async Task EndGameAsync(GameRoom room, bool isDraw)
    {
        if (room.IsEnded)
        {
            return;
        }

        room.IsEnded = true;
        state.Rooms.Remove(room.GameId);

        var player = room.Players.First;
        var opponent = room.Players.Second;
        var winner = room.Winner ?? opponent;
        var loser = winner == player ? opponent : player;
        room.Logger.Add(isDraw ? GameLogKind.Draw : GameLogKind.Won, winner.Id, loser.Id, "Player", "Player");

        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
            var game = new Model.Entities.Game { Player1Id = player.Id, Player2Id = opponent.Id, Created = room.StartedAt };
            db.Games.Add(game);
            room.Logger.AddTo(db, game);
            await db.SaveChangesAsync();
            room.GameId = game.Id;

            if (!isDraw && !winner.IsBot)
            {
                await db.Players.Where(p => p.Id == winner.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.Money, p => p.Money + 1));
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Failed to store game {GameId}", room.GameId);
            room.GameId = 0;
        }

        Response Result(Player p) => new(
            isDraw ? GameResponse.GameDraw : winner == p ? GameResponse.GameVictory : GameResponse.GameDefeat,
            new JsonObject { ["statistics"] = room.GameId });

        player.Send(Result(player));
        opponent.Send(Result(opponent));

        foreach (var p in new[] { player, opponent })
        {
            if (p.IsBot)
            {
                p.Send(new Response(GameResponse.GameBotDisconnect, "Bot disconnect"));
                p.GameContext?.Close("Game over");
            }

            if (p.ChPlayer is { } chPlayer)
            {
                foreach (var chatRoom in chPlayer.MemberRooms.Keys.ToList())
                {
                    chat.RemoveRoom(chatRoom);
                }

                chPlayer.MemberRooms.Clear();
            }

            if (p.ChatContext is not null)
            {
                state.ChatClients.Remove(p.ChatContext);
            }

            if (p.GameContext is not null)
            {
                state.GameClients.Remove(p.GameContext);
            }

            p.ChPlayer = null;
            p.GPlayer = null;
        }

        logger.LogInformation("Game {GameId} ended: {Result}", room.GameId, isDraw ? "draw" : $"{winner.Name} won");
    }

    /// <summary>Ends the game of a player who left, the opponent wins.</summary>
    public async Task ForfeitAsync(Player player, GameLogKind? reason = null)
    {
        if (player.GPlayer?.GameRoom is not { IsEnded: false } room)
        {
            return;
        }

        if (reason is { } kind)
        {
            room.Logger.Add(kind, player.Id, player.Id, "Player", "Player");
        }

        room.Winner = player.GetOpponent();
        await EndGameAsync(room, isDraw: false);
    }

    private static void CannotAttackTwice(Player p) =>
        p.Send(new Response(GameResponse.GameGeneralMessage, "Cannot do that yet!"));

    private static bool TryGetGame(Player player, out GamePlayer gamePlayer, out Player opponent)
    {
        gamePlayer = player.GPlayer!;
        opponent = player.GetOpponent()!;
        return player.GPlayer?.GameRoom is { IsEnded: false } && opponent?.GPlayer is not null;
    }

    private static JsonObject CardResult(Card card, int damageTaken, int damageDone, bool attacker) => new()
    {
        ["cid"] = card.Cid,
        ["dmgTaken"] = damageTaken,
        ["dmgDone"] = damageDone,
        ["health"] = card.Health,
        ["attacker"] = attacker,
        ["isDead"] = card.IsDead,
    };

    private static JsonObject HeroResult(GamePlayer hero, int damageTaken, int damageDone, bool attacker) => new()
    {
        ["dmgTaken"] = damageTaken,
        ["dmgDone"] = damageDone,
        ["health"] = hero.Health,
        ["attacker"] = attacker,
        ["isDead"] = hero.IsDead,
    };
}
