using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Souls.Model;
using GameLogKind = Souls.Model.Entities.GameLogKind;
using Souls.Server.Chat;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

public sealed class GameOptions
{
    /// <summary>How long a turn may take before it ends automatically.</summary>
    public TimeSpan TurnTime { get; set; } = TimeSpan.FromSeconds(75);

    /// <summary>How long the players may choose which starting cards to replace; then the rest keep their hand.</summary>
    public TimeSpan MulliganTime { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>A player whose turn runs out this many times in a row forfeits.</summary>
    public int MaxTimeoutsInARow { get; set; } = 3;
}

/// <summary>
/// The game rules. Ported from the original GameEngine and extended (armor, decks, races, abilities, hero powers,
/// turn timer, spectators). All methods must be called while holding the <see cref="ServerState"/> lock.
/// </summary>
public sealed partial class GameEngine(
    ServerState state,
    ChatEngine chat,
    IServiceScopeFactory scopes,
    TimeProvider time,
    IOptions<GameOptions> options,
    GameMetrics metrics,
    ILogger<GameEngine> logger)
{
    /// <summary>Starts a game between two players with the mulligan (see <see cref="RequestMulliganAsync"/>).</summary>
    public GameRoom CreateGame(Pair<Player> players, bool practice = false)
    {
        players.First.ConstructGamePlayer(true);
        players.Second.ConstructGamePlayer(false);

        var room = new GameRoom(players, time, options.Value.TurnTime, options.Value.MulliganTime, practice);
        state.Rooms[room.GameId] = room;

        var response = room.GenerateGameUpdate(create: true);
        players.First.Send(response.First);
        players.Second.Send(response.Second);

        var text = $"The battle begins, {players.First.Name} starts against {players.Second.Name}.";
        room.Logger.Add(GameLogKind.GameCreated, players.First.Id, players.Second.Id, "Player", "Player", text);
        room.LogLine(text);
        room.Sync();
        logger.LogInformation("Game {GameId} started: {Player1} vs {Player2}", room.GameId, players.First.Name, players.Second.Name);
        return room;
    }

    public void RequestQueue(Player player, bool normal, int difficulty = 1)
    {
        if (player.GPlayer?.GameRoom is { } room)
        {
            // Reconnected while in a game: send the current state.
            var response = room.GenerateGameUpdate();
            player.Send(player.GPlayer.IsPlayerOne ? response.First : response.Second);
            player.GameContext?.Send(new Response(GameResponse.GameSync, room.SyncPayload()));
            return;
        }

        StopSpectating(player);
        if (player.InQueue)
        {
            player.Send(new Response(GameResponse.QueueAlreadyIn, "You are already in queue!"));
            return;
        }

        player.InQueue = true;
        player.QueuedAt = time.GetUtcNow();
        player.PracticeDifficulty = Math.Clamp(difficulty, 0, 2);
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

    public async Task RequestUseCardAsync(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out var opponent))
        {
            return;
        }

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

        if (card.IsSpell)
        {
            await CastSpellAsync(player, gp, opponent, card, message);
            return;
        }

        var slot = message.GetInt("slotId");
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

        var room = gp.GameRoom!;
        gp.HandCards.Remove(cid);
        gp.BoardCards[slot] = card;
        gp.Mana -= card.Cost;
        gp.CardsPlayed++;
        card.SlotId = slot;

        // Cards arrive exhausted unless they have Charge.
        card.HasAttacked = !card.HasCharge;

        JsonObject Payload() => new() { ["card"] = card.ToJson(), ["pInfo"] = gp.GetPlayerData() };
        player.Send(new Response(GameResponse.GameUseCardOk, Payload()));
        opponent.Send(new Response(GameResponse.GameOpponentUseCardOk, Payload()));

        var text = $"{gp.Name} plays {card.Name}.";
        room.Logger.Add(GameLogKind.UseCard, player.Id, card.Id, "Player", "Card", text);
        room.LogLine(text);
        OnPlay(room, gp, card);
        await FinishActionAsync(room);
    }

    public async Task RequestNextTurnAsync(Player player, bool timedOut = false)
    {
        if (!TryGetGame(player, out var gp, out var opponent) || !gp.IsPlayerTurn())
        {
            return;
        }

        if (!timedOut)
        {
            gp.TimeoutsInARow = 0;
        }

        var room = gp.GameRoom!;
        var text = $"{gp.Name} gives the turn to {opponent.Name}.";
        room.Logger.Add(GameLogKind.NextTurn, player.Id, opponent.Id, "Player", "Player", text);
        room.LogLine(text);
        room.NextTurn();
        room.FlushEvents();
        AnnounceTurn(room);

        if (room.Turn == 1)
        {
            room.LogLine($"{opponent.Name} goes second and gets 1 extra mana this turn.");
        }

        // Start-of-turn abilities, then the player whose turn starts draws a card.
        StartOfTurn(room, opponent.GPlayer!);
        ResolveDeaths(room);
        Draw(room, opponent.GPlayer!, 1);
        await FinishActionAsync(room);
    }

