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
    'audio'], function ($, stopwatch, State, Player, Opponent, Conf, GameService, Background, CardSlots, ChatService, Socket, Pixi, ToolBox, CreateJS, _, Queue, Audio) {

        var that;
        Engine = function (normalGame) {
            this.normalGame = normalGame;
            that = this;
            State.call(this, "0xCAECAE");
            console.log("> Game Class");
            // Variables
            this.gameId = undefined;
            this.conf = Conf;
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
            this.getGroup("EndTurn").visible = false;
            this.getGroup("Card-Opponent").visible = false;
            this.getGroup("Card-Player").visible = false;
            this.getGroup("Arrow").visible = false;
            this.getGroup("Card-Focus").visible = false;
            //this.getGroup("Queue");
            //this.getGroup("Text");
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

            var flashText = new Pixi.Text(msg,
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