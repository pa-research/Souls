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

        Asset.prototype.LoadSound = function (onProgressCallback, onCompleteCallBack) {
            createjs.Sound.alternateExtensions = ["mp3"];

            $.each(Asset.prototype.Sound, function (key, value) {
                createjs.Sound.registerSound(value, value);
            });


            var totalSounds = Object.keys(Asset.prototype.Sound).length;
            var currentLoaded = 0
            createjs.Sound.addEventListener("fileload", handleFileLoad);
            function handleFileLoad(event) {
                console.log("Preloaded:", event.id);
                var percent = ++currentLoaded / totalSounds;

                if (percent == 1) {
                    onCompleteCallBack();
                }
                else {
                    onProgressCallback(percent * 100);
                }

            }
            return true;
        }


        Asset.prototype.GetSound = function (soundEnum) {
            var instance = createjs.Sound.play(soundEnum);  // play using id.  Could also use full source path or event.src.
            return instance;
        }

        Asset.prototype.Textures =
        {
            // Game apperance
            GAME_BG: (Asset.Path.Textures + "arena.jpg"),
            GAME_QUEUE: Asset.Path.Textures + "queue.jpg",

            // Menu backdrop (the menu itself, the sound switch and the logo are DOM, see Objects/Environment)
            GAME_LOAD_BG: Asset.Path.Textures + "bg_faded.png",

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
            CARD_PORTRAIT_UNKNOWN: Asset.Path.Textures + "Card/Portraits/0.png",
            /*CARD_PORTRAIT_ONE: Asset.Path.Textures + "Card/Portraits/1.png",
            CARD_PORTRAIT_TWO: Asset.Path.Textures + "Card/Portraits/2.png",
            CARD_PORTRAIT_THREE: Asset.Path.Textures + "Card/Portraits/3.png",
            CARD_PORTRAIT_FOUR: Asset.Path.Textures + "Card/Portraits/4.png",
            CARD_PORTRAIT_FIVE: Asset.Path.Textures + "Card/Portraits/5.png",
            CARD_PORTRAIT_SIX: Asset.Path.Textures + "Card/Portraits/6.png",*/

            // Player Portraits
            PLAYER_PORTRAIT_UNKNOWN: Asset.Path.Textures + "Player/Portraits/0.png",
            PLAYER_PORTRAIT_ONE: Asset.Path.Textures + "Player/Portraits/1.png",
            PLAYER_PORTRAIT_TWO: Asset.Path.Textures + "Player/Portraits/2.png",
            PLAYER_PORTRAIT_THREE: Asset.Path.Textures + "Player/Portraits/3.png",
            PLAYER_PORTRAIT_FOUR: Asset.Path.Textures + "Player/Portraits/4.png",
            PLAYER_PORTRAIT_FIVE: Asset.Path.Textures + "Player/Portraits/5.png",
            PLAYER_PORTRAIT_SIX: Asset.Path.Textures + "Player/Portraits/6.png"
        }

        Asset.prototype.Sound =
            {
                CARD_PICKUP: Asset.Path.Sound + "fjopp.ogg",
                CARD_MOUNT: Asset.Path.Sound + "card_mount.ogg",
                END_TURN: Asset.Path.Sound + "scroll.ogg",
                ATTACK_1: Asset.Path.Sound + "attack_1.ogg",
                DEFEND_1: Asset.Path.Sound + "defend_1.ogg",
                CHAT_MESSAGE: Asset.Path.Sound + "chat_message.ogg",
                GAME_MUSIC: Asset.Path.Sound + "background-music.ogg",
                MENU: Asset.Path.Sound + "menu.ogg",
                ABILITY_SACRIFICE: Asset.Path.Sound + "ability_sacrifice.ogg",
                ABILITY_HEAL: Asset.Path.Sound + "ability_heal.ogg"
            }

        Asset.prototype.GetTexture = function (texture) {
            return Pixi.Texture.fromImage(texture);
        }


        return new Asset();

    });