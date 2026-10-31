using System.Text.Json.Nodes;
using Souls.Model;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Game;

public sealed partial class GameEngine
{
    // A burst of three, then one emote every 3 s and one challenge every 10 s.
    private const int Burst = 3;
    private static readonly TimeSpan EmoteInterval = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan ChallengeInterval = TimeSpan.FromSeconds(10);

    /// <summary>
    /// A rate limit (generic cell rate algorithm): allows <paramref name="burst"/> actions at once, then one per
    /// <paramref name="interval"/>. Returns the new value of <paramref name="clock"/> (any past time to start with),
    /// or <c>null</c> when the action is refused.
    /// </summary>
    internal static DateTimeOffset? Throttle(DateTimeOffset clock, DateTimeOffset now, TimeSpan interval, int burst)
    {
        var next = (clock > now ? clock : now) + interval;
        return next - now > interval * burst ? null : next;
    }

    // ---- Emotes ---------------------------------------------------------------------------------------------------

    /// <summary>Shows an emote to both players (unless the opponent muted them), the spectators and the replay.</summary>
    public void RequestEmote(Player player, int emote)
    {
        if (emote < 0 || emote >= GameRules.Emotes.Count)
        {
            throw new ProtocolException("Unknown emote");
        }

        if (!TryGetGame(player, out var gp, out var opponent))
        {
            return;
        }

        if (Throttle(gp.EmoteClock, time.GetUtcNow(), EmoteInterval, Burst) is not { } clock)
        {
            Tell(player, "You are sending emotes too fast.");
            return;
        }

        gp.EmoteClock = clock;
        var response = new Response(GameResponse.Emote, new JsonObject { ["ident"] = gp.Ident, ["emote"] = emote, ["text"] = GameRules.Emotes[emote] });
        player.Send(response);
        if (!opponent.GPlayer!.EmotesMuted)
        {
            opponent.Send(response);
        }

        gp.GameRoom!.Broadcast(response);
    }

    public static void MuteEmotes(Player player, bool muted)
    {
        if (player.GPlayer is { GameRoom: { } room } gp)
        {
            gp.EmotesMuted = muted;
            room.Dirty = true;
        }
    }

    // ---- Friendly challenges --------------------------------------------------------------------------------------

    /// <summary>
    /// Invites an online player, by name, to an unranked game. Neither may be in a game, watching one or part of another
    /// pending challenge; the invited player may be waiting in a queue (accepting leaves it).
    /// </summary>
    public void RequestChallenge(Player player, string name)
    {
        if (player.GPlayer is not null || player.Spectating is not null || state.ChallengeOf(player) is not null)
        {
            ChallengeClosed(player, "Finish your game or your pending challenge first.");
            return;
        }

        // Counted before the lookup, so the limit also slows down probing who is online.
        var now = time.GetUtcNow();
        if (Throttle(state.ChallengeClocks.GetValueOrDefault(player.Id), now, ChallengeInterval, Burst) is not { } clock)
        {
            ChallengeClosed(player, "You are sending challenges too fast. Wait a few seconds.");
            return;
        }

        state.ChallengeClocks[player.Id] = clock;
        var normalized = Model.Entities.Player.Normalize(name);
        var target = state.GameClients.Values.FirstOrDefault(p => !p.IsBot && p.DisconnectedAt is null && Model.Entities.Player.Normalize(p.Name) == normalized);
        if (target is null)
        {
            ChallengeClosed(player, $"{name.Trim()} is not online.");
            return;
        }

        var problem = target == player ? "You cannot challenge yourself."
            : target.GPlayer is not null || target.Spectating is not null ? $"{target.Name} is busy in another game."
            : state.ChallengeOf(target) is not null ? $"{target.Name} already has a pending challenge."
            : null;
        if (problem is not null)
        {
            ChallengeClosed(player, problem);
            return;
        }

        var timeout = options.Value.ChallengeTimeout;
        state.Challenges.Add(new Challenge(player, target, now + timeout));
        player.Send(new Response(GameResponse.ChallengeSent, new JsonObject { ["name"] = target.Name, ["expiresIn"] = (long)timeout.TotalMilliseconds }));
        target.Send(new Response(GameResponse.ChallengeInvite, new JsonObject
        {
            ["name"] = player.Name,
            ["type"] = player.PlayerType.Id,
            ["rating"] = player.Rating,
            ["expiresIn"] = (long)timeout.TotalMilliseconds,
        }));
        logger.LogDebug("{Player} challenges {Target}", player.Name, target.Name);
    }

    /// <summary>The invited player accepts (the game starts at once) or declines.</summary>
    public void AnswerChallenge(Player player, bool accept)
    {
        if (state.ChallengeOf(player) is not { } challenge || challenge.To != player)
        {
            ChallengeClosed(player, "That challenge is no longer open.");
            return;
        }

        if (!accept)
        {
            Close(challenge, $"{player.Name} declined your challenge.", null);
            return;
        }

        state.Challenges.Remove(challenge);
        foreach (var p in new[] { challenge.From, challenge.To })
        {
            RemoveFromQueues(p);
            StopSpectating(p);
        }

        // Friendly games are stored like practice games but earn nothing, or two accounts could farm them (see EndGameAsync).
        var (first, second) = Random.Shared.Next(2) == 0 ? (challenge.From, challenge.To) : (challenge.To, challenge.From);
        CreateGame(new Pair<Player>(first, second), friendly: true);
    }

    public void CancelChallenge(Player player)
    {
        if (state.ChallengeOf(player) is { } challenge && challenge.From == player)
        {
            Close(challenge, "Challenge withdrawn.", $"{player.Name} withdrew the challenge.");
        }
    }

    /// <summary>Ends the pending challenge of a player who left or started another game, telling the other player why.</summary>
    public void DropChallenge(Player player, string reason)
    {
        if (state.ChallengeOf(player) is { } challenge)
        {
            Close(challenge, challenge.From == player ? null : reason, challenge.To == player ? null : reason);
        }
    }

    /// <summary>Ends the challenges nobody answered in time and forgets rate limits that ran out. Called by the matchmaker.</summary>
    public void ExpireChallenges()
    {
        var now = time.GetUtcNow();
        foreach (var challenge in state.Challenges.Where(c => now >= c.ExpiresAt).ToList())
        {
            Close(challenge, $"{challenge.To.Name} did not answer.", $"The challenge from {challenge.From.Name} expired.");
        }

        foreach (var (id, clock) in state.ChallengeClocks)
        {
            if (clock <= now)
            {
                state.ChallengeClocks.Remove(id);
            }
        }
    }

    private void Close(Challenge challenge, string? toChallenger, string? toChallenged)
    {
        state.Challenges.Remove(challenge);
        if (toChallenger is not null)
        {
            ChallengeClosed(challenge.From, toChallenger);
        }

        if (toChallenged is not null)
        {
            ChallengeClosed(challenge.To, toChallenged);
        }
    }

    private static void ChallengeClosed(Player player, string text) => player.Send(new Response(GameResponse.ChallengeClosed, text));
}
