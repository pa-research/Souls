define("background", ["jquery", "asset", "pixi", "endturnbutton"], function ($, Asset, Pixi, EndTurnButton) {

    Background = function (engine) {
        console.log("> Background Loaded")
        this.engine = engine;

    }
    // Constructor
    Background.prototype.constructor = Background;

    Background.prototype.Init = function () {
        // Setup the Background image
        var bg = new Pixi.Sprite(Asset.GetTexture(Asset.Textures.GAME_BG));
        bg.width = this.engine.conf.width;
        bg.height = this.engine.conf.height;
        bg.interactive = true;
        this.engine.addChild("Background", bg);

        // Add endturn button
        this.endTurnButton = new EndTurnButton(this.engine);
        this.endTurnButton.Init();
        this.engine.addChild("EndTurn", this.endTurnButton)

        var that = this;
        bg.mousemove = bg.touchmove = function (mouseData) {
            var mNow = mouseData.getLocalPosition(this.parent)
            that.engine.conf.mouse.x = mNow.x;
            that.engine.conf.mouse.y = mNow.y;
        }
    }

    return Background;

});