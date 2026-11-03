    define("asset", ["pixi"], function (Pixi) {

        function Asset() {
            console.log("> Asset class")
        }



        Asset.Path =
        {
            Textures: "/Content/Images/",
            Sound: "/Content/Sound/"
        }

        // Texture URLs that could not be loaded (a missing portrait): the cards show a fallback instead.
        var broken = {};

        function ImageOf(texture) {
            var base = texture && texture.baseTexture;
            return base && base.source && base.source.tagName === 'IMG' ? base.source : null;
        }

        /// Loads every texture. A texture that fails (404) counts as done, so a missing card portrait cannot keep
        /// the game on the loading screen (Pixi's own AssetLoader waits for it forever).
        Asset.prototype.PreLoad = function (onProgressCallback, onCompleteCallBack) {

            var contentArray = new Array();
            var seen = {};
            for (var key in Asset.prototype.Textures) {
                if (Asset.prototype.Textures.hasOwnProperty(key)) {
                    var url = Asset.prototype.Textures[key];
                    if (url !== null && url !== undefined && !seen[url]) {
                        seen[url] = true;
                        contentArray.push(url);
                    }
                }
            }

            var total = contentArray.length;
            var left = total;
            function Done() {
                left--;
                onProgressCallback(total > 0 ? 1 - left / total : 1);
                if (left === 0) onCompleteCallBack();
            }

            if (total === 0) {
                setTimeout(onCompleteCallBack, 0);
                return;
            }

            contentArray.forEach(function (url) {
                var texture = Pixi.Texture.fromImage(url);
                var base = texture.baseTexture;
                var image = ImageOf(texture);
                var finished = false;
                function Finish() {
                    if (finished) return;
                    finished = true;
                    Done();
                }

                if (base.hasLoaded) {
                    setTimeout(Finish, 0);
                }
                else if (image && image.complete && !image.naturalWidth) {
                    broken[url] = true;
                    setTimeout(Finish, 0);
                }
                else {
                    base.addEventListener('loaded', Finish);
                    if (image) image.addEventListener('error', function () {
                        broken[url] = true;
                        console.warn("[AssetLoader]: Could not load " + url);
                        Finish();
                    });
                }
            });
        }

        /// Whether a texture URL failed to load.
        Asset.prototype.IsBroken = function (url) {
            return !!broken[url];
        }

        /// Calls onBroken once if the image behind a texture (still loading) fails to load.
        Asset.prototype.OnBroken = function (texture, url, onBroken) {
            if (broken[url]) {
                setTimeout(onBroken, 0);
                return;
            }
            var image = ImageOf(texture);
            if (!image || texture.baseTexture.hasLoaded) return;
            if (image.complete && !image.naturalWidth) {
                broken[url] = true;
                setTimeout(onBroken, 0);
                return;
            }
            image.addEventListener('error', function () {
                broken[url] = true;
                onBroken();
            });
        }

        // The sounds play on one Web Audio context, Ogg Opus only (Content/Sound/CREDITS.md). Browsers start it
        // suspended until the player has touched the page, so the first gestures resume it; what starts before that
        // (the menu music) is heard from then on.
        var Context = window.AudioContext || window.webkitAudioContext;
        var ctx = Context ? new Context() : null;
        var master = null; // the master volume: 0 while the sound is switched off (AudioButton.js)
        if (ctx) {
            master = ctx.createGain();
            master.connect(ctx.destination);
        }
        function Unlock() {
            if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () { });
        }
        ['pointerdown', 'pointerup', 'touchend', 'keydown'].forEach(function (type) { window.addEventListener(type, Unlock, true); });

        var decoded = {}; // src -> AudioBuffer
        var loading = {}; // src -> Promise of it
        function Load(src) {
            if (!ctx) return Promise.reject(new Error('no Web Audio'));
            if (!loading[src]) loading[src] = fetch(src)
                .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))); })
                .then(function (bytes) { return new Promise(function (resolve, reject) { ctx.decodeAudioData(bytes, resolve, reject); }); })
                .then(function (buffer) { decoded[src] = buffer; });
            return loading[src];
        }

        /// Plays a loaded sound at volume (0..1); returns its source node, or null when it is not loaded.
        function Play(src, volume, loop) {
            if (!decoded[src]) return null;
            var source = ctx.createBufferSource();
            source.buffer = decoded[src];
            source.loop = !!loop;
            var gain = ctx.createGain();
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(master);
            source.start(0);
            return source;
        }

        Asset.prototype.SetVolume = function (val) {
            if (master) master.gain.value = val;
        }

        /// Test hook: the e2e instrumentation exposes window.__soundTrace(event, name) to count what played.
        function Trace(event, src) {
            try { if (window.__soundTrace) window.__soundTrace(event, String(src).replace(/^.*\/|\.ogg$/g, '')); } catch (e) { }
        }

        /// Loads the sound effects (the music loads when it first plays, see PlayMusic). Never holds up the game: a
        /// sound the browser cannot play counts as done, and after 8 seconds the game goes on without the rest.
        Asset.prototype.LoadSound = function (onProgressCallback, onCompleteCallBack) {
            var sounds = Object.keys(Asset.prototype.Sound).map(function (key) { return Asset.prototype.Sound[key]; });
            var done = 0, finished = false;
            function Finish() {
                if (finished) return;
                finished = true;
                onCompleteCallBack();
            }
            sounds.forEach(function (src) {
                Load(src).then(function () { Trace('decoded', src); }, function () { Trace('failed', src); }).then(function () {
                    done++;
                    if (done >= sounds.length) Finish();
                    else if (!finished) onProgressCallback(done / sounds.length * 100);
                });
            });
            setTimeout(Finish, 8000);
        }

        /// A sound effect: GetSound(Asset.Sound.X).play({ volume: 0.5 }) plays it (nothing while it is not loaded).
        Asset.prototype.GetSound = function (src) {
            return {
                play: function (options) {
                    var volume = options && options.volume !== undefined ? options.volume : 1;
                    if (Play(src, volume, false)) Trace('play', src);
                }
            };
        }

        /// Plays a music track in a loop instead of the one playing; it loads the first time (the game does not wait).
        var music = { src: null, source: null, volume: 1 };
        function StartMusic() {
            if (music.source || !music.src) return;
            music.source = Play(music.src, music.volume, true);
            if (music.source) Trace('music', music.src);
        }
        Asset.prototype.PlayMusic = function (src, volume) {
            if (music.src === src) return;
            Asset.prototype.StopMusic();
            music.src = src;
            music.volume = volume;
            Load(src).then(StartMusic, function () { });
        }

        Asset.prototype.StopMusic = function () {
            if (music.source) music.source.stop();
            music.src = music.source = null;
        }

        Asset.prototype.Textures =
        {
            // Game apperance
            GAME_BG: (Asset.Path.Textures + "arena.jpg"),
            GAME_QUEUE: Asset.Path.Textures + "queue.jpg",

            // Menu backdrop (the menu itself, the sound switch and the logo are DOM, see Objects/Environment)
            GAME_LOAD_BG: Asset.Path.Textures + "bg_faded.jpg",

            // End turn
            // The sign is lettered: the picture in the page's language (art.* in the string tables).
            END_TURN: Asset.Path.Textures + window.SoulsL10n.t("art.endTurn"),
            END_TURN_DISABLED: Asset.Path.Textures + window.SoulsL10n.t("art.endTurnDisabled"),

            // Card
            CARD_NONE: Asset.Path.Textures + "Card/CARD_NONE.png",
            CARD_SLOT: Asset.Path.Textures + "Card/cardslot.png",
            CARD_BACK: Asset.Path.Textures + "Card/cardback.png",
            CARD_DARKNESS: Asset.Path.Textures + "Card/Texture/darkness.png",
            CARD_VAMPIRIC: Asset.Path.Textures + "Card/Texture/vampiric.png",
            CARD_LIGHTBRINGER: Asset.Path.Textures + "Card/Texture/lightbringer.png",
            CARD_FEROCIOUS: Asset.Path.Textures + "Card/Texture/ferocious.png",
            CARD_ERROR: Asset.Path.Textures + "Card/Texture/card_error.png",

            // Target arrow
            ARROW_CORSHAIR: Asset.Path.Textures + "target.png",

            // Player Frame
            PLAYER_NONE: Asset.Path.Textures + "Player/player_none.png",
            PLAYER_FRAME: Asset.Path.Textures + "Player/player_frame.png",
            PLAYER_MANA: Asset.Path.Textures + "Player/player_mana.png",

            // Opponent Frame
            OPPONENT_NONE: Asset.Path.Textures + "Player/player_none.png",
            OPPONENT_FRAME: Asset.Path.Textures + "Player/opponent_frame.png",

            // Card Portraits
            CARD_PORTRAIT_UNKNOWN: Asset.Path.Textures + "Card/Portraits/0.jpg",
            /*CARD_PORTRAIT_ONE: Asset.Path.Textures + "Card/Portraits/1.png",
            CARD_PORTRAIT_TWO: Asset.Path.Textures + "Card/Portraits/2.png",
            CARD_PORTRAIT_THREE: Asset.Path.Textures + "Card/Portraits/3.png",
            CARD_PORTRAIT_FOUR: Asset.Path.Textures + "Card/Portraits/4.png",
            CARD_PORTRAIT_FIVE: Asset.Path.Textures + "Card/Portraits/5.png",
            CARD_PORTRAIT_SIX: Asset.Path.Textures + "Card/Portraits/6.png",*/

            // Player Portraits
            PLAYER_PORTRAIT_UNKNOWN: Asset.Path.Textures + "Player/Portraits/0.jpg",
            PLAYER_PORTRAIT_ONE: Asset.Path.Textures + "Player/Portraits/1.jpg",
            PLAYER_PORTRAIT_TWO: Asset.Path.Textures + "Player/Portraits/2.jpg",
            PLAYER_PORTRAIT_THREE: Asset.Path.Textures + "Player/Portraits/3.jpg",
            PLAYER_PORTRAIT_FOUR: Asset.Path.Textures + "Player/Portraits/4.jpg"
        }

        // The sound effects the classic client plays (the same files as the 3D client, Content/Sound/CREDITS.md).
        Asset.prototype.Sound = {};
        ['ui_click', 'emote', 'card_pickup', 'card_play', 'card_draw', 'card_shuffle', 'end_turn', 'turn_start',
            'timer_warning', 'attack', 'hero_hit', 'block', 'card_death', 'hero_power', 'fatigue', 'spell_whoosh', 'fire',
            'ice', 'ward', 'shatter', 'venom', 'rally', 'insight', 'drain', 'grow', 'heal', 'summon', 'curse', 'legendary',
            'versus', 'victory', 'defeat', 'coins', 'quest_complete'].forEach(function (name) {
            Asset.prototype.Sound[name.toUpperCase()] = Asset.Path.Sound + name + ".ogg";
        });

        Asset.prototype.Music = {
            MENU: Asset.Path.Sound + "music_menu.ogg",
            GAME: Asset.Path.Sound + "music_battle.ogg"
        }

        Asset.prototype.GetTexture = function (texture) {
            return Pixi.Texture.fromImage(texture);
        }


        return new Asset();

    });