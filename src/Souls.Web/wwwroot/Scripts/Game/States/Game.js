define("game",
    ["jquery",
     "stopwatch",
    "state",
    "player",
    "opponent",
    "conf",
    "gameService",
    "background",
    "cardslot",
    "chatService",
    "socket",
    "pixi",
    "toolbox",
    'easeljs',
    'tweenjs',
    'queue',
    'settings',
    'turntimer',
    'tooltip',
    'battlelog',
    'hud'], function ($, stopwatch, State, Player, Opponent, Conf, GameService, Background, CardSlots, ChatService, Socket, Pixi, ToolBox, CreateJS, _, Queue, Settings, TurnTimer, Tooltip, BattleLog, Hud) {

        var that;
        /// normalGame: ranked match (true) or practice against the bot (false); difficulty: 0 easy, 1 normal, 2 hard;
        /// resuming: going back into a running game (after switching from the 3D client).
        Engine = function (normalGame, difficulty, resuming) {
            this.normalGame = normalGame;
            this.difficulty = (difficulty >= 0 && difficulty <= 2) ? difficulty : 1;
            that = this;
            State.call(this, "0xCAECAE");
            // Variables
            this.gameId = undefined;
            this.conf = Conf;
            this.myIdent = undefined; // our hero ident (1/2) from GameCreate
            this.myTurn = false;
            this.ended = false;
            this.lastCardPos = {};
            this.castSpells = {}; // cid -> spell being cast (UseCardSpell) until the GameSync after it
            // Create Groups
            this.addGroup("Background");
            this.addGroup("EndTurn");
            this.addGroup("CardSlot-Opponent");
            this.addGroup("CardSlot-Player");
            this.addGroup("Card-Opponent");
            this.addGroup("Opponent");
            this.addGroup("Player");
            this.addGroup("Card-Player");
            this.addGroup("Arrow");
            this.addGroup("Card-Focus");
            this.addGroup("Attacker");
            this.addGroup("Player-Particles")
            this.addGroup("Effects"); // floating numbers, projectiles
            this.addGroup("Queue");
            this.addGroup("Text");

            // Set Default group Visibility to false (Is set to true on Response_GameCreate in GameService.js
            this.getGroup("Player").visible = false;
            this.getGroup("Opponent").visible = false;
            this.getGroup("EndTurn").visible = false;



            // The game server is reached on the same origin (/ws/*), routed by the reverse proxy / ingress.
            this.gameSocket = new Socket(Conf.wsBase + "/game");
            this.chatSocket = new Socket(Conf.wsBase + "/chat");

            

            // Tools etc
            this.toolbox = ToolBox;
            this.CreateJS = CreateJS;
            CreateJS.Ticker.setFPS(Conf.FPS);

            // Process array
            this.ProcessList = new Array();

            // Objects (the interface is a DOM overlay over the canvas, see Objects/Environment/Hud.js)
            this.hud = Hud;
            this.player = null//new Player(this);
            this.opponent = null//new Opponent(this);
            this.background = new Background(this);
            this.queue = new Queue(this, resuming);
            this.battleLog = new BattleLog();
            this.turnTimer = new TurnTimer(this);
            this.settings = new Settings(this);
            this.tooltip = new Tooltip(this);

            // Connect to the chat service
            this.chatService = new ChatService(this);
            this.chatService.OpenChatWindow(this);
            // Connect to the game service
            this.gameService = new GameService(this)



            this.OnStart();
        }

        // Create a object of the State prototype, then set the constructor to Game function.
        Engine.prototype = Object.create(State.prototype);
        Engine.prototype.constructor = Engine;


        Engine.prototype.OnStart = function () {
            this.background.Init();

            this.gameService.Connect();
            this.gameService.Login();
            this.chatService.Connect();
        }

        Engine.prototype.OnEnd = function () {
            this.ended = true;
            this.getGroup("EndTurn").visible = false;
            this.getGroup("Card-Opponent").visible = false;
            this.getGroup("Card-Player").visible = false;
            this.getGroup("Arrow").visible = false;
            this.getGroup("Card-Focus").visible = false;
            this.turnTimer.Stop();
            this.tooltip.Hide();
            this.settings.Hide();
            this.battleLog.Hide(); // the end screen is a full-screen layer
            if (this.player) {
                if (this.player.armedSpell) this.player.armedSpell.Disarm(false);
                this.player.holdingCard = undefined;
                this.player.isClicked = false;
            }
            // The end screen takes over: the hero powers and the status pills go.
            var sides = [this.player, this.opponent];
            for (var i = 0; i < sides.length; i++) {
                if (!sides[i]) continue;
                if (sides[i].heroPower) sides[i].heroPower.Hide();
                if (sides[i].status) sides[i].status.Hide();
            }
        }

        /// The pointer position in stage coordinates. Touch has no hover, so touch handlers set it themselves.
        Engine.prototype.SetPointer = function (global, touch) {
            if (!global) return;
            this.conf.mouse.x = global.x;
            this.conf.mouse.y = global.y;
            this.touchActive = !!touch;
        }

        /// Forgets the pointer (after a touch ends, so nothing stays highlighted).
        Engine.prototype.ClearPointer = function () {
            this.conf.mouse.x = -10000;
            this.conf.mouse.y = -10000;
        }

        /// Redraws the state badges of all cards and heroes (turn changes, sync).
        Engine.prototype.RefreshAll = function () {
            var sides = [this.player, this.opponent];
            for (var i = 0; i < sides.length; i++) {
                var side = sides[i];
                if (!side) continue;
                side.RefreshHud();
                for (var key in side.cardManager.board) side.cardManager.board[key].RefreshVisuals();
            }
        }

        /// Removes the heroes and cards (the game state is sent again after a reconnect).
        Engine.prototype.ClearBoard = function () {
            if (this.player && this.player.armedSpell) this.player.armedSpell.Disarm(false);
            for (var cid in this.castSpells) {
                if (this.castSpells[cid].parent) this.castSpells[cid].parent.removeChild(this.castSpells[cid]);
            }
            this.castSpells = {};
            var sides = [this.player, this.opponent];
            for (var i = 0; i < sides.length; i++) {
                var side = sides[i];
                if (!side) continue;
                side.cardManager.Clear();
                if (side.heroPower) side.heroPower.Destroy();
                if (side.Destroy) side.Destroy();
                if (side.arrow) {
                    side.arrow.Reset();
                    if (side.arrow.parent) side.arrow.parent.removeChild(side.arrow);
                    if (side.arrow.arrowHead.parent) side.arrow.arrowHead.parent.removeChild(side.arrow.arrowHead);
                    if (side.arrow.hint.parent) side.arrow.hint.parent.removeChild(side.arrow.hint);
                }
                if (side.parent) side.parent.removeChild(side);
            }
            this.ProcessList = [];
            this.player = null;
            this.opponent = null;
            this.lastCardPos = {};
        }

        Engine.prototype.OnPause = function () {


        }


        Engine.prototype.Process = function () {
            this.gameService.Process();
            this.chatService.Process();

            $.each(this.ProcessList, function (index, object) {
                object.Process();
            });

            this.turnTimer.Process();
            this.tooltip.Update();

            return this.stage;
        };



        /// <signature>
        /// <summary>Short messages ("Not enough mana!", "Not your turn!") as toasts above the player's hero.</summary>
        /// <param name="messageArray" type="array">A array of words/sentances</param>
        /// <param name="kind" type="string">"info" for a neutral message; anything else is a warning (errors)</param>
        /// <returns type="void" />
        /// </signature>
        Engine.prototype.ScreenMessage = function (messageArray, kind) {
            var list = Object.prototype.toString.call(messageArray) === '[object Array]' ? messageArray : [messageArray];
            for (var i = 0; i < list.length; i++) {
                var msg = list[i];
                if (msg === undefined || msg === null || String(msg) === '') continue;
                this.hud.Toast(String(msg), kind !== 'info');
            }
        }

        return Engine;
    });