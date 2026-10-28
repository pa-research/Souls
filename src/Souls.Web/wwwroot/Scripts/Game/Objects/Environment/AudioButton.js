define("audio", ["jquery", "asset", "pixi"], function ($, Asset, Pixi) {

    Audio = function (engine) {
        console.log("> Audio Button Loaded")
        this.engine = engine;
        this.Init();
        this.audioIsOn = true;

    }
    // Constructor
    Audio.prototype.constructor = Audio;

    Audio.prototype.Init = function () {
        var that = this;
        var volume_on = Asset.GetTexture(Asset.Textures.GAME_VOLUME_ON);
        var volume_off = Asset.GetTexture(Asset.Textures.GAME_VOLUME_OFF);


        // Setup the Background image
        var audio = new Pixi.Sprite(volume_on);
        audio.anchor = { x: 0.5, y: 0.5 };
        audio.width = 50
        audio.height = 50
        audio.x = this.engine.conf.width - 70;
        audio.y = this.engine.conf.height - 70;
        audio.interactive = true;
        this.engine.addChild("Audio", audio);

        audio.click = audio.tap = function (mouseData) {
            that.audioIsOn = !that.audioIsOn;
 

            if (that.audioIsOn) // Audio turn on
            {
                audio.texture = volume_on;
                Asset.SetVolume(1);
            }
            else // Off
            {
                audio.texture = volume_off;
                Asset.SetVolume(0);
            }


        }

        audio.mouseover = function (mouseData) {
            audio.scale.x = 0.8;
            audio.scale.y = 0.8;

        }
        audio.mouseout = function (mouseData) {
            audio.scale.x = 0.5;
            audio.scale.y = 0.5;
        }

    }

    return Audio;

});