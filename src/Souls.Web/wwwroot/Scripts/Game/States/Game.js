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
    'audio',
    'turntimer',
    'tooltip',
    'battlelog'], function ($, stopwatch, State, Player, Opponent, Conf, GameService, Background, CardSlots, ChatService, Socket, Pixi, ToolBox, CreateJS, _, Queue, Audio, TurnTimer, Tooltip, BattleLog) {

        var that;
        /// normalGame: ranked match (true) or practice against the bot (false); difficulty: 0 easy, 1 normal, 2 hard.
        Engine = function (normalGame, difficulty) {
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
            this.addGroup("Audio");

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

            // Objects
            this.player = null//new Player(this);
            this.opponent = null//new Opponent(this);
            this.background = new Background(this);
            this.audio = new Audio(this);
            this.queue = new Queue(this);
            this.turnTimer = new TurnTimer(this);
            this.tooltip = new Tooltip(this);
            this.battleLog = new BattleLog();

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
            this.addChild("EndTurn", this.turnTimer);

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
            if (this.player) {
                this.player.holdingCard = undefined;
                this.player.isClicked = false;
                if (this.player.heroPower) this.player.heroPower.interactive = false;
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
            var sides = [this.player, this.opponent];
            for (var i = 0; i < sides.length; i++) {
                var side = sides[i];
                if (!side) continue;
                side.cardManager.Clear();
                if (side.heroPower && side.heroPower.parent) side.heroPower.parent.removeChild(side.heroPower);
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

        Engine.prototype.AudioButton = function () {


        }


        Engine.prototype.Process = function () {
            this.gameService.Process();
            this.chatService.Process();

            $.each(this.ProcessList, function (index, object) {
                object.Process();
            });

            if (this.opponent && this.opponent.heroPower) this.opponent.heroPower.Process();
            this.turnTimer.Process();
            this.tooltip.Update();

            return this.stage;
        };



        // Afunction which displays a fadeinout text on the screen
        // https://api.jquery.com/animate/

        /// <signature>
        /// <summary>Function summary 1.</summary>
        /// <param name="messageArray" type="array">A array of words/sentances</param>
        /// <param name="forever" type="bool">Decides if the function should run permanently (until closed by callback)</param>
        /// <param name="callback" type="array">callback returns intervalId and round count</param>
        /// <returns type="void" />
        /// </signature>
        Engine.prototype.ScreenMessage = function (messageArray, forever, callback) {

            var msg = messageArray.shift();
            if (forever) messageArray.push(msg);

            var flashText = new Pixi.Text(String(msg === undefined || msg === null || msg === '' ? ' ' : msg),
            {
                font: "70px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4
            });


            flashText.anchor = { x: 0.5, y: 0.5 };
            flashText.position.x = that.conf.width / 2;
            flashText.position.y = that.conf.height / 2;
            flashText.alpha = 0;
            flashText.forever = forever;
            flashText.message = messageArray;
            flashText.countTo = messageArray.length;
            var group = that.getGroup("Text")
            group.addChild(flashText);

            var loopFlag = true;
            var roundCount = 0;
            var round = 0;
            var intervalId = setInterval(function () {
                if (flashText.alpha < 1 && loopFlag) {
                    flashText.alpha += 0.1;
                    if (flashText.alpha > 1) {
                        loopFlag = false;

                    }
                }

                else if (flashText.alpha > 0 && !loopFlag) {
                    flashText.alpha -= 0.1;
                    if (flashText.alpha < 0) {
                        loopFlag = true;

                        if (messageArray.length != 0) {
                            var msg = messageArray.shift();
                            flashText.setText(msg);
                            if (!!forever) {
                                messageArray.push(flashText.text)
                                if (roundCount++ % messageArray.length == 0) round++; // Increment round
                                if (!!callback) callback(intervalId, round)
                            }

                        }

                        if (messageArray.length == 0) {

                            group.removeChild(flashText);
                            clearInterval(intervalId);
                        }
                    }
                }
            }, 100);
        }

        return Engine;
    });