    /// <summary>
    /// The mulligan: while it runs, each player may replace any of their starting cards once (both at the same time).
    /// Unknown cards refuse the request; a second request is ignored. The game starts when both have chosen.
    /// </summary>
    public async Task RequestMulliganAsync(Player player, Message message)
    {
        if (!TryGetGame(player, out var gp, out var opponent) || gp.GameRoom is not { InMulligan: true } room || gp.MulliganDone)
        {
            return;
        }

        var replace = message.GetInts("replace").ToHashSet();
        if (!replace.IsSubsetOf(gp.HandCards.Keys))
        {
            Tell(player, "Those cards are not in your starting hand.");
            return;
        }

        Mulligan(room, player, gp, replace);
        if (opponent.GPlayer!.MulliganDone)
        {
            await StartGameAsync(room);
        }
    }

    /// <summary>
    /// Draws a new card for each replaced one, then shuffles the replaced cards back into the deck. Every card of the
    /// new hand gets a new cid (kept cards in their place), so the opponent only learns how many were replaced.
    /// </summary>
    private static void Mulligan(GameRoom room, Player player, GamePlayer gp, IReadOnlySet<int> replace)
    {
        gp.MulliganDone = true;
        var returned = new List<Card>();
        var hand = gp.HandCards.Values.ToList();
        gp.HandCards.Clear();
        foreach (var card in hand)
        {
            var replaced = replace.Contains(card.Cid) && gp.Deck.Count > 0;
            var next = replaced ? gp.Deck[^1] : card.NewInstance();
            if (replaced)
            {
                gp.Deck.RemoveAt(gp.Deck.Count - 1);
                returned.Add(card);
            }

            gp.HandCards[next.Cid] = next;
            room.Logger.Add(GameLogKind.NewCard, player.Id, next.Id, "Player", "Card");
        }

        foreach (var card in returned)
        {
            gp.Deck.Insert(Random.Shared.Next(gp.Deck.Count + 1), card.NewInstance());
        }

        player.Send(new Response(GameResponse.GameMulligan, new JsonObject
        {
            ["hand"] = new JsonArray([.. gp.HandCards.Values.Select(c => (JsonNode)c.ToJson())]),
            ["replaced"] = returned.Count,
        }));
        player.GetOpponent()!.Send(new Response(GameResponse.GameOpponentMulligan, new JsonObject
        {
            ["hand"] = GameRoom.HiddenHand(gp),
            ["replaced"] = returned.Count,
        }));
        room.LogLine(returned.Count == 0 ? $"{gp.Name} keeps their starting hand."
            : $"{gp.Name} replaces {returned.Count} starting card{(returned.Count == 1 ? "" : "s")}.");
        room.FlushEvents();
    }

    /// <summary>After the mulligan: player one's first turn starts and the player going second draws their extra card.</summary>
    private async Task StartGameAsync(GameRoom room)
    {
        room.Start();
        AnnounceTurn(room);
        Draw(room, room.Players.Second.GPlayer!, GameRules.SecondPlayerExtraCards);
        await FinishActionAsync(room);
    }

    /// <summary>Tells both players whose turn starts (NextTurn).</summary>
    private static void AnnounceTurn(GameRoom room)
    {
        foreach (var p in new[] { room.Players.First, room.Players.Second })
        {
            p.Send(new Response(GameResponse.GameNextTurn, new JsonObject
            {
                ["yourTurn"] = p.GPlayer!.IsPlayerTurn(),
                ["playerInfo"] = p.GPlayer.GetPlayerData(),
                ["opponentInfo"] = p.GetOpponent()!.GPlayer!.GetPlayerData(),
                ["turnEndsIn"] = (long)room.TurnTime.TotalMilliseconds,
            }));
        }
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

        if (type is < 0 or > 3)
        {
            throw new ProtocolException("Unknown attack type");
        }

        var sourceIsHero = type is 2 or 3;
        var targetIsHero = type is 1 or 3;
        var sourceCard = sourceIsHero ? null : gp.FindBoardCard(source);
        var targetCard = targetIsHero ? null : opponent.FindBoardCard(target);
        if ((!sourceIsHero && sourceCard is null) || (!targetIsHero && targetCard is null))
        {
            return;
        }

        if (sourceCard is not null && !CanAct(player, sourceCard))
        {
            return;
        }

        if (sourceIsHero && (gp.HasAttacked || gp.Attack <= 0))
        {
            Tell(player, gp.Attack <= 0 ? "Your hero has no attack!" : "Your hero already attacked this turn!");
            return;
        }

        if (opponent.HasTaunt && targetCard is not { HasTaunt: true })
        {
            Tell(player, "A card with Taunt is in the way!");
            return;
        }

        object attacker = sourceIsHero ? gp : sourceCard!;
        object defender = targetIsHero ? opponent : targetCard!;
        var text = $"{NameOf(attacker)} attacks {NameOf(defender)}.";
        var kind = (sourceIsHero, targetIsHero) switch
        {
            (false, false) => GameLogKind.CardAttackCard,
            (false, true) => GameLogKind.CardAttackPlayer,
            (true, false) => GameLogKind.PlayerAttackCard,
            (true, true) => GameLogKind.PlayerAttackPlayer,
        };
        room.Logger.Add(kind, sourceIsHero ? player.Id : sourceCard!.Id, targetIsHero ? opponentPlayer.Id : targetCard!.Id,
            sourceIsHero ? "Player" : "Card", targetIsHero ? "Player" : "Card", text);
        room.LogLine(text);
        Fight(room, gp, attacker, opponent, defender);
        await FinishActionAsync(room);
    }

