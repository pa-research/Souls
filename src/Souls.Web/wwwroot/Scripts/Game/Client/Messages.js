define('messages', ['conf'], function (Conf) {

    function Messages() {
        console.log("> Messages Loaded!");

        // Add the request tree
        this.Request = Messages.Request;
    }


    Messages.prototype.Type =
        {
            General: {
                LOGIN: 0,
                LOGOUT: 1,
                HEARTBEAT: 2
            },
            Game: {
                NORMAL_QUEUE: 100,
                PRACTICE_QUEUE: 101, // {difficulty: 0 easy, 1 normal, 2 hard}
                ATTACK: 200, // {source, target, type: 0 card->card, 1 card->hero, 2 hero->card, 3 hero->hero}
                USECARD: 201, // {cid, slotId}; a spell: {cid, target, type} as USE_ABILITY, or {cid} without a target
                NEXT_TURN: 226,
                MULLIGAN: 227, // {replace: [cid...]}: the starting hand cards to replace, once
                NOT_YOUR_TURN: 202,
                MOVE_CARD: 203,
                RELEASE_CARD: 204,
                USE_ABILITY: 205, // {source, target, type: 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card}
                HERO_POWER: 206, // {target, type} (same types as USE_ABILITY)
                LIST_LIVE_GAMES: 240,
                SPECTATE: 241,
                STOP_SPECTATING: 242
            },
            // Server to client (see docs/game-protocol.md)
            Response: {
                LOGIN_OK: 10,
                QUEUE_OK: 100,
                QUEUE_ALREADY_IN: 101,
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
                SPECTATE_ERROR: 243
            },
            Chat: {
                ENABLE: 1000,
                DISABLE: 1001,
                MESSAGE: 1002,
                NEWROOM: 1003,
                INVITE: 1004,
                KICK: 1005,
                LEAVE: 1006,
                NEWGAMEROOM: 1009,
                CHAT_LIST_ATTENDEES: 1010
            }
        }

    Messages.prototype.GENERAL =
        {
            LOGIN: {
                "Type": Messages.prototype.Type.General.LOGIN,
                "Payload": {
                }
            },
            LOGOUT: {
                "Type": Messages.prototype.Type.General.LOGOUT,
                "Payload": {
                }
            },
            HEARTBEAT: {
                "Type": Messages.prototype.Type.General.HEARTBEAT,
                "Payload": {
                    "heartbeat": 0,
                    "last": 0
                }
            }
        };

    Messages.prototype.GAME =
        {
            ATTACK: {
                "Type": Messages.prototype.Type.Game.ATTACK,
                "Payload": {
                    "source": undefined,
                    "target": undefined,
                    "type": -1
                }
            },
            USECARD: {
                "Type": Messages.prototype.Type.Game.USECARD,
                "Payload": {
                    "cid": undefined,
                    "slotId": undefined
                }
            },
            NEXT_TURN: {
                "Type": Messages.prototype.Type.Game.NEXT_TURN,
                "Payload": {
                }
            },
            NORMAL_QUEUE: {
                "Type": Messages.prototype.Type.Game.NORMAL_QUEUE,
                "Payload": {
                }
            },
            PRACTICE_QUEUE: {
                "Type": Messages.prototype.Type.Game.PRACTICE_QUEUE,
                "Payload": {
                    "difficulty": 1
                }
            },
            MOVE_CARD: {
                "Type": Messages.prototype.Type.Game.MOVE_CARD,
                "Payload": {
                    "gameId": undefined,
                    "cid": undefined,
                    "x": undefined,
                    "y": undefined
                }
            },
            RELEASE_CARD: {
                "Type": Messages.prototype.Type.Game.RELEASE_CARD,
                "Payload": {
                    "gameId": undefined,
                    "cid": undefined
                }
            },
            // 0 = friendly card, 1 = own hero, 2 = enemy hero, 3 = enemy card
            USE_ABILITY: {
                "Type": Messages.prototype.Type.Game.USE_ABILITY,
                "Payload": {
                    "source": undefined,
                    "target": undefined,
                    "type": -1
                }
            },
            // Same target types as USE_ABILITY; a power without target is sent as {target: -1, type: 1}
            HERO_POWER: {
                "Type": Messages.prototype.Type.Game.HERO_POWER,
                "Payload": {
                    "target": -1,
                    "type": 1
                }
            }
        };
    Messages.prototype.CHAT =
        {
            ENABLE: {
                "Type": Messages.prototype.Type.Chat.ENABLE,
                "Payload": {
                    "id": 0, /// TODO
                }
            },
            DISABLE: {
                "Type": Messages.prototype.Type.Chat.DISABLE,
                "Payload": {
                    "id": 0, //// TODO
                }
            },
            MESSAGE: {
                "Type": Messages.prototype.Type.Chat.MESSAGE,
                "Payload": {
                    "room": undefined,
                    "message": undefined
                }
            },
            NEWROOM: {
                "Type": Messages.prototype.Type.Chat.NEWROOM,
                "Payload": {
                }
            },
            NEWGAMEROOM: {
                "Type": Messages.prototype.Type.Chat.NEWGAMEROOM,
                "Payload": {
                    
                }
            },
            INVITE: {
                "Type": Messages.prototype.Type.Chat.INVITE,
                "Payload": {
                    "room": 0, ///// TODO
                    "name": "HanselDEMO", ///// TODO
                }
            },
            KICK: {
                "Type": Messages.prototype.Type.Chat.KICK,
                "Payload": {
                    "room": 0, //// TODO
                    "name": "HanselDEMO", //// TODO
                }
            },
            LEAVE: {
                "Type": Messages.prototype.Type.Chat.LEAVE,
                "Payload": {
                    "room": 0, ///// TODO
                }
            },
            CHAT_LOGIN: {
                "Type": Messages.prototype.Type.General.LOGIN,
                "Payload": {
                }
            },
            CHAT_LOGOUT: {
                "Type": Messages.prototype.Type.General.LOGOUT,
                "Payload": {
                }
            },
            CHAT_LIST_ATTENDEES: {
                "Type": Messages.prototype.Type.Chat.CHAT_LIST_ATTENDEES,
                "Payload": {
                    "room": undefined
                }
            }

        };




    return new Messages();
});