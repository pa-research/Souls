// The message types of the game and chat protocols (docs/game-protocol.md). A message is sent as a literal
// {Type, Payload}.
define('messages', [], function () {

    return {
        Type: {
            General: {
                LOGIN: 0,
                LOGOUT: 1,
                HEARTBEAT: 2
            },
            Game: {
                NORMAL_QUEUE: 100,
                PRACTICE_QUEUE: 101, // {difficulty: 0 easy, 1 normal, 2 hard}
                CHALLENGE_CANCEL: 197,
                CHALLENGE_ANSWER: 198, // {accept}
                CHALLENGE: 199, // {name}
                ATTACK: 200, // {source, target, type: 0 card->card, 1 card->hero, 2 hero->card, 3 hero->hero}
                USECARD: 201, // {cid, slotId}; a spell: {cid, target, type} as USE_ABILITY, or {cid} without a target
                NEXT_TURN: 226,
                MULLIGAN: 227, // {replace: [cid...]}: the starting hand cards to replace, once
                MOVE_CARD: 203,
                RELEASE_CARD: 204,
                USE_ABILITY: 205, // {source, target, type: 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card}
                HERO_POWER: 206, // {target, type} (same types as USE_ABILITY)
                LIST_LIVE_GAMES: 240,
                SPECTATE: 241,
                STOP_SPECTATING: 242,
                MUTE_EMOTES: 298, // {muted}
                EMOTE: 299 // {emote}
            },
            // Server to client (see docs/game-protocol.md)
            Response: {
                LOGIN_OK: 10,
                QUEUE_OK: 100,
                QUEUE_ALREADY_IN: 101,
                CHALLENGE_CLOSED: 197,
                CHALLENGE_SENT: 198,
                CHALLENGE_INVITE: 199,
                NOT_YOUR_TURN: 202,
                GAME_CREATE: 206,
                USECARD_OK: 207,
                USECARD_OOM: 208,
                OPPONENT_MOVE: 209,
                OPPONENT_RELEASE: 210,
                OPPONENT_USECARD_OK: 211,
                RELEASE: 212,
                SLOT_OCCUPIED: 213,
                RECOVER: 220,
                NEWCARD: 222,
                OPPONENT_NEWCARD: 223,
                USECARD_SPELL: 224, // {card, pInfo, target}: our spell left the hand and is cast
                OPPONENT_USECARD_SPELL: 225,
                NEXT_TURN: 226,
                MULLIGAN: 227,
                OPPONENT_MULLIGAN: 228,
                VICTORY: 230,
                DEFEAT: 231,
                GENERAL_MESSAGE: 232,
                DRAW: 233,
                GAME_EVENTS: 235,
                GAME_SYNC: 236,
                LIVE_GAMES: 240,
                SPECTATE_START: 241,
                SPECTATE_END: 242,
                SPECTATE_ERROR: 243,
                EMOTE: 299
            },
            Chat: {
                MESSAGE: 1002,
                NEWGAMEROOM: 1009,
                CHAT_LIST_ATTENDEES: 1010
            }
        }
    };
});