    public async Task RequestUseAbilityAsync(Player player, Message message)
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

        var card = gp.FindBoardCard(message.GetInt("source"));
        if (card is null || !CanAct(player, card))
        {
            return;
        }

        var type = (TargetType)message.GetInt("type");
        if (UseAbility(gp.GameRoom!, player, gp, card, type, message.GetInt("target")))
        {
            await FinishActionAsync(gp.GameRoom!);
        }
    }

    public async Task RequestHeroPowerAsync(Player player, Message message)
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

        if (gp.HeroPowerUsed)
        {
            Tell(player, "Your hero power was already used this turn!");
            return;
        }

        if (gp.Mana < GameRules.HeroPowerCost)
        {
            player.Send(new Response(GameResponse.GameUseCardOom, "Not enough mana!"));
            return;
        }

        var type = (TargetType)(message.Payload["type"] is null ? (int)TargetType.OwnHero : message.GetInt("type"));
        var target = message.Payload["target"] is null ? -1 : message.GetInt("target");
        if (UseHeroPower(gp.GameRoom!, player, gp, type, target))
        {
            await FinishActionAsync(gp.GameRoom!);
        }
    }

    /// <summary>Ends turns whose time ran out; repeat offenders forfeit. An expired mulligan keeps the undecided hands.</summary>
    public async Task CheckTurnTimersAsync()
    {
        var now = time.GetUtcNow();
        foreach (var room in state.Rooms.Values.Where(r => !r.IsEnded && now >= r.TurnDeadline).ToList())
        {
            if (room.InMulligan)
            {
                foreach (var undecided in new[] { room.Players.First, room.Players.Second }.Where(p => !p.GPlayer!.MulliganDone))
                {
                    Mulligan(room, undecided, undecided.GPlayer!, new HashSet<int>());
                }

                await StartGameAsync(room);
                continue;
            }

            var player = room.CurrentPlaying;
            var gp = player.GPlayer!;
            gp.TimeoutsInARow++;
            var text = $"{gp.Name} ran out of time.";
            room.Logger.Add(GameLogKind.TurnTimedOut, player.Id, player.Id, "Player", "Player", text);
            room.Event("timeout", new JsonObject { ["id"] = gp.Ident });
            room.LogLine(text);
            if (gp.TimeoutsInARow >= options.Value.MaxTimeoutsInARow)
            {
                room.LogLine($"{gp.Name} is idle and forfeits the game.");
                room.FlushEvents();
                room.Winner = player.GetOpponent();
                await EndGameAsync(room, isDraw: false);
                continue;
            }

            await RequestNextTurnAsync(player, timedOut: true);
        }
    }

    /// <summary>Flushes events and state, and ends the game if a hero died.</summary>
    private async Task FinishActionAsync(GameRoom room)
    {
        var p1 = room.Players.First.GPlayer!;
        var p2 = room.Players.Second.GPlayer!;
        foreach (var hero in new[] { p1, p2 }.Where(h => h.Health < 1))
        {
            hero.IsDead = true;
            room.Event("heroDeath", new JsonObject { ["id"] = hero.Ident });
            room.LogLine($"{hero.Name} has fallen!");
        }

        room.Sync();
        if (p1.IsDead || p2.IsDead)
        {
            var isDraw = p1.IsDead && p2.IsDead;
            room.Winner = isDraw ? null : p1.IsDead ? room.Players.Second : room.Players.First;
            await EndGameAsync(room, isDraw);
        }
    }

    private static bool CanAct(Player player, Card card)
    {
        if (card.Paralyzed)
        {
            Tell(player, "This card is paralyzed!");
            return false;
        }

        if (card.HasAttacked)
        {
            Tell(player, "Cannot do that yet!");
            return false;
        }

        return true;
    }

    private static void Tell(Player p, string text) => p.Send(new Response(GameResponse.GameGeneralMessage, text));

    private static bool TryGetGame(Player player, out GamePlayer gamePlayer, out Player opponent)
    {
        gamePlayer = player.GPlayer!;
        opponent = player.GetOpponent()!;
        return player.GPlayer?.GameRoom is { IsEnded: false } && opponent?.GPlayer is not null;
    }
}
