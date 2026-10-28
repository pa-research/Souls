define("player", ["jquery", "pixi", "asset", "playerbase", "arrow", "cardmanager"], function ($, pixi, asset, playerBase, Arrow, CardManager) {


    Player = function (engine) {
        playerBase.call(this, engine, true);

        this.holdingCard; // Currently holding card (Object)
        this.lastHoldingCard; // The last card the player held

        
        this.interactive = true;
        this.isClicked = false;
        var that = this;
        this.mousedown = function (mouseData) {
            var event = mouseData.originalEvent;
            var leftClick = (event.which == 1) ? true : false;
            var rightClick = (event.which == 3) ? true : false;
            this.rightClick = rightClick;

            if(!rightClick)
                that.isClicked = true;
        }

        this.mouseup = this.mouseupoutside = function (mouseData) {
            var event = mouseData.originalEvent;
            var leftClick = (event.which == 1) ? true : false;
            var rightClick = (event.which == 3) ? true : false;
            this.rightClick = rightClick;

            that.isClicked = false;

            // Reset arrow.
            this.arrow.Reset();

            this.CheckAttack();
        }

        this.Init();

    }
    // Constructor
    Player.prototype = Object.create(playerBase.prototype);
    Player.prototype.constructor = Player;


    Player.prototype.Process = function () {

        // Process arrow
        this.arrow.Process();

        // Check if manacrystals whould be updated, recolored or alphaed
        this.CheckManaCost();

        // Process cardmanager
        this.cardManager.Process();

        // Whenever the player is holding a card (Clicked a card)
        if (!!this.holdingCard) {
            var isArrowAction = this.arrow.ArrowShowCheck(this.holdingCard);

            // if movement - check card attack
            if (isArrowAction)
                var isAttackingC = this.arrow.CardAttackCheck(this.holdingCard);

            // if no card attack found - do opponent attack
            if (isArrowAction && !isAttackingC)
                var isAttackingOpp = this.arrow.PlayerAttackCheck(this.holdingCard, this.engine.opponent);

            // Check if hovering Player WITH right CLICK
            if (isArrowAction && !isAttackingC && !isAttackingOpp && !!this.holdingCard.rightClick)
                var isAttackingP = this.arrow.PlayerAttackCheck(this.holdingCard, this.engine.player);
           

        }

        // Player portrait is clicked
        if(this.isClicked)
        {
            var isArrowAction = this.arrow.ArrowShowCheck(this);

            if (isArrowAction)
                var isAttackingC = this.arrow.CardAttackCheck(this);

            // if no card attack found - do opponent attack
            if (isArrowAction && !isAttackingC)
                var isAttackingOpp = this.arrow.PlayerAttackCheck(this, this.engine.opponent);

        }

    }

    // Checks the players mana against the card cost
    Player.prototype.CheckManaCost = function () {

        for (var i = 0; i < 10; i++) {

            item = this.manaCrystals[i];
            
            // If hovercard is defined and hava a cost more than current manacrystal
            if (!!this._chover && i < this._chover.cost) {

                // If players mana is more than current crystal
                if (i < this.mana) {

                    // Checks if the player can afford this card in total. If yes, cost crystals are green, if no available are yellow.
                    if (this.mana >= this._chover.cost)
                        item.tint = 0x4cd328; // Green crystal
                    else item.tint = 0xFFFE00; // Yellow crystal
                }
                // If players mana is less than current crystal
                else {
                    item.visible = true;
                    item.tint = 0xe52a2a; // Red crystal
                    item.alpha = 0.5;
                }
            }
            
            // If hovercard is not defined or cost is less than current crystal
            // Resets the crystal to original color and visibility
            else {
                item.alpha = 1;
                item.tint = 0x6e93b3;
                // Checks if player have enough mana to show this crystal
                if (i >= this.mana) {
                    item.visible = false;
                }
            }
        }
    }

    /// <summary>
    /// This function checks weither a "this" card has a value set in his target variable 
    /// (This is called on mouseRelease). If its set trigger a rquest Attack to the server.
    /// </summary>
    Player.prototype.CheckAttack = function () {
        // If a card attack is set (Should not be set unless a player releases the mouse over a enemy card)
        if (!!this.target && !this.rightClick) {

            if (this.target == this.engine.opponent) {
                this.engine.gameService.Request_Attack(this, this.target, 3);
            }

            else // Must be a card
            {
                this.engine.gameService.Request_Attack(this, this.target, 2);

            }

            this.target.ScaleDown();
            this.target = undefined;

        }
    }


    // Initializer function
    Player.prototype.Init = function () {
        this.arrow = new Arrow(this.engine);
        this.engine.addChild("Player", this);

        this.cardManager = new CardManager(this.engine, true);
        this.cardManager.AddCardSlots();
        this.engine.getGroup("CardSlot-Player").visible = false;
        this.engine.getGroup("CardSlot-Player").alpha = 0.7;

        this.SetPosition(
            {
                x: (this.engine.conf.width / 2),
                y: (this.engine.conf.height - this.height / 2)
            });
    }
    return Player;

});