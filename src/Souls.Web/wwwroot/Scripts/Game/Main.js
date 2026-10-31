//Tutorials RequireJS: http://javascriptplayground.com/blog/2012/07/requirejs-amd-tutorial-introduction/
//http://www.sitepoint.com/understanding-requirejs-for-effective-javascript-module-loading/

require.config({
    // No load timeout: on a slow device or network the modules arrive late rather than never (RequireJS gives up
    // after 7 seconds by default, which leaves the client on a blank screen).
    waitSeconds: 0,
    //baseUrl: "Scripts/GamePLS",
    paths: {
        // Third party
        "pixi": "/Scripts/Game/Vendor/pixi.dev", // PIXI.js
        "tweenjs": "/Scripts/Game/Vendor/tweenjs-0.5.1.min",
        "easeljs": "/Scripts/Game/Vendor/easeljs-0.7.1.min",
        "soundjs": "/Scripts/Game/Vendor/soundjs-0.5.2.min",

        "stats": "/Scripts/Game/Vendor/stats.min",
        "stopwatch": "/Scripts/Game/Vendor/stopwatch",

        // Toolbox - General Tools
        "toolbox": "Toolbox/Toolbox",
        "toolbox_rectangle": "Toolbox/Rectangle",

        // Toolbox - Seperated (Important and core stuff)
        "asset": "Toolbox/AssetLoader",
        "socket": "Client/Socket",
        "messages": "Client/Messages",
        "rules": "Client/Rules",


        // States
        "state": "States/State", // Abstract state class which everything should extend
        "gamestate": "States/GameState",
        "game": "States/Game",

        // Networking
        "gameService": "Networking/GameService",
        "chatService": "Networking/ChatService",
        "networkBase": "Networking/NetworkBase",
        "eventPlayer": "Networking/EventPlayer",


        // Objects
        //// Animation
        "animation": "Objects/Animation/Animation",
        "iAnimation": "Objects/Animation/AnimationInterface",
        //// Card
        "card": "Objects/Card/Card",
        "cardtype": "Objects/Card/CardType",
        "cardslot": "Objects/Card/CardSlot",
        "cardmanager": "Objects/Card/CardManager",
        //// Environment
        "background": "Objects/Environment/Background",
        "endturnbutton": "Objects/Environment/EndTurnButton",
        "queue": "Objects/Environment/Queue",
        "mulligan": "Objects/Environment/Mulligan",
        "audio": "Objects/Environment/AudioButton",
        "settings": "Objects/Environment/Settings",
        "turntimer": "Objects/Environment/TurnTimer",
        "tooltip": "Objects/Environment/Tooltip",
        "battlelog": "Objects/Environment/BattleLog",
        "hud": "Objects/Environment/Hud",
        "menu": "Objects/Environment/Menu",
        "emotes": "Objects/Environment/Emotes",
        //// Player
        "player": "Objects/Player/Player",
        "playerbase": "Objects/Player/PlayerBase",
        "arrow": "Objects/Player/Arrow",
        "opponent": "Objects/Player/Opponent",
        "heropower": "Objects/Player/HeroPower",
        // Other
        "chat": "Objects/Chat"


    },
    shim: {
        'pixi': {
            exports: 'PIXI'
        },
        'easeljs': {
            exports: 'createjs'
        },
        'tweenjs': {
            deps: ['easeljs'],
            exports: 'Tween'
        },
        'game': {
            deps: ['asset']
        }




    }
});


// jQuery is loaded by the page (one shared instance); expose it as an AMD module.
define('jquery', [], function () { return window.jQuery; });

//This defines a global class "EngineConf" for the whole application. This is specifically targetet to the Engine.X namespace.
// The server renders the settings (card portraits, WebSocket endpoint) into the page as JSON.
var Engine = {};
define('conf', ['cardtype', 'asset'], function (CardType, Asset) {

    var settings = JSON.parse(document.getElementById('souls-game-config').textContent);

    function Conf() {
        this.mouse = { x: -10000, y: -10000 };
        this.width = 1920;
        this.height = 1080;
        this.Frame = 0;
        this.FPS = 60;
        // wsBase is either absolute (wss://host/ws) or a path on this site (/ws).
        this.wsBase = settings.wsBase.charAt(0) === '/'
            ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + settings.wsBase
            : settings.wsBase;

        // Rules text and target kinds for tooltips and targeting (abilities, races, heroPowers, heroTypes,
        // keywords, deckSize, maxHandCards); see Client/Rules.js.
        this.rules = settings.rules || {};

        // The signed in player for the menu: {name, type, typeName, rating, rank, tier, tierCss, rankProgress,
        // money, quests: [{text, progress, target, reward, done}]}, or null.
        this.profile = settings.profile || null;

        settings.cards.forEach(function (value) {
            CardType.Portrait[value.id] = value.portrait;
            Asset.Textures[value.id] = value.portrait;
        });
    }

    return new Conf();
});


//Engine class
require(['jquery', 'pixi', 'asset', 'conf', 'gamestate', 'game', 'socket', 'stats', 'hud', 'menu', 'audio'], function ($, Pixi, Asset, Conf, Gamestate, Game, Socket, stats, Hud, Menu, Sound) {


    function Initialize() {
        // Create a stage and the renderer
        this.stage = new Pixi.Stage(0x000000, true);

        var textureBg = Pixi.Texture.fromImage("/Content/Images/bg_faded.png");
        var backdrop = new Pixi.Sprite(textureBg);
        backdrop.anchor = { x: 0, y: 0 }
        backdrop.x = 0;
        backdrop.y = 0;
        backdrop.width = Conf.width;
        backdrop.height = Conf.height;
        this.stage.addChild(backdrop);

        this.renderer = new Pixi.autoDetectRenderer(Conf.width, Conf.height, null, false, true);

        var gameWindow = $("#game-window").clone();
        gameWindow.html(this.renderer.view);

        $(".page-wrapper").remove();
        $("body").append(gameWindow);

        // Deactivate right click menu
        var blockContextMenu = function (evt) {
            evt.preventDefault();
        };

        // window = document.querySelector('#game-window');
        window.addEventListener('contextmenu', blockContextMenu);

        // The interface (loading screen, menu, HUD) is a DOM overlay laid over the canvas.
        Hud.Init(this.renderer.view);
        var loading = Menu.ShowLoading();


        // Set current state to LOAD
        Conf.currentState = Gamestate.LOADING;

        // Create the game engine
        this.gameEngine;


        this.isTextureLoaded = this.isSoundLoaded = false;
        this.texturePercent = this.soundPercent = 0

        var that = this;
        // Preload all assets
        Asset.PreLoad(
            function (percent) {
                console.log("[AssetLoader]: Status " + percent * 100);
                that.texturePercent = percent * 100;




            },
            function () {
                // OnComplete
                that.isTextureLoaded = true;

            });
        // Load all sound into memory (Asset.soundList)
        Sound.Apply(); // sound on / off as the player left it
        Asset.LoadSound(function (percent) { // On progress
            that.soundPercent = percent;
        },
        function () {
            // OnComplete
            that.isSoundLoaded = true;
        });

        var loadChecker = setInterval(function () {
            var textures = isTextureLoaded ? 100 : that.texturePercent;
            var sounds = isSoundLoaded ? 100 : that.soundPercent;
            loading.SetProgress((textures + sounds) / 200);


            if (isTextureLoaded && isSoundLoaded) {
                console.log("Everything is loaded...")
                loading.Close();
                // After switching from the 3D client mid-game, go straight back into the running game.
                var resume = window.SoulsGameMode ? window.SoulsGameMode.resume() : null;
                // A challenge link (/Game?challenge=name) goes straight to the friendly challenge.
                var challenge = new URLSearchParams(window.location.search).get('challenge');
                if (resume) {
                    gameEngine = new Game(resume.normal, ReadDifficulty(), true);
                    Conf.currentState = Gamestate.GAME;
                }
                else if (challenge) {
                    gameEngine = new Game(false, ReadDifficulty(), false, { challenge: challenge });
                    Conf.currentState = Gamestate.GAME;
                }
                else {
                    Conf.currentState = Gamestate.MENU;
                    ShowGameSelect(); // Show the MENU
                }

                clearInterval(loadChecker);
            }
        }, 50);


        // Frame time graph (stats.js), for development: add ?stats to the address to show it.
        var stats = { begin: function () { }, end: function () { } };
        if (/[?&]stats\b/.test(window.location.search)) {
            stats = new Stats();
            stats.setMode(1); // 0: fps, 1: ms

            // Align top-left
            stats.domElement.style.position = 'absolute';
            stats.domElement.style.left = '0px';
            stats.domElement.style.top = '0px';
            stats.domElement.style.zIndex = '30';
            document.body.appendChild(stats.domElement);
        }

        // Fire onResize after init stuff
        OnResize();

        // GameLoop
        setInterval(function () {
            stats.begin();
            GameLoop();
            stats.end();
        }, 1000 / Conf.FPS);

        // Running keepalive each minute
        setInterval(function () { KeepAlive() }, 60000);

    }

    // Practice difficulty (0 easy, 1 normal, 2 hard), remembered in this browser (shared with the 3D client).
    var DIFFICULTY_KEY = 'souls.difficulty';
    var OLD_DIFFICULTY_KEY = 'souls.practiceDifficulty';
    function ReadDifficulty() {
        try {
            var raw = window.localStorage.getItem(DIFFICULTY_KEY);
            if (raw === null) raw = window.localStorage.getItem(OLD_DIFFICULTY_KEY);
            var value = parseInt(raw, 10);
            if (value >= 0 && value <= 2) return value;
        } catch (e) { }
        return 1;
    }
    function WriteDifficulty(value) {
        try { window.localStorage.setItem(DIFFICULTY_KEY, String(value)); } catch (e) { }
    }

    /// The main menu (DOM, see Objects/Environment/Menu.js) over the backdrop.
    function ShowGameSelect() {
        Asset.PlayMusic(Asset.Music.MENU, 0.4);
        this.stage = new Pixi.Stage(0x000000, true);

        var textureBg = Asset.GetTexture(Asset.Textures.GAME_LOAD_BG);
        var backdrop = new Pixi.Sprite(textureBg);
        backdrop.anchor = { x: 0, y: 0 }
        backdrop.x = 0;
        backdrop.y = 0;
        backdrop.width = Conf.width;
        backdrop.height = Conf.height;
        this.stage.addChild(backdrop);

        var started = false;
        function Start(normal, difficulty, friendly) {
            if (started) return;
            started = true;
            menu.Close();
            gameEngine = new Game(normal, difficulty, false, friendly);
            Conf.currentState = Gamestate.GAME;
        }

        var menu = Menu.ShowMenu({
            profile: Conf.profile,
            difficulty: ReadDifficulty(),
            onDifficulty: WriteDifficulty,
            onRanked: function () { Start(true); },
            onPractice: function (difficulty) { Start(false, difficulty); },
            onFriendly: function (difficulty) { Start(false, difficulty, {}); }
        });
    }

    /// The stage keeps its 16:9 shape at any window size: as large as fits, centred, with the arena picture blurred in
    /// the bars beside or above it (Game.css). The HUD follows the canvas (Hud.Layout).
    function OnResize() {
        var width = $(window).width();
        var height = $(window).height() - $(".navbar").outerHeight();
        var scale = Math.min(width / Conf.width, height / Conf.height);

        this.renderer.view.style.width = Math.round(Conf.width * scale) + "px";
        this.renderer.view.style.height = Math.round(Conf.height * scale) + "px";

        Hud.Layout();
    }


    function GameLoop() {

        if (Conf.currentState == Gamestate.LOADING) {
            this.renderer.render(this.stage);
        }
        else if (Conf.currentState == Gamestate.MENU) {
            this.renderer.render(this.stage);
        }
        else if (Conf.currentState == Gamestate.GAME) {
            this.stage = this.gameEngine.Process();
            this.renderer.render(this.stage);
        }

        else if (Conf.currentState == Gamestate.NOT_SUPPORTED) {
            console.log("Not supported!");
        }
    }

    // Keeps the (sliding) login cookie alive while playing.
    function KeepAlive() {
        $.getJSON('/Player/KeepAlive').done(function (data) {
            if (!data.authenticated) {
                console.log('[KEEPALIVE]: not logged in');
            }
        });
    }

    // Run the game
    $(document).ready(Initialize());
    $(window).resize(OnResize);
});
