using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Souls.Server.Network;

/// <summary>Thrown when a client sends a malformed message. The connection stays open.</summary>
public sealed class ProtocolException(string message) : Exception(message);

/// <summary>A message sent to a client: <c>{"Type": n, "Payload": ...}</c>.</summary>
public readonly record struct Response(int Type, JsonNode? Payload)
{
    public Response(Enum type, JsonNode? payload) : this(Convert.ToInt32(type, CultureInfo.InvariantCulture), payload)
    {
    }

    public string ToJson() => new JsonObject
    {
        ["Type"] = Type,
        ["Payload"] = Payload?.DeepClone(),
    }.ToJsonString();
}

/// <summary>A message received from a client: <c>{"Type": n, "Payload": {...}}</c>.</summary>
public sealed class Message(int type, JsonObject payload)
{
    private static readonly JsonDocumentOptions ParseOptions = new() { MaxDepth = 8 };

    public int Type { get; } = type;
    public JsonObject Payload { get; } = payload;

    public static Message Parse(string json)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(json, documentOptions: ParseOptions);
        }
        catch (JsonException)
        {
            throw new ProtocolException("Malformed JSON");
        }

        if (node is not JsonObject root)
        {
            throw new ProtocolException("Expected a JSON object");
        }

        var type = ReadInt(root["Type"]) ?? throw new ProtocolException("Missing message type");
        var payload = root["Payload"] as JsonObject ?? [];
        return new Message(type, payload);
    }

    public static Message Create(Enum type, JsonObject? payload = null) =>
        new(Convert.ToInt32(type, CultureInfo.InvariantCulture), payload ?? []);

    public int GetInt(string name) => ReadInt(Payload[name]) ?? throw new ProtocolException($"Missing or invalid '{name}'");

    /// <summary>An optional list of integers (empty when missing).</summary>
    public List<int> GetInts(string name) => Payload[name] switch
    {
        null => [],
        JsonArray items => [.. items.Select(i => ReadInt(i) ?? throw new ProtocolException($"Invalid '{name}'"))],
        _ => throw new ProtocolException($"Invalid '{name}'"),
    };

    public double GetDouble(string name)
    {
        var value = Payload[name] as JsonValue;
        if (value is not null && value.TryGetValue<double>(out var d) && double.IsFinite(d))
        {
            return d;
        }

        if (value is not null && value.TryGetValue<string>(out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d) && double.IsFinite(d))
        {
            return d;
        }

        throw new ProtocolException($"Missing or invalid '{name}'");
    }

    public string GetString(string name, int maxLength)
    {
        var value = Payload[name] as JsonValue;
        if (value is null || !value.TryGetValue<string>(out var s))
        {
            throw new ProtocolException($"Missing or invalid '{name}'");
        }

        return s.Length <= maxLength ? s : throw new ProtocolException($"'{name}' is too long");
    }

    private static int? ReadInt(JsonNode? node)
    {
        if (node is not JsonValue value)
        {
            return null;
        }

        if (value.TryGetValue<int>(out var i))
        {
            return i;
        }

        if (value.TryGetValue<double>(out var d) && d == Math.Floor(d) && d is >= int.MinValue and <= int.MaxValue)
        {
            return (int)d;
        }

        return value.TryGetValue<string>(out var s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out i) ? i : null;
    }
}

/// <summary>Responses shared by all services (0-99).</summary>
public enum ServiceResponse
{
    Disconnected = 1,
    HeartbeatReply = 5,
    LoginOk = 10,
    LoginNoHash = 11,
    LoginWrongHash = 12,
    LoginNotLoggedIn = 13,
    LoginBanned = 14,
    Error = 98,
    Debug = 99,
}

/// <summary>Requests shared by all services.</summary>
public enum ServiceRequest
{
    Login = 0,
    Logout = 1,
    Heartbeat = 2,
}

/// <summary>Game responses. QUEUE: 100-199, GAME: 200-299.</summary>
public enum GameResponse
{
    QueueOk = 100,
    QueueAlreadyIn = 101,
    QueueUnqueue = 102,
    QueueError = 103,

    GameUpdate = 201,
    GameNotYourTurn = 202,
    GameNextRoundFail = 203,
    GameAuthFail = 204,
    GameOpponentNoExist = 205,
    GameCreate = 206,
    GameUseCardOk = 207,
    GameUseCardOom = 208,
    GameOpponentMove = 209,
    GameOpponentRelease = 210,
    GameOpponentUseCardOk = 211,
    GameRelease = 212,
    GameUseCardOccupied = 213,
    GameOpponentAttack = 214,
    GameAttack = 218,
    GameRecover = 220,
    GameNewCard = 222,
    GameOpponentNewCard = 223,

    /// <summary>Your spell was cast: <c>{"card", "pInfo", "target": ref or null}</c>; it left your hand (events follow).</summary>
    GameUseCardSpell = 224,

    /// <summary>The opponent cast a spell, same payload as <see cref="GameUseCardSpell"/>.</summary>
    GameOpponentUseCardSpell = 225,
    GameNextTurn = 226,

    /// <summary>Your starting hand after the mulligan: <c>{"hand": [card...], "replaced": n}</c> (every card has a new cid).</summary>
    GameMulligan = 227,

    /// <summary>The opponent's starting hand after their mulligan: <c>{"hand": [{"cid"}...], "replaced": n}</c>.</summary>
    GameOpponentMulligan = 228,
    GameVictory = 230,
    GameDefeat = 231,
    GameGeneralMessage = 232,
    GameDraw = 233,
    GameUseAbility = 234,

    /// <summary>What happened, in order: <c>{"events": [{"t": "attack" | "damage" | "heal" | ...}]}</c>. Same for both players.</summary>
    GameEvents = 235,

    /// <summary>The full public state after an action (heroes and boards by ident, hand and deck sizes, turn timer).</summary>
    GameSync = 236,

    LiveGames = 240,
    SpectateStart = 241,
    SpectateEnd = 242,
    SpectateError = 243,

    GameBotDisconnect = 500,
}

/// <summary>Commands a game client sends.</summary>
public enum GameRequest
{
    QueueNormal = 100,

    /// <summary><c>{"difficulty": 0 easy, 1 normal, 2 hard}</c>.</summary>
    QueuePractice = 101,

    /// <summary>Subtypes: 0 = card on card, 1 = card on opponent, 2 = player on card, 3 = player on opponent.</summary>
    Attack = 200,

    /// <summary><c>{"cid", "slotId"}</c> plays a card; a spell is cast with <c>{"cid", "target", "type"}</c> as UseAbility (untargeted: <c>{"cid"}</c>).</summary>
    UseCard = 201,
    NotYourTurn = 202,
    MoveCard = 203,
    ReleaseCard = 204,
    UseAbility = 205,

    /// <summary><c>{"target": cid or -1, "type": 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card}</c>.</summary>
    HeroPower = 206,
    NextTurn = 226,

    /// <summary><c>{"replace": [cid...]}</c>: the starting hand cards to replace, once, while the mulligan runs.</summary>
    Mulligan = 227,

    ListLiveGames = 240,
    Spectate = 241,
    StopSpectating = 242,
}

/// <summary>Targets of abilities and hero powers.</summary>
public enum TargetType
{
    FriendlyCard = 0,
    OwnHero = 1,
    EnemyHero = 2,
    EnemyCard = 3,
}

public enum ChatResponse
{
    ChatEnabled = 1000,
    ChatDisabled = 1001,
    ChatMessage = 1003,
    ChatRoomMade = 1004,
    InvitedClient = 1005,
    KickedClient = 1006,
    LeftRoom = 1007,
    GotInvited = 1008,
    GotKicked = 1009,
    MadeLeader = 1010,
    ChatListMembers = 1093,
    ChatClientConnect = 1094,
    ChatClientDisconnect = 1095,
    ChatNotMember = 1096,
    NotLeader = 1097,
    ClientNotFound = 1098,
    ChatError = 1099,
}

public enum ChatRequest
{
    Enable = 1000,
    Disable = 1001,
    Message = 1002,
    NewRoom = 1003,
    Invite = 1004,
    Kick = 1005,
    Leave = 1006,
    ChatLogin = 1007,
    ChatLogout = 1008,
    NewGameRoom = 1009,
    ListClients = 1010,
}

public enum AdminRequest
{
    Login = 1,
    OnlineUsers = 2,
    OngoingGames = 3,
    EndGame = 4,
    BanUser = 5,
    KickUser = 6,
    Reset = 7,
}
