using System.Globalization;
using System.Text.Json.Nodes;
using Souls.Server.Network;
using Souls.Server.Objects;

namespace Souls.Server.Ai;

public sealed class AiOptions
{
    /// <summary>Pause after playing cards, before attacking.</summary>
    public TimeSpan ThinkDelay { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>Pause between attacks.</summary>
    public TimeSpan AttackDelay { get; set; } = TimeSpan.FromMilliseconds(200);
}

/// <summary>
/// The practice bot. It plays through an in-memory <see cref="BotConnection"/> using the same messages as a
/// browser: on its turn it plays every card it can afford, attacks with all board cards and ends the turn.
/// </summary>
public sealed class AiPlayer(BotConnection connection, Func<Message, Task> send, AiOptions options, ILogger logger)
{
    private sealed class Side
    {
        public Dictionary<int, Card?> Hand { get; } = [];
        public Dictionary<int, Card> Board { get; } = [];
        public int Attack { get; set; }
        public int Health { get; set; }
        public int Mana { get; set; }
    }

    private Side _me = new();
    private Side _opponent = new();
    private bool _yourTurn;

    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var json in connection.Inbox.ReadAllAsync(ct))
            {
                try
                {
                    if (!Handle(JsonNode.Parse(json)!))
                    {
                        break;
                    }

                    await ProcessGameAsync(ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "Bot failed to process a message");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Server shutting down.
        }
        finally
        {
            connection.Close("Bot stopped");
        }
    }

    /// <returns><c>false</c> when the bot should disconnect.</returns>
    private bool Handle(JsonNode message)
    {
        var type = (int?)message["Type"];
        var payload = message["Payload"];
        switch ((GameResponse?)type)
        {
            case GameResponse.GameCreate:
                CreateGame(payload!);
                break;
            case GameResponse.GameNextTurn:
                _yourTurn = (bool?)payload!["yourTurn"] ?? false;
                ReadInfo(_me, payload["playerInfo"]);
                ReadInfo(_opponent, payload["opponentInfo"]);
                break;
            case GameResponse.GameNewCard:
                foreach (var node in payload!["card"]!.AsArray())
                {
                    var card = Card.FromJson(node!);
                    _me.Hand[card.Cid] = card;
                }

                break;
            case GameResponse.GameOpponentNewCard:
                foreach (var node in payload!["card"]!.AsArray())
                {
                    _opponent.Hand[(int)node!["cid"]!] = null;
                }

                break;
            case GameResponse.GameOpponentUseCardOk:
                var used = Card.FromJson(payload!["card"]!);
                _opponent.Hand.Remove(used.Cid);
                _opponent.Board[used.Cid] = used;
                break;
            case GameResponse.GameAttack:
                ApplyAttackResult(_me, payload!["player"]!);
                ApplyAttackResult(_opponent, payload["opponent"]!);
                break;
            case GameResponse.GameUseAbility:
                ApplyAbility(payload!);
                break;
            case GameResponse.GameBotDisconnect:
            case GameResponse.GameVictory:
            case GameResponse.GameDefeat:
            case GameResponse.GameDraw:
                return false;
        }

        return true;
    }

    private void CreateGame(JsonNode payload)
    {
        _me = new Side();
        _opponent = new Side();
        ReadInfo(_me, payload["player"]!["info"]);
        ReadInfo(_opponent, payload["opponent"]!["info"]);
        _yourTurn = (bool?)payload["yourTurn"] ?? false;

        foreach (var (_, node) in payload["player"]!["hand"]!.AsObject())
        {
            var card = Card.FromJson(node!);
            _me.Hand[card.Cid] = card;
        }

        foreach (var node in payload["opponent"]!["hand"]!.AsArray())
        {
            _opponent.Hand[(int)node!["cid"]!] = null;
        }
    }

    private async Task ProcessGameAsync(CancellationToken ct)
    {
        if (!_yourTurn)
        {
            return;
        }

        // Play every affordable card into a free slot, in random order.
        foreach (var card in _me.Hand.Values.OfType<Card>().OrderBy(_ => Random.Shared.Next()).ToList())
        {
            if (_me.Mana < card.Cost)
            {
                continue;
            }

            var slot = Enumerable.Range(0, GamePlayer.BoardSlots).Cast<int?>().FirstOrDefault(s => _me.Board.Values.All(c => c.SlotId != s));
            if (slot is null)
            {
                break;
            }

            _me.Mana -= card.Cost;
            card.SlotId = slot.Value;
            _me.Hand.Remove(card.Cid);
            _me.Board[card.Cid] = card;
            await send(Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = card.Cid, ["slotId"] = slot.Value }));
        }

        await Task.Delay(options.ThinkDelay, ct);

        foreach (var card in _me.Board.Values.ToList())
        {
            var attackHero = Random.Shared.Next(0, 200) > 175 || _opponent.Board.Count == 0;
            if (!attackHero)
            {
                var target = _opponent.Board.Values.ElementAt(Random.Shared.Next(_opponent.Board.Count));
                await send(Message.Create(GameRequest.Attack, new JsonObject { ["source"] = card.Cid, ["target"] = target.Cid, ["type"] = 0 }));
            }
            else if (_opponent.Health - card.Attack >= 1)
            {
                // The bot never lands the killing blow on the hero (original behaviour).
                await send(Message.Create(GameRequest.Attack, new JsonObject { ["source"] = card.Cid, ["target"] = -1, ["type"] = 1 }));
            }

            await Task.Delay(options.AttackDelay, ct);
        }

        _yourTurn = false;
        await send(Message.Create(GameRequest.NextTurn));
    }

    private static void ReadInfo(Side side, JsonNode? info)
    {
        if (info is null)
        {
            return;
        }

        side.Attack = ParseStat(info["attack"]);
        side.Health = ParseStat(info["health"]);
        side.Mana = ParseStat(info["mana"]);
    }

    private static int ParseStat(JsonNode? node) =>
        int.TryParse(node?.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : 0;

    /// <summary>Applies one side of an attack result. Results without a card id describe the hero.</summary>
    private static void ApplyAttackResult(Side side, JsonNode result)
    {
        var health = (int?)result["health"] ?? 0;
        var isDead = (bool?)result["isDead"] ?? false;
        if (result["cid"] is { } cidNode)
        {
            var cid = (int)cidNode;
            if (isDead)
            {
                side.Board.Remove(cid);
            }
            else if (side.Board.TryGetValue(cid, out var card))
            {
                card.Health = health;
            }
        }
        else
        {
            side.Health = health;
        }
    }

    /// <summary>Applies an ability result; the server sends the resulting stats as the parameter.</summary>
    private void ApplyAbility(JsonNode payload)
    {
        var side = (bool?)payload["wasOpponent"] == true ? _opponent : _me;
        var abilityId = (int?)payload["abilityId"];
        var type = (int?)payload["type"];
        var source = (int?)payload["source"] ?? 0;
        var target = (int?)payload["target"] ?? 0;
        var stats = payload["parameter"]?.ToString().Split(':').Select(s => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0).ToArray() ?? [];

        if (abilityId == Model.Entities.Ability.Sacrifice)
        {
            side.Board.Remove(source);
        }

        var targetsCard = (abilityId == Model.Entities.Ability.Heal && type == 0) || (abilityId == Model.Entities.Ability.Sacrifice && type == 1);
        if (targetsCard && side.Board.TryGetValue(target, out var card))
        {
            card.Health = stats.ElementAtOrDefault(0);
            if (stats.Length > 1)
            {
                card.Attack = stats[1];
            }
        }
        else if (!targetsCard && stats.Length > 0)
        {
            side.Health = stats[0];
            if (stats.Length > 1)
            {
                side.Attack = stats[1];
            }
        }
    }
}
