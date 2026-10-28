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
                PRACTICE_QUEUE: 101,
                ATTACK: 200, // CARD CARD attack
                USECARD: 201,
                NEXT_TURN: 226,
                NOT_YOUR_TURN: 202,
                MOVE_CARD: 203,
                RELEASE_CARD: 204,
                USE_ABILITY: 205
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
            // Card on Card = 0
            // Card on Player = 1 (Friendly Player)
            // Card on Opponent = 2 (Opponent)
            USE_ABILITY: {
                "Type": Messages.prototype.Type.Game.USE_ABILITY,
                "Payload": {
                    "source": undefined,
                    "target": undefined,
                    "type": -1,
                    "abilityId" : undefined
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