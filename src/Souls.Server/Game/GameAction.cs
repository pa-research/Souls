using System.Text.Json.Nodes;
using Souls.Server.Network;

namespace Souls.Server.Game;

public enum GameActionKind
{
    UseCard,
    Attack,
    UseAbility,
    HeroPower,
}

/// <summary>
/// An action on a player's turn as the engine applies it: read from a request once at the edge (<see cref="From"/>),
/// or made directly by the bot's lookahead, which never needs JSON for the moves it only tries.
/// <list type="bullet">
/// <item><see cref="GameActionKind.UseCard"/>: <see cref="Source"/> the card's cid, <see cref="Slot"/> for a card (-1
/// none), <see cref="Type"/> and <see cref="Target"/> for a spell (-1 none).</item>
/// <item><see cref="GameActionKind.Attack"/>: <see cref="Source"/> and <see cref="Target"/> cids, <see cref="Type"/>
/// 0 card on card, 1 card on hero, 2 hero on card, 3 hero on hero.</item>
/// <item><see cref="GameActionKind.UseAbility"/>: <see cref="Source"/> the board card, <see cref="Type"/> a
/// <see cref="TargetType"/>, <see cref="Target"/> a cid.</item>
/// <item><see cref="GameActionKind.HeroPower"/>: <see cref="Type"/> and <see cref="Target"/>.</item>
/// </list>
/// </summary>
public readonly record struct GameAction(GameActionKind Kind, int Source = -1, int Target = -1, int Type = -1, int Slot = -1)
{
    public static GameAction Play(int cid, int slot) => new(GameActionKind.UseCard, cid, Slot: slot);

    public static GameAction Cast(int cid, TargetType? type = null, int target = -1) => new(GameActionKind.UseCard, cid, target, type is { } t ? (int)t : -1);

    public static GameAction Attack(int source, int target, int type) => new(GameActionKind.Attack, source, target, type);

    public static GameAction Ability(int source, TargetType type, int target) => new(GameActionKind.UseAbility, source, target, (int)type);

    public static GameAction Power(TargetType type, int target) => new(GameActionKind.HeroPower, Target: target, Type: (int)type);

    /// <summary>The action of a request (its required fields missing: <see cref="ProtocolException"/>).</summary>
    public static GameAction From(GameRequest request, Message message) => request switch
    {
        GameRequest.UseCard => new(GameActionKind.UseCard, message.GetInt("cid"), Optional(message, "target"), Optional(message, "type"), Optional(message, "slotId")),
        GameRequest.Attack => Attack(message.GetInt("source"), message.GetInt("target"), message.GetInt("type")),
        GameRequest.UseAbility => new(GameActionKind.UseAbility, message.GetInt("source"), message.GetInt("target"), message.GetInt("type")),
        GameRequest.HeroPower => new(GameActionKind.HeroPower, Target: Optional(message, "target"), Type: message.Payload["type"] is null ? (int)TargetType.OwnHero : message.GetInt("type")),
        _ => throw new ProtocolException($"Not an action: {request}"),
    };

    /// <summary>The request a client (or the bot) sends for this action.</summary>
    public Message ToMessage() => Kind switch
    {
        GameActionKind.UseCard when Slot >= 0 => Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = Source, ["slotId"] = Slot }),
        GameActionKind.UseCard when Type >= 0 => Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = Source, ["target"] = Target, ["type"] = Type }),
        GameActionKind.UseCard => Message.Create(GameRequest.UseCard, new JsonObject { ["cid"] = Source }),
        GameActionKind.Attack => Message.Create(GameRequest.Attack, new JsonObject { ["source"] = Source, ["target"] = Target, ["type"] = Type }),
        GameActionKind.UseAbility => Message.Create(GameRequest.UseAbility, new JsonObject { ["source"] = Source, ["target"] = Target, ["type"] = Type }),
        _ => Message.Create(GameRequest.HeroPower, new JsonObject { ["target"] = Target, ["type"] = Type }),
    };

    private static int Optional(Message message, string name) => message.Payload[name] is null ? -1 : message.GetInt(name);
}
