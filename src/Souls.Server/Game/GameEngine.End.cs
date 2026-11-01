using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Souls.Model;
using Souls.Model.Localization;
using Souls.Model.Entities;
using Souls.Server.Ai;
using Souls.Server.Network;
using Player = Souls.Server.Objects.Player;

namespace Souls.Server.Game;

public sealed partial class GameEngine
{
    private sealed record Reward(int Coins, int RatingChange, int Rating, JsonArray Quests, JsonObject? Season);

    /// <summary>
    /// Ends a game: stores it with its log and replay, updates ratings, coins and daily quests (not for a friendly
    /// game), notifies players and spectators and removes the players from the server (clients navigate to the
    /// statistics page and reconnect for the next game).
    /// </summary>
    public async Task EndGameAsync(GameRoom room, bool isDraw)
    {
        // A copy (the bot's lookahead) just ends: nothing is sent or stored.
        if (room.IsEnded || room.IsCopy)
        {
            room.IsEnded = true;
            return;
        }

        room.IsEnded = true;
        state.Rooms.Remove(room.GameId);

        var player = room.Players.First;
        var opponent = room.Players.Second;
        var winner = isDraw ? null : room.Winner ?? opponent;
        var loser = winner is null ? null : winner == player ? opponent : player;
        var text = winner is null
            ? new GameText("log.draw", ("first", player.Name), ("second", opponent.Name))
            : new GameText("log.win", ("winner", winner.Name), ("loser", loser!.Name));
        metrics.GameFinished(room.IsPractice ? "practice" : player.IsPersona && opponent.IsPersona ? "ai" : "normal", isDraw ? "draw" : player.GPlayer!.IsDead || opponent.GPlayer!.IsDead ? "win" : "forfeit");
        room.Logger.Add(isDraw ? GameLogKind.Draw : GameLogKind.Won, (winner ?? player).Id, (loser ?? opponent).Id, "Player", "Player", text);
        room.LogLine(text);
        room.FlushEvents();

        var end = new JsonObject { ["winner"] = winner is null ? 0 : winner.GPlayer!.Ident };
        text.WriteTo(end, "text");
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
            var payload = new JsonObject { ["statistics"] = room.GameId };
            text.WriteTo(payload, "text");
            if (room.IsFriendly)
            {
                payload["friendly"] = true;
                payload["coins"] = 0;
                payload["ratingChange"] = null;
            }
            else if (rewards.TryGetValue(p, out var reward))
            {
                payload["coins"] = reward.Coins;
                payload["ratingChange"] = room.IsPractice ? null : reward.RatingChange;
                payload["rating"] = reward.Rating;
                payload["quests"] = reward.Quests;
                if (reward.Season is { } season)
                {
                    payload["season"] = season;
                }
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
            if (p.IsPersona)
            {
                state.PersonasPlayed.Add(p.Id);
            }

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
        // Personas of the community rate each other like players; nobody is rated against a bot.
        var rated = !room.IsPractice && (!player.IsBot && !opponent.IsBot || player.IsPersona && opponent.IsPersona);
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SoulsDbContext>();
        var ratings = rated ? await RateAsync(db, player, opponent, winner, isDraw) : [];
        var change1 = ratings.TryGetValue(player.Id, out var r1) ? r1.Change : 0;
        var change2 = ratings.TryGetValue(opponent.Id, out var r2) ? r2.Change : 0;

        // The saved running game goes first (see GameStore). If storing the result fails after that, the game is lost
        // as it was before games were saved; but a game whose result is stored can never be restored and count twice.
        if (store is not null)
        {
            await store.DeleteAsync(room.GameId);
        }

        var season = rated ? await Seasons.CurrentAsync(db) : null;

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
        // A headless game (the AI community's, played away) has no log or replay to keep.
        if (!room.Headless)
        {
            room.Logger.AddTo(db, game);
            db.GameReplays.Add(new GameReplay { Game = game, Data = new JsonArray([.. room.Replay.Select(r => (JsonNode)r.DeepClone())]).ToJsonString() });
        }

        var rewards = new Dictionary<Player, Reward>();
        foreach (var (p, change) in new[] { (player, change1), (opponent, change2) })
        {
            // A friendly game earns nothing: no coins, quests, rating or season points.
            if (p.GPlayer is not { } gp || room.IsFriendly)
            {
                continue;
            }

            if (p.IsBot)
            {
                if (p.IsPersona && ratings.TryGetValue(p.Id, out var ai))
                {
                    await AiCommunity.AfterGameAsync(db, p.Id, ai, isDraw ? null : winner == p, time.GetUtcNow());
                }

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
            var before = entity.Rating;
            entity.Money += coins + questCoins;
            if (ratings.TryGetValue(p.Id, out var rating))
            {
                entity.Rating += rating.Change;
                entity.RatingDeviation = rating.After.Deviation;
                entity.RatingVolatility = rating.After.Volatility;
                entity.RatedAt = time.GetUtcNow();
            }

            entity.Rank = Ratings.RankOf(entity.Rating);
            if (AiCommunity.IsNewTier(Ratings.RankOf(before), entity.Rank))
            {
                db.PlayerEvents.Add(new PlayerEvent { PlayerId = p.Id, Created = time.GetUtcNow(), Kind = PlayerEventKind.Tier, Value = entity.Rank });
            }

            rewards[p] = new Reward(coins + questCoins, change, entity.Rating, new JsonArray([.. quests.Select(q =>
            {
                var definition = Quests.Get(q.Kind);
                var quest = new JsonObject();
                definition.Text.WriteTo(quest, "text");
                quest["progress"] = q.Progress;
                quest["target"] = definition.Target;
                quest["reward"] = definition.Reward;
                quest["done"] = q.CompletedAt is not null;
                return (JsonNode)quest;
            })]), season is null ? null : SeasonResult(season, before, entity.Rating));
        }

        await db.SaveChangesAsync();
        room.GameId = game.Id;
        return rewards;
    }

    /// <summary>
    /// The Glicko-2 results of a rated game for both players, from their stored ratings (each deviation grown by the time
    /// since the player's last rated game): the change of the shown (whole) rating and the new Glicko-2 rating.
    /// </summary>
    private async Task<Dictionary<int, (int Change, Ratings.Glicko After)>> RateAsync(SoulsDbContext db, Player player, Player opponent, Player? winner, bool isDraw)
    {
        var now = time.GetUtcNow();
        var stored = await db.Players.AsNoTracking().Where(p => p.Id == player.Id || p.Id == opponent.Id)
            .ToDictionaryAsync(p => p.Id, p => new Ratings.Glicko(p.Rating,
                Ratings.Aged(p.RatingDeviation, p.RatingVolatility, now - (p.RatedAt ?? now)), p.RatingVolatility));
        var result = new Dictionary<int, (int, Ratings.Glicko)>();
        foreach (var (p, other) in new[] { (player, opponent), (opponent, player) })
        {
            var (me, them) = (stored[p.Id], stored[other.Id]);
            var after = Ratings.Update(me, them.Rating, them.Deviation, isDraw ? 0.5 : winner == p ? 1 : 0);
            result[p.Id] = ((int)Math.Round(after.Rating, MidpointRounding.AwayFromZero) - (int)me.Rating, after);
        }

        return result;
    }

    /// <summary>
    /// A ranked game in the season: its standings go by rating (the season points) and the rank of the rating is the
    /// tier (see <see cref="Seasons"/>), so the end screen shows both before and after the game.
    /// </summary>
    private static JsonObject SeasonResult(Season season, int before, int after)
    {
        var (from, to) = (Ratings.RankOf(before), Ratings.RankOf(after));
        var result = new JsonObject { ["number"] = season.Number, ["name"] = season.Name };
        Seasons.NameText(season)?.WriteTo(result, "name");
        result["before"] = Rank(before, from);
        result["after"] = Rank(after, to);
        result["promoted"] = to > from;
        result["demoted"] = to < from;
        return result;

        static JsonObject Rank(int rating, int rank)
        {
            var tier = Ratings.TierOf(rank);
            var json = new JsonObject { ["rating"] = rating, ["rank"] = rank };
            tier.Text.WriteTo(json, "tier");
            json["css"] = tier.Css;
            return json;
        }
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
            room.Logger.Add(kind, player.Id, player.Id, "Player", "Player", new GameText("log.left", ("player", player.Name)));
        }

        room.LogLine(new GameText("log.left", ("player", player.Name)));
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
            player.Send(new Response(GameResponse.SpectateError, new GameText("spectate.busy")));
            return;
        }

        if (!state.Rooms.TryGetValue(gameId, out var room) || room.IsEnded)
        {
            player.Send(new Response(GameResponse.SpectateError, new GameText("spectate.over")));
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
