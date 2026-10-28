define("arrow", ["jquery", "pixi", "asset"], function ($, pixi, Asset) {

    Arrow = function (engine) {
        this.engine = engine;
        pixi.Graphics.call(this);

        this.filter = new pixi.ColorMatrixFilter();
        this.filters = [this.filter];

        this.originPos = {};
        this.mousePos = {};
        this.active = false;
        this.visible = false;

        var texture = Asset.GetTexture(Asset.Textures.ARROW_CORSHAIR);
        this.arrowHead = new pixi.Sprite(texture)
        this.arrowHead.anchor = { x: 0.2, y: 0.5 };
        this.arrowHead.width = 100;
        this.arrowHead.height = 100;
        this.arrowHead.visible = false;

        var that = this;
        var orginalScale = this.arrowHead.scale;
        var updatus = {
            scaleX: this.arrowHead.scale.x,
            scaleY: this.arrowHead.scale.y
        };

        this.arrowHeadTween = this.engine.CreateJS.Tween.get(updatus, {
            override: true,
            loop: true,
            onChange: function () {
                that.arrowHead.scale.x = updatus.scaleX;
                that.arrowHead.scale.y = updatus.scaleY;
            }
        })
        .to({
            scaleX: (orginalScale.x * 1.2),
            scaleY: (orginalScale.y * 1.2),
            rotation: 50
        }, 300, this.engine.CreateJS.Ease.quadIn)
        .to({
            scaleX: (orginalScale.x * 1),
            scaleY: (orginalScale.y * 1)
        }, 300, this.engine.CreateJS.Ease.quadIn)
        this.arrowHeadTween.setPaused(true);

        this.Count = 0;


        this.engine.addChild("Arrow", this);
        this.engine.getGroup("Arrow").addChild(this.arrowHead);
    }
    // Constructor
    Arrow.prototype = Object.create(pixi.Graphics.prototype);
    Arrow.prototype.constructor = Arrow;


    /// <summary>
    /// This function checks if a card is In a slot and then if its picked up. If so it means the player are doing a attack
    /// </summary>
    /// <param name="card">The card</param>
    /// <returns type="">Weither a attack is beeing done.</returns>
    Arrow.prototype.ArrowShowCheck = function (card) {

        // If the card is picked up, but is in a slot (Arrow dragging)
        if ((!!card.inSlot && !!card.pickedUp) || this.engine.player.isClicked) {

            // Determine which color the arrow should be. (Depending on Rightclick)
            if (!!card.rightClick) {
                this.arrowHead.tint = 0x0000FF;
            }
            else {
                this.arrowHead.tint = 0xFF0000;
            }

            this.Show();
            this.Draw(
                this.engine.conf.mouse, //TO
                card.position //ORIGIN
                );

            return true;
        }
        else {
            this.Reset();
            // Deactivate
            return false;
        }
    }


    Arrow.prototype.PlayerAttackCheck = function (card, player) {

        // Determine if the Mouse is inside the card bounds
        var isInside = this.engine.toolbox.Rectangle.containsRaw(
        player.x - (player.width / 2), // Top
        player.y - (player.height / 2), // Left
        player.width,
        player.height,
        this.engine.conf.mouse.x,
        this.engine.conf.mouse.y);

        if (isInside) {
            card.target = player;
            player.ScaleUp();
            return true;
        }
        else {
            card.target = undefined;
            player.ScaleDown();
            return false;
        }
    }


    Arrow.prototype.CardAttackCheck = function (card) {

        // Iterate over opponents cards
        var opponentBoard = this.engine.opponent.cardManager.board;
        var playerBoard = this.engine.player.cardManager.board;
        var foundCard = false;

        for (var index in opponentBoard) {
            var ocard = opponentBoard[index];

            // Determine if the Mouse is inside the card bounds
            var isInside = this.engine.toolbox.Rectangle.containsRaw(
            ocard.x - (ocard.width / 2), // Top
            ocard.y - (ocard.height / 2), // Left
            ocard.width,
            ocard.height,
            this.engine.conf.mouse.x,
            this.engine.conf.mouse.y);

            if (isInside) {
                // Assign target on source card to the found opponent card

                card.target = ocard;
                ocard.ScaleUp();
                foundCard = true;
                break;
            }
            else {
                // Nothing was found
                ocard.ScaleDown();
                card.target = undefined;
            }
        }

        // If ability usage
        if (!!card.rightClick) {
            for (var index in playerBoard) {
                var ocard = playerBoard[index];
                // Determine if the Mouse is inside the card bounds
                var isInside = this.engine.toolbox.Rectangle.containsRaw(
                ocard.x - (ocard.width / 2), // Top
                ocard.y - (ocard.height / 2), // Left
                ocard.width,
                ocard.height,
                this.engine.conf.mouse.x,
                this.engine.conf.mouse.y);

                if (isInside) {
                    // Assign target on source card to the found opponent card

                    card.target = ocard;
                    ocard.ScaleUp();
                    foundCard = true;
                    break;
                }
                else {
                    // Nothing was found
                    ocard.ScaleDown();
                    card.target = undefined;
                }
            }

        }





        return foundCard;
    }


    Arrow.prototype.Draw = function (mouse, origin) {
        if (mouse.x <= 0 && mouse.y <= 0)
            return;

        this.originPos = origin;
        this.mousePos = mouse;
        this.active = true;


        // Rotate the ArrowHead accordingly to current mouse position.
        var deltaY = mouse.y - origin.y;
        var deltaX = mouse.x - origin.x;
        var angleInDegrees = Math.atan2(deltaY, deltaX) * 180 / Math.PI
        this.arrowHead.rotation = Math.atan2(deltaY, deltaX);
        this.arrowHead.x = mouse.x;
        this.arrowHead.y = mouse.y;

        // Draw the arrow shaft
        this.clear();
        this.lineStyle(5, 0xff0000, 1);
        this.beginFill(0xffFF00, 0.5);
        this.moveTo(origin.x, origin.y);
        this.lineTo(mouse.x, mouse.y);
        this.endFill();
    }

    Arrow.prototype.Show = function () {
        if (!this.visible) {
            this.visible = true;
            this.arrowHead.visible = true;
            this.arrowHeadTween.setPaused(false);
            $("#game-window").css("cursor", "none");
        }
    }

    Arrow.prototype.Hide = function () {
        if (this.visible) {
            this.visible = false;
            this.arrowHead.visible = false;
            this.arrowHeadTween.setPaused(true);
        }
    }

    Arrow.prototype.Reset = function () {
        if (this.active) {
            this.engine.opponent.ScaleDown();
            $("#game-window").css("cursor", "arrow");

            this.arrowHead.visible = false;
            this.active = false;

            this.Hide();


        }
    }

    Arrow.prototype.Process = function () {
        var count = this.Count += 0.05


        var colorMatrix = [1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1];

        colorMatrix[0] = Math.sin(count);

        this.filter.matrix = colorMatrix;
    }


    return Arrow;

});