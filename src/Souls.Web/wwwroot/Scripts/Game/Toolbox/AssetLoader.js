    define("asset", ["pixi", "soundjs"], function (Pixi, SoundJS) {

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

        Asset.prototype.SetVolume = function (val) {
            createjs.Sound.setVolume(val);
        }

        /// Test hook: the e2e instrumentation exposes window.__soundTrace(event, name) to count what played.
        function Trace(event, src) {
            try { if (window.__soundTrace) window.__soundTrace(event, String(src).replace(/^.*\/|\.ogg$/g, '')); } catch (e) { }
        }

        /// Loads the sound effects (the music loads when it first plays, see PlayMusic). Never holds up the game: a
        /// sound the browser cannot play counts as done, and after 8 seconds the game goes on without the rest.
        Asset.prototype.LoadSound = function (onProgressCallback, onCompleteCallBack) {
            createjs.Sound.alternateExtensions = []; // Ogg Opus only (Content/Sound/CREDITS.md)
            var pending = {}, total = 0, done = 0, finished = false;
            function Done() {
                if (finished) return;
                done++;
                if (done >= total) {
                    finished = true;
                    onCompleteCallBack();
                }
                else onProgressCallback(done / total * 100);
            }
            createjs.Sound.addEventListener("fileload", function (event) {
                if (!pending[event.id]) return;
                delete pending[event.id];
                Trace('decoded', event.id);
                Done();
            });
            $.each(Asset.prototype.Sound, function (key, src) { pending[src] = true; total++; });
            $.each(Asset.prototype.Sound, function (key, src) {
                if (!createjs.Sound.registerSound(src, src)) { delete pending[src]; Trace('failed', src); Done(); }
            });
            setTimeout(function () {
                if (finished) return;
                finished = true;
                onCompleteCallBack();
            }, 8000);
            return true;
        }

        Asset.prototype.GetSound = function (soundEnum) {
            var instance = createjs.Sound.play(soundEnum);  // play using id.  Could also use full source path or event.src.
            if (instance && instance.playState !== createjs.Sound.PLAY_FAILED) Trace('play', soundEnum);
            return instance;
        }

        /// Plays a music track in a loop instead of the one playing; it loads the first time (the game does not wait).
        var music = { src: null, instance: null, loaded: {} };
        createjs.Sound.addEventListener("fileload", function (event) {
            if (music.loaded[event.id] !== false) return;
            music.loaded[event.id] = true;
            if (event.id === music.src) StartMusic();
        });
        function StartMusic() {
            if (music.instance) return;
            music.instance = createjs.Sound.play(music.src, { loop: -1, volume: music.volume });
            Trace('music', music.src);
        }
        Asset.prototype.PlayMusic = function (src, volume) {
            if (music.src === src) return;
            Asset.prototype.StopMusic();
            music.src = src;
            music.volume = volume;
            if (music.loaded[src]) StartMusic();
            else if (music.loaded[src] === undefined) {
                music.loaded[src] = false;
                if (!createjs.Sound.registerSound(src, src)) delete music.loaded[src];
            }
        }

        Asset.prototype.StopMusic = function () {
            if (music.instance) music.instance.stop();
            music.src = music.instance = null;
        }

        Asset.prototype.Textures =
        {
            // Game apperance
            GAME_BG: (Asset.Path.Textures + "arena.jpg"),
            GAME_QUEUE: Asset.Path.Textures + "queue.jpg",

            // Menu backdrop (the menu itself, the sound switch and the logo are DOM, see Objects/Environment)
            GAME_LOAD_BG: Asset.Path.Textures + "bg_faded.jpg",

            // End turn
            END_TURN: Asset.Path.Textures + "endturn.png",
            END_TURN_DISABLED: Asset.Path.Textures + "endturn_disabled.png",

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
        $.each(['ui_click', 'emote', 'card_pickup', 'card_play', 'card_draw', 'card_shuffle', 'end_turn', 'turn_start',
            'timer_warning', 'attack', 'hero_hit', 'block', 'card_death', 'hero_power', 'fatigue', 'spell_whoosh', 'fire',
            'ice', 'ward', 'shatter', 'venom', 'rally', 'insight', 'drain', 'grow', 'heal', 'summon', 'curse', 'legendary',
            'versus', 'victory', 'defeat', 'coins', 'quest_complete'], function (i, name) {
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