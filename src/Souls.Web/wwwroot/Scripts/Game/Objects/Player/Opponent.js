define("opponent", ["jquery", "asset", "playerbase"], function ($, asset, playerBase) {


    Opponent = function (engine) {
        playerBase.call(this, engine, false)

        // Defining differences from player and opponent
        this.pNamePanelText.y -= this.height / 1.22;
        this.pHealthText.y -= this.height / 2.25;
        this.pAttackText.y -= this.height / 2.25;


        this.Init();
    }
    // Constructor
    Opponent.prototype = Object.create(PlayerBase.prototype);
    Opponent.prototype.constructor = Opponent;

    // Initializer function
    Opponent.prototype.Init = function () {
        this.engine.addChild("Opponent", this);
        this.cardManager = new CardManager(this.engine, false);
        this.cardManager.AddCardSlots();
        this.engine.getGroup("CardSlot-Opponent").visible = false;

        this.SetPosition(
            {
                x: (this.engine.conf.width / 2),
                y: this.height / 2
            });
    }

    return Opponent;

});