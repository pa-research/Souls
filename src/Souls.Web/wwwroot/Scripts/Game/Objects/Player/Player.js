define("player", ["jquery", "pixi", "asset", "playerbase", "arrow", "cardmanager", "rules", "card"], function ($, pixi, asset, playerBase, Arrow, CardManager, Rules, Card) {

    var ATTACK_TARGETS = ['enemyCard', 'enemyHero'];

    Player = function (engine) {
        playerBase.call(this, engine, true);

        this.holdingCard; // Currently holding card (Object)
        this.lastHoldingCard; // The last card the player held


        this.interactive = true;
        this.isClicked = false;
        var that = this;

        // Drag from the hero to a target to attack with it (mouse or touch).
        this.mousedown = this.touchstart = function (mouseData) {
            var pointer = Card.Pointer(mouseData);
            that.rightClick = pointer.right;
            that.engine.SetPointer(mouseData.global, pointer.touch);
            that._downAt = Date.now();
            that._downPos = { x: mouseData.global.x, y: mouseData.global.y };

            if (!pointer.right && !that.isDead)
                that.isClicked = true;
        }

        this.mouseup = this.mouseupoutside = this.touchend = this.touchendoutside = function (mouseData) {
            if (!that.isClicked) return;
            var pointer = Card.Pointer(mouseData);

            if (pointer.touch) {
                that.engine.SetPointer(mouseData.global, true);
                that.UpdateAim();
            }

            var hadTarget = !!that.target;
            var moved = that._downPos ? Math.abs(mouseData.global.x - that._downPos.x) + Math.abs(mouseData.global.y - that._downPos.y) : 0;

            that.isClicked = false;

            // Reset arrow.
            that.arrow.Reset();

            that.CheckAttack();

            if (pointer.touch) {
                if (!hadTarget && moved < 20 && that.engine.tooltip) that.engine.tooltip.Pin(that, 3500);
                that.engine.ClearPointer();
            }
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

        // Aiming with a card, the hero or the hero power
        this.UpdateAim();

        this.PulseGlow();
        if (this.heroPower) this.heroPower.Process();
    }

    /// <summary>
    /// Draws the arrow and finds the target while the player aims: a board card (left button / drag = attack,
    /// right button / long press = ability), the hero (attack) or the hero power.
    /// </summary>
    Player.prototype.UpdateAim = function () {
        var found;
        var card = this.holdingCard;

        if (card && card.inSlot && card.pickedUp && !card.isDead) {
            if (card.rightClick) {
                var kinds = [];
                var hint;
                var ability = Rules.Ability(card.abilityId);
                if (!card.abilityId) {
                    hint = card.name + " has no ability";
                }
                else if (!Rules.IsActivated(card.abilityId, card.abilityActivated)) {
                    hint = (ability ? ability.name : card.abilityName || "This ability") + " works on its own";
                }
                else {
                    kinds = Rules.AbilityTargets(card.abilityId);
                    if (ability || card.abilityName) hint = (ability ? ability.name : card.abilityName) + ": pick " + Rules.DescribeTargets(kinds);
                }
                found = this.arrow.Aim(card, kinds, 'ability', hint);
            }
            else {
                found = this.arrow.Aim(card, ATTACK_TARGETS, 'attack');
            }
            card.target = found ? found.obj : undefined;
            card.targetKind = found ? found.kind : undefined;
            return;
        }

        // A spell dragged out of the hand, or clicked and waiting for its target: it aims like an ability.
        var spell = card && card.spell && !card.inSlot && card.pickedUp ? card : this.armedSpell;
        if (spell && !spell.isDead) {
            found = null;
            if (spell.TargetedSpell()) {
                var spellKinds = Rules.AbilityTargets(spell.abilityId);
                found = this.arrow.Aim(spell, spellKinds, 'ability', spell.name + ": pick " + Rules.DescribeTargets(spellKinds));
            }
            else {
                this.arrow.Reset();
            }
            spell.target = found ? found.obj : undefined;
            spell.targetKind = found ? found.kind : undefined;
            return;
        }

        if (this.isClicked) {
            found = this.arrow.Aim(this, ATTACK_TARGETS, 'attack');
            this.target = found ? found.obj : undefined;
            this.targetKind = found ? found.kind : undefined;
            return;
        }

        if (this.heroPower && this.heroPower.aiming) {
            var power = Rules.HeroPower(this.power);
            var powerKinds = Rules.PowerTargets(this.power);
            found = this.arrow.Aim(this.heroPower, powerKinds, 'power',
                (power ? power.name + ": pick " : "Pick ") + Rules.DescribeTargets(powerKinds));
            this.heroPower.target = found;
            return;
        }

        this.arrow.Reset();
    }

    // Shows the cost of the hovered card (or hero power) as mana crystals around the hero: green (affordable),
    // yellow (not affordable) or red (missing).
    Player.prototype.CheckManaCost = function () {
        var preview = null;
        if (!!this._chover && typeof this._chover.cost === 'number') preview = this._chover.cost;
        else if (this.heroPower && this.heroPower.hovered) preview = this.heroPower.cost;

        this.UpdateManaCrystals();
        if (preview === null) return;

        for (var i = 0; i < 10 && i < preview; i++) {
            var item = this.manaCrystals[i];
            item.visible = true;
            item.alpha = i < this.mana ? 1 : 0.5;
            item.tint = i >= this.mana ? 0xe52a2a : (this.mana >= preview ? 0x4cd328 : 0xFFFE00); // red / green / yellow
        }
    }

    /// <summary>
    /// Called on release after dragging from the hero: attacks the target (2 = hero on card, 3 = hero on hero).
    /// </summary>
    Player.prototype.CheckAttack = function () {
        if (!!this.target && !!this.targetKind && !this.rightClick) {
            this.engine.gameService.Request_Attack(this, this.target, this.targetKind === 'enemyHero' ? 3 : 2);
        }
        if (this.target && this.target.ScaleDown) this.target.ScaleDown();
        this.target = undefined;
        this.targetKind = undefined;
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
