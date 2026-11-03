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

        // Toolbox - Seperated (Important and core stuff)
        "asset": "Toolbox/AssetLoader",
        "socket": "Client/Socket",
        "messages": "Client/Messages",
        "rules": "Client/Rules",


        // States
        "state": "States/State", // Abstract state class which everything should extend
        "game": "States/Game",

        // Networking
        "gameService": "Networking/GameService",
        "chatService": "Networking/ChatService",
        "eventPlayer": "Networking/EventPlayer",


        // Objects
        //// Animation
        "animation": "Objects/Animation/Animation",
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
        "heropower": "Objects/Player/HeroPower"
    },
    shim: {
        'pixi': {
            exports: 'PIXI'
        },
        // TweenJS defines window.createjs (Tween, Ease); the game loop below moves the tweens on.
        'tweenjs': {
            exports: 'createjs'
        },
        'game': {
            deps: ['asset']
        }
    }
});


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
require(['pixi', 'tweenjs', 'asset', 'conf', 'game', 'hud', 'menu', 'audio'], function (Pixi, CreateJS, Asset, Conf, Game, Hud, Menu, Sound) {

    // The stage on screen: the menu backdrop, or the game's stage once a game runs. The renderer and the running game
    // are globals (window.renderer, window.gameEngine): the e2e tests read them.
    var stage;

    function Initialize() {
        // Create a stage and the renderer
        stage = new Pixi.Stage(0x000000, true);

        var textureBg = Pixi.Texture.fromImage("/Content/Images/bg_faded.jpg");
        var backdrop = new Pixi.Sprite(textureBg);
        backdrop.anchor = { x: 0, y: 0 }
        backdrop.x = 0;
        backdrop.y = 0;
        backdrop.width = Conf.width;
        backdrop.height = Conf.height;
        stage.addChild(backdrop);

        // No multisampling (antialias, the last argument): with a multisampled drawing buffer, hardware GL now and then
        // (about 1 frame in 2000) lost the first draw of a frame, the arena picture, which showed a frame of the bare
        // stage colour under everything else. The 1920 x 1080 stage is scaled to the window, which smooths it anyway.
        window.renderer = new Pixi.autoDetectRenderer(Conf.width, Conf.height, null, false, false);

        var gameWindow = document.getElementById("game-window").cloneNode(false);
        gameWindow.appendChild(renderer.view);

        document.querySelectorAll(".page-wrapper").forEach(function (el) { el.remove(); });
        document.body.appendChild(gameWindow);

        // Deactivate right click menu
        window.addEventListener('contextmenu', function (evt) {
            evt.preventDefault();
        });

        // The interface (loading screen, menu, HUD) is a DOM overlay laid over the canvas.
        Hud.Init(renderer.view);
        var loading = Menu.ShowLoading();

        // Preload all assets; the menu (or the game) starts once the textures and the sounds are done.
        var texturePercent = 0, soundPercent = 0, texturesLoaded = false, soundsLoaded = false;
        function Progress() {
            loading.SetProgress(((texturesLoaded ? 100 : texturePercent) + (soundsLoaded ? 100 : soundPercent)) / 200);
            if (texturesLoaded && soundsLoaded) Loaded(loading);
        }
        Asset.PreLoad(
            function (percent) {
                console.log("[AssetLoader]: Status " + percent * 100);
                texturePercent = percent * 100;
                Progress();
            },
            function () {
                texturesLoaded = true;
                Progress();
            });
        // Load all sound into memory (Asset.Sound)
        Sound.Apply(); // sound on / off as the player left it
        Asset.LoadSound(
            function (percent) {
                soundPercent = percent;
                Progress();
            },
            function () {
                soundsLoaded = true;
                Progress();
            });

        // Fire onResize after init stuff
        OnResize();

        // GameLoop. TweenJS has no ticker of its own here: each frame moves the tweens on by the time that passed.
        var lastFrame = performance.now();
        setInterval(function () {
            var now = performance.now();
            CreateJS.Tween.tick(now - lastFrame);
            lastFrame = now;
            if (window.gameEngine) stage = window.gameEngine.Process();
            renderer.render(stage);
        }, 1000 / Conf.FPS);

        // Running keepalive each minute
        setInterval(KeepAlive, 60000);

    }

    var started = false;
    /// Everything is loaded: the menu, or straight into a game.
    function Loaded(loading) {
        if (started) return;
        started = true;
        console.log("Everything is loaded...")
        loading.Close();
        // After switching from the 3D client mid-game, go straight back into the running game.
        var resume = window.SoulsGameMode ? window.SoulsGameMode.resume() : null;
        // A challenge link (/Game?challenge=name) goes straight to the friendly challenge.
        var challenge = new URLSearchParams(window.location.search).get('challenge');
        if (resume) window.gameEngine = new Game(resume.normal, ReadDifficulty(), true);
        else if (challenge) window.gameEngine = new Game(false, ReadDifficulty(), false, { challenge: challenge });
        else ShowGameSelect(); // Show the MENU
    }

    // Practice difficulty (0 easy, 1 normal, 2 hard), remembered in this browser (shared with the 3D client).
    var DIFFICULTY_KEY = 'souls.difficulty';
    function ReadDifficulty() {
        var value = parseInt(Hud.ReadStorage(DIFFICULTY_KEY), 10);
        return value >= 0 && value <= 2 ? value : 1;
    }
    function WriteDifficulty(value) {
        Hud.WriteStorage(DIFFICULTY_KEY, String(value));
    }

    /// The main menu (DOM, see Objects/Environment/Menu.js) over the backdrop.
    function ShowGameSelect() {
        Asset.PlayMusic(Asset.Music.MENU, 0.4);
        stage = new Pixi.Stage(0x000000, true);

        var textureBg = Asset.GetTexture(Asset.Textures.GAME_LOAD_BG);
        var backdrop = new Pixi.Sprite(textureBg);
        backdrop.anchor = { x: 0, y: 0 }
        backdrop.x = 0;
        backdrop.y = 0;
        backdrop.width = Conf.width;
        backdrop.height = Conf.height;
        stage.addChild(backdrop);

        var chosen = false;
        function Start(normal, difficulty, friendly) {
            if (chosen) return;
            chosen = true;
            menu.Close();
            window.gameEngine = new Game(normal, difficulty, false, friendly);
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
        var navbar = document.querySelector(".navbar");
        var width = document.documentElement.clientWidth;
        var height = document.documentElement.clientHeight - (navbar ? navbar.offsetHeight : 0);
        var scale = Math.min(width / Conf.width, height / Conf.height);

        renderer.view.style.width = Math.round(Conf.width * scale) + "px";
        renderer.view.style.height = Math.round(Conf.height * scale) + "px";

        Hud.Layout();
    }

    // Keeps the (sliding) login cookie alive while playing.
    function KeepAlive() {
        fetch('/Player/KeepAlive').then(function (r) { return r.json(); }).then(function (data) {
            if (!data.authenticated) {
                console.log('[KEEPALIVE]: not logged in');
            }
        }).catch(function () { });
    }

    // Run the game
    Initialize();
    window.addEventListener('resize', OnResize);
});
