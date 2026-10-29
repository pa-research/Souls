// WebSocket connection speaking the Souls protocol: {"Type": n, "Payload": {...}}.

export const Request = {
    LOGIN: 0, LOGOUT: 1, HEARTBEAT: 2,
    QUEUE_NORMAL: 100, QUEUE_PRACTICE: 101,
    ATTACK: 200, USECARD: 201, MOVE_CARD: 203, RELEASE_CARD: 204, USE_ABILITY: 205, HERO_POWER: 206, NEXT_TURN: 226,
    LIST_LIVE_GAMES: 240, SPECTATE: 241, STOP_SPECTATING: 242,
    CHAT_MESSAGE: 1002, CHAT_NEWGAMEROOM: 1009, CHAT_LIST: 1010,
};

export const Response = {
    LOGIN_OK: 10, LOGIN_NO_HASH: 11, LOGIN_WRONG_HASH: 12, LOGIN_NOT_LOGGED_IN: 13, LOGIN_BANNED: 14, ERROR: 98,
    QUEUE_OK: 100, QUEUE_ALREADY_IN: 101,
    NOT_YOUR_TURN: 202, GAME_CREATE: 206, USECARD_OK: 207, USECARD_OOM: 208, OPPONENT_MOVE: 209,
    OPPONENT_RELEASE: 210, OPPONENT_USECARD_OK: 211, RELEASE: 212, SLOT_OCCUPIED: 213, ATTACK: 218,
    RECOVER: 220, NEWCARD: 222, OPPONENT_NEWCARD: 223, NEXT_TURN: 226,
    VICTORY: 230, DEFEAT: 231, GENERAL_MESSAGE: 232, DRAW: 233, USE_ABILITY: 234, GAME_EVENTS: 235, GAME_SYNC: 236,
    LIVE_GAMES: 240, SPECTATE_START: 241, SPECTATE_END: 242, SPECTATE_ERROR: 243,
    CHAT_MESSAGE: 1003, CHAT_ROOM_MADE: 1004, CHAT_LIST_MEMBERS: 1093, CHAT_CLIENT_CONNECT: 1094, CHAT_CLIENT_DISCONNECT: 1095,
};

export class Socket {
    constructor(url, onMessage, onClose) {
        this.url = url;
        this.onMessage = onMessage;
        this.onClose = onClose;
        this.queue = [];
        this.ws = null;
    }

    connect() {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => this.flush();
        this.ws.onmessage = e => {
            let message;
            try { message = JSON.parse(e.data); } catch (err) { return; }
            this.onMessage(message);
        };
        this.ws.onclose = e => this.onClose && this.onClose(e);
    }

    send(type, payload = {}) {
        this.queue.push(JSON.stringify({ Type: type, Payload: payload }));
        this.flush();
    }

    flush() {
        while (this.ws && this.ws.readyState === WebSocket.OPEN && this.queue.length > 0) {
            this.ws.send(this.queue.shift());
        }
    }
}
