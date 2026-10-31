define('chatService', ["messages", "asset", "hud"], function (Message, Asset, Hud) {

    var that;
    var L10n = window.SoulsL10n;
    var T = L10n.t;
    ChatService = function (engine) {
        console.log("> Chat loaded!");
        that = this;
        this.engine = engine;
        this.socket = this.engine.chatSocket;

        // Create what is needed for the network to work
        this.responseAction = new Object();
        this.networkBuffer = ChatService.prototype.networkBuffer = new Array();
        this.message = Message;

        // Response callbacks
        this.RegisterResponseAction([1004], Response_NewGameRoom);
        this.RegisterResponseAction([1003], Response_Message);
        this.RegisterResponseAction([1095], Response_ClientDisconnected);
        this.RegisterResponseAction([1094], Response_ClientConnected);
        this.RegisterResponseAction([1093], Response_GetAttendees)

    };
    ChatService.prototype.constructor = ChatService;

    ChatService.prototype.Login = function () {
        this.socket.send(this.message.CHAT.CHAT_LOGIN);

    }


    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    ////////////////////////////CHAT-RESPONSES////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    // Chat text comes from other players: always insert it as text, never as HTML.
    function AppendLine(text, server) {
        if (!that.list) return;
        var item = Hud.El('li', server ? 'turn' : '', that.list);
        item.appendChild(Hud.Icon(server ? 'info' : 'chat'));
        Hud.El('span', '', item, text);
        while (that.list.childNodes.length > 200) that.list.removeChild(that.list.firstChild);
        that.list.scrollTop = that.list.scrollHeight;
        if (that.panel.classList.contains('collapsed')) {
            that.unread++;
            that.badge.textContent = String(that.unread);
        }
    }

    function Response_NewGameRoom(json) {
        AppendLine("[" + json.Payload.name + "]: " + L10n.text(json.Payload, 'message'));
        that.room = json.Payload.chRoomId;
    }

    function Response_Message(json) {
        AppendLine("[" + json.Payload.name + "]: " + L10n.text(json.Payload, 'message'));
        Asset.GetSound(Asset.Sound.EMOTE).play({ volume: 0.45 });
    }

    function Response_ClientDisconnected(json) // 1095
    {
        AppendLine(L10n.text(json, 'Payload'), true);
    }

    function Response_ClientConnected(json) // 1094
    {
        AppendLine(T('classic.chat.connected', { name: json.Payload.name }), true);
        that.room = json.Payload.room;
        that.GetAttendees(json.Payload.room);
    }

    function Response_GetAttendees(json) // 1093
    {
        var names = [];
        for (var key in json.Payload) names.push(String(json.Payload[key]));
        if (that.members) that.members.textContent = names.length ? T('classic.chat.members', { names: names.join(' · ') }) : '';
    }



    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////CHAT-REQUESTS///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////

    ChatService.prototype.RequestNewGameRoom = function () {
        var json = that.message.CHAT.NEWGAMEROOM;
        this.socket.send(json);
    };

    ChatService.prototype.RequestInvite = function () {

    };

    ChatService.prototype.RequestKick = function () {

    };

    ChatService.prototype.Message = function (roomId, msg) // 1002
    {
        var json = this.message.CHAT.MESSAGE;

        json.Payload.room = roomId;
        json.Payload.message = msg;


        this.Send(json);

        // Also get room attendees (update)
        this.GetAttendees(roomId);
    }

    ChatService.prototype.GetAttendees = function (roomId) // 1010
    {
        var json = this.message.CHAT.CHAT_LIST_ATTENDEES;

        json.Payload.room = roomId;

        this.Send(json);
    }



    /// The chat: a collapsed panel in the bottom right corner of the board, built like the battle log
    /// (css/game-hud.css) with an unread count. Enter sends, Shift+Enter starts a new line.
    ChatService.prototype.OpenChatWindow = function () {
        var that = this;
        var panel = this.panel = Hud.El('section', 'sg-log souls-classic-chat collapsed', Hud.Root());
        panel.setAttribute('aria-label', T('classic.chat'));
        var head = Hud.El('button', 'sg-log-head', panel);
        head.type = 'button';
        head.setAttribute('aria-expanded', 'false');
        head.appendChild(Hud.Icon('chat'));
        Hud.Text(head, T('classic.chat'));
        this.badge = Hud.El('span', 'sg-log-badge', head);
        head.appendChild(Hud.Icon('chevron-down', 's-icon sg-chevron'));
        this.list = Hud.El('ol', 'sg-log-list', panel);
        this.list.setAttribute('aria-live', 'polite');
        this.members = Hud.El('div', 'souls-classic-chat-members', panel);
        var input = Hud.El('textarea', 'souls-classic-chat-input', panel);
        input.rows = 1;
        input.maxLength = 500;
        input.placeholder = T('classic.chat.placeholder');
        input.setAttribute('aria-label', T('classic.chat.message'));
        this.unread = 0;

        head.addEventListener('click', function () {
            var open = !panel.classList.toggle('collapsed');
            head.setAttribute('aria-expanded', String(open));
            that.unread = 0;
            that.badge.textContent = '';
            if (open) {
                that.list.scrollTop = that.list.scrollHeight;
                input.focus({ preventScroll: true });
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            e.preventDefault();
            var text = input.value.trim();
            if (text && that.room !== undefined) that.Message(that.room, text);
            input.value = '';
        });
    };


    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    //NETWORKBASEHERPDERPFUCKINHERITANCE.
    ////////////////////////////////////////////////////////////////
    ChatService.prototype.RegisterResponseAction = function (responseArray, func) {
        for (var response in responseArray) {
            this.responseAction[responseArray[response]] = func;
        }
    }

    ChatService.prototype.GetResponseAction = function (responseId) {
        if (!this.responseAction[responseId]) {
            console.log("Could not find RESPONSE!" + responseId)

        }
        return this.responseAction[responseId];
    }


    ChatService.prototype.Process = function () {
        if (ChatService.prototype.networkBuffer.length > 0) {
            // Get a packet
            var packet = ChatService.prototype.networkBuffer.shift();

            if (!!this.GetResponseAction(packet.Type))
                this.GetResponseAction(packet.Type)(packet);
        }

    }

    ChatService.prototype.Send = function (json) {
        this.socket.send(json);
    }

    ChatService.prototype.Connect = function () {
        this.socket.connect();

        // Recieves all Data from server
        this.socket.onMessage(ChatService.prototype.TrafficHandler);
    }


    ChatService.prototype.TrafficHandler = function (json) {
        ChatService.prototype.networkBuffer.push(window.SoulsL10n.localizeMessage(JSON.parse(json.data)));
    }









    return ChatService;
});