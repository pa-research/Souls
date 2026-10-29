define("endturnbutton", ["jquery", "asset", "pixi", "conf", "messages"], function ($, Asset, Pixi, Conf, Message) {

    EndTurnButton = function (engine)
    {
        this.engine = engine;

        // Cache images for undelayed swap
        this.disabledTexture = Asset.GetTexture(Asset.Textures.END_TURN_DISABLED);
        this.enabledTexture = Asset.GetTexture(Asset.Textures.END_TURN);

        // Enabled is default texture
        Pixi.Sprite.call(this, this.enabledTexture);

    }

    EndTurnButton.prototype = Object.create(Pixi.Sprite.prototype);

    // Constructor
    EndTurnButton.prototype.constructor = EndTurnButton;

    EndTurnButton.prototype.Init = function ()
    {
        // Make endround button
        this.anchor = { x: 0.5, y: 0.5 };
        this.width = 200;
        this.height = 75;
        this.x = Conf.width - 310;
        this.y = (Conf.height / 2) + 10;
        this.active = false;
        this.spinning = false;
        this.pendingTurn = undefined;
        this.interactive = false;
        this.baseScaleY = this.scale.y;
    }

    /// Shows whose turn it is (true = the player's: the button is enabled).
    EndTurnButton.prototype.SetPlayerTurn = function (active)
    {
        active = !!active;
        if (this.spinning) {
            // Applied when the spin ends.
            this.pendingTurn = active;
            return;
        }

        this.setTexture(active ? this.enabledTexture : this.disabledTexture);
        this.active = active;
        this.interactive = active;
    }

    /// Spins the button, then shows the given turn state.
    EndTurnButton.prototype.Spin = function (activeAfter)
    {
        var that = this;
        this.pendingTurn = !!activeAfter;
        if (this.spinning) return;

        try { Asset.GetSound(Asset.Sound.END_TURN).play(); } catch (e) { }

        var positive = this.baseScaleY || this.scale.y;
        var position = { scaleY: positive };
        this.spinning = true;
        this.interactive = false;

        this.engine.CreateJS.Tween.get(position, { onChange: onChange })
            .to({ scaleY: -positive }, 100)
            .to({ scaleY: positive }, 100)
            .to({ scaleY: -positive }, 100)
            .to({ scaleY: positive }, 100)
            .call(done);

        // Guard: the state is applied even if the tween is removed.
        setTimeout(done, 700);

        function onChange(e)
        {
            that.scale.y = position.scaleY;
        }

        function done()
        {
            if (!that.spinning) return;
            that.spinning = false;
            that.scale.y = positive;
            that.SetPlayerTurn(that.pendingTurn);
        }
    }

    // When the End Turn button is pressed (mouse or touch) while it is the player's turn
    EndTurnButton.prototype.mousedown = EndTurnButton.prototype.touchstart = function ()
    {
        if (!this.active || this.spinning) return;
        this.active = false;
        this.Spin(false);
        this.RequestNextTurn();
    }

    EndTurnButton.prototype.RequestNextTurn = function ()
    {
        var json = Message.GAME.NEXT_TURN;
        this.engine.gameSocket.send(json);
    }

    return EndTurnButton;

});
