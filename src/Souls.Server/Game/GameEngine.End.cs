using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Entities;
using Souls.Server.Network;
using Player = Souls.Server.Objects.Player;

namespace Souls.Server.Game;

public sealed partial class GameEngine
{
    private sealed record Reward(int Coins, int RatingChange, int Rating, JsonArray Quests);

    /// <summary>
    /// Ends a game: stores it with its log and replay, updates ratings, coins and daily quests, notifies players and
    /// spectators and removes the players from the server (clients navigate to the statistics page and reconnect for
    /// the next game).
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
        var winner = isDraw ? null : room.Winner ?? opponent;
        var loser = winner is null ? null : winner == player ? opponent : player;
        var text = winner is null ? $"{player.Name} and {opponent.Name} play a draw." : $"{winner.Name} wins against {loser!.Name}!";
        metrics.GameFinished(room.IsPractice ? "practice" : "normal", isDraw ? "draw" : player.GPlayer!.IsDead || opponent.GPlayer!.IsDead ? "win" : "forfeit");
        room.Logger.Add(isDraw ? GameLogKind.Draw : GameLogKind.Won, (winner ?? player).Id, (loser ?? opponent).Id, "Player", "Player", text);
        room.LogLine(text);
        room.FlushEvents();

        var end = new JsonObject
        {
            ["winner"] = winner is null ? 0 : winner.GPlayer!.Ident,
            ["text"] = text,
        };
        room.Record(new Response(GameResponse.SpectateEnd, end));

        var rewards = new Dictionary<Player, Reward>();
        try
        {
            rewards = await StoreAsync(room, winner, isDraw);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Failed to store game {GameId}", room.GameId);
            metrics.Error("store");
            room.GameId = 0;
        }

        Response Result(Player p)
        {
            var payload = new JsonObject { ["statistics"] = room.GameId, ["text"] = text };
            if (rewards.TryGetValue(p, out var reward))
            {
                payload["coins"] = reward.Coins;
                payload["ratingChange"] = room.IsPractice ? null : reward.RatingChange;
                payload["rating"] = reward.Rating;
                payload["quests"] = reward.Quests;
            }

            return new Response(isDraw ? GameResponse.GameDraw : winner == p ? GameResponse.GameVictory : GameResponse.GameDefeat, payload);
        }

        player.Send(Result(player));
        opponent.Send(Result(opponent));

        end["statistics"] = room.GameId;
        foreach (var spectator in room.Spectators)
        {
            spectator.GameContext?.Send(new Response(GameResponse.SpectateEnd, end));
            spectator.Spectating = null;
        }

        room.Spectators.Clear();

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

        logger.LogInformation("Game {GameId} ended: {Result}", room.GameId, text);
    }

    private async Task<Dictionary<Player, Reward>> StoreAsync(GameRoom room, Player? winner, bool isDraw)
    {
        var player = room.Players.First;
        var opponent = room.Players.Second;
        var rated = !room.IsPractice && !player.IsBot && !opponent.IsBot;
        double Score(Player p) => isDraw ? 0.5 : winner == p ? 1 : 0;
        var change1 = rated ? Ratings.Change(player.Rating, opponent.Rating, Score(player)) : 0;
        var change2 = rated ? Ratings.Change(opponent.Rating, player.Rating, Score(opponent)) : 0;

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var game = new Model.Entities.Game
        {
            Player1Id = player.Id,
            Player2Id = opponent.Id,
            Created = room.StartedAt,
            IsPractice = room.IsPractice,
            WinnerId = winner?.Id,
            Player1RatingChange = change1,
            Player2RatingChange = change2,
            Turns = room.Turn + 1,
        };
        db.Games.Add(game);
        room.Logger.AddTo(db, game);
        db.GameReplays.Add(new GameReplay { Game = game, Data = new JsonArray([.. room.Replay.Select(r => (JsonNode)r.DeepClone())]).ToJsonString() });

        var rewards = new Dictionary<Player, Reward>();
        foreach (var (p, change) in new[] { (player, change1), (opponent, change2) })
        {
            if (p.IsBot || p.GPlayer is not { } gp)
            {
                continue;
            }

            var won = winner == p;
            var other = p == player ? opponent : player;
            var coins = room.IsPractice
                ? won ? other.Difficulty + 1 : 0
                : won ? 3 + (other.Rating >= p.Rating + 100 ? 1 : 0) : 1;
            var counters = new GameCounters(won, room.IsPractice, other.IsBot && other.Difficulty >= 2, gp.CardsPlayed, gp.CardsDestroyed, gp.AbilitiesUsed, gp.HeroDamage);
            var (questCoins, quests) = await Quests.ApplyAsync(db, p.Id, counters, time);

            var entity = await db.Players.SingleAsync(x => x.Id == p.Id);
            entity.Money += coins + questCoins;
            entity.Rating += change;
            entity.Rank = Ratings.RankOf(entity.Rating);
            rewards[p] = new Reward(coins + questCoins, change, entity.Rating, new JsonArray([.. quests.Select(q =>
            {
                var definition = Quests.Get(q.Kind);
                return (JsonNode)new JsonObject
                {
                    ["text"] = definition.Text,
                    ["progress"] = q.Progress,
                    ["target"] = definition.Target,
                    ["reward"] = definition.Reward,
                    ["done"] = q.CompletedAt is not null,
                };
            })]));
        }

        await db.SaveChangesAsync();
        room.GameId = game.Id;
        return rewards;
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
            room.Logger.Add(kind, player.Id, player.Id, "Player", "Player", $"{player.Name} left the game.");
        }

        room.LogLine($"{player.Name} left the game.");
        room.Winner = player.GetOpponent();
        await EndGameAsync(room, isDraw: false);
    }

    // ---- Spectators -----------------------------------------------------------------------------------------------

    public void ListLiveGames(Player player) => player.Send(new Response(GameResponse.LiveGames, new JsonObject
    {
        ["games"] = new JsonArray([.. state.Rooms.Values.Where(r => !r.IsEnded).OrderByDescending(r => r.StartedAt).Take(50).Select(r => (JsonNode)r.Summary())]),
    }));

    public void Spectate(Player player, int gameId)
    {
        if (player.GPlayer is not null || player.InQueue)
        {
            player.Send(new Response(GameResponse.SpectateError, "Leave the queue or finish your game first."));
            return;
        }

        if (!state.Rooms.TryGetValue(gameId, out var room) || room.IsEnded)
        {
            player.Send(new Response(GameResponse.SpectateError, "That game is over."));
            return;
        }

        StopSpectating(player);
        room.Spectators.Add(player);
        player.Spectating = room;
        player.Send(new Response(GameResponse.SpectateStart, room.SpectatorSnapshot()));
        player.Send(new Response(GameResponse.GameSync, room.SyncPayload()));
        logger.LogDebug("{Player} watches game {GameId}", player.Name, gameId);
    }

    public void StopSpectating(Player player)
    {
        player.Spectating?.Spectators.Remove(player);
        player.Spectating = null;
    }
}
