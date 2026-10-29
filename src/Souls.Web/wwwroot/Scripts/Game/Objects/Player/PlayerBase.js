define("playerbase", ["jquery", "pixi", "asset", "iAnimation", "animation", "hud"], function ($, Pixi, Asset, AnimationInterface, Animation, Hud) {

    function ToNumber(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        var n = Number(value);
        return isFinite(n) ? n : fallback;
    }

    /// Sets a label only when its text changes (re-rendering a text is not free).
    function SetLabel(label, value) {
        var text = String(value);
        if (label.text !== text) label.setText(text);
    }

    var MANA_FULL = 0x6e93b3;
    var MANA_SPENT = 0x2c3540;

    PlayerBase = function (engine, isPlayer) {
        var frame = (isPlayer) ? Asset.GetTexture(Asset.Textures.PLAYER_FRAME) : Asset.GetTexture(Asset.Textures.OPPONENT_FRAME);
        Pixi.Sprite.call(this, Asset.GetTexture(Asset.Textures.PLAYER_NONE));
        this.engine = engine;

        // Player Animation
        this.Animation = new AnimationInterface();
        this.Animation.Death = Animation.Player.Death;
        this.Animation.Defend = Animation.Player.Defend;
        this.Animation.Heal = Animation.General.Heal;
        this.Animation.GainAttack = Animation.General.GainAttack;

        var json = { name: "NA", attack: "NA", health: "NA", mana: "NA", type: 0 };

        // Defining variables
        this.anchor = { x: 0.5, y: 0.5 };
        this.width = 300;
        this.height = 250;
        this.isPlayer = isPlayer;
        this.health = json.health;
        this.maxHealth = undefined;
        this.armor = 0;
        this.attack = json.attack;
        this.mana = json.mana;
        this.maxMana = 0;
        this.name = json.name;
        this.type = json.type;
        this.ident = undefined;
        this.handCount = undefined;
        this.deckCount = undefined;
        this.fatigue = 0;
        this.rating = undefined;
        this.canAttack = false;
        this.canUsePower = false;
        this.heroPowerUsed = false;
        this.isDead = false;
        this.manaCrystals = new Array();


        // Making mask for the portrait
        var masking = new Pixi.Graphics();
        masking.beginFill(0xFFFFFF);
        masking.lineStyle(0, 0xffffff);
        masking.fillAlpha = 0.5;
        masking.drawEllipse(0, 0, this.width / 2.2, this.height / 2.1);
        masking.endFill();
        masking.x -= 4;

        // Player Frame
        var pFrame = new Pixi.Sprite(frame);
        pFrame.anchor = { x: 0.5, y: 0.5 };
        pFrame.width = this.width;
        pFrame.height = this.height;

        this._originalScale =
            {
                x: this.scale.x,
                y: this.scale.y
            }


        // Player Portrait
        this.pPortrait = this.portrait = new Pixi.Sprite(this.GetPortrait(this.type));
        this.pPortrait.anchor = { x: 0.5, y: 0.5 };
        this.pPortrait.width = this.width;
        this.pPortrait.height = this.height;
        this.pPortrait.x = 0;
        this.pPortrait.y = 0;

        this.pPortrait.mask = masking;

        // Name text
        this.pNamePanelText = new Pixi.Text(this.name,
            {
                font: "26px Helvetica",
                fill: "white",
                wordWrap: true,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pNamePanelText.anchor = { x: 0.5, y: 1 };
        this.pNamePanelText.x = 0;
        this.pNamePanelText.y = this.height / 2.1;

        // Attack damage text
        this.pAttackText = new Pixi.Text(this.attack,
            {
                font: "35px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pAttackText._originalScale =
        {
            x: this.pAttackText.scale.x,
            y: this.pAttackText.scale.y
        };
        this.pAttackText.anchor = { x: 0.5, y: 1 };
        this.pAttackText.x -= this.width / 2.66;
        this.pAttackText.y += this.height / 3.2;

        // Health text
        this.pHealthText = new Pixi.Text(this.health,
            {
                font: "35px Arial",
                fill: "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',

                wordWrapWidth: this.width
            });
        this.pHealthText.anchor = { x: 0.5, y: 1 };
        this.pHealthText.x += this.width / 2.65;
        this.pHealthText.y += this.height / 3.2;

        this.pHealthText._originalScale =
        {
            x: this.pHealthText.scale.x,
            y: this.pHealthText.scale.y
        };


        // Adding sprites to base
        this.addChild(this.pPortrait);
        this.addChild(masking);
        this.addChild(pFrame);
        this.addChild(this.pNamePanelText);
        this.addChild(this.pAttackText);
        this.addChild(this.pHealthText);

        // Generating the manacrystals in elipse around owner
        var num = 10;
        var deg = (Math.PI * 2) / 180;
        var degJump = (Math.PI / 180) * 20
        var radiusX = (this.width - 10) / 2;
        var radiusY = (this.height - 25) / 2;
        var YOffset;
        var startOffset

        if (!!this.isPlayer) {
            startOffset = 9;
            YOffset = 0;
        }
        else {
            startOffset = 0;
            YOffset = 25;
        }

        for (var i = 0; i < num; i++) {
            var item = new Pixi.Sprite(Asset.GetTexture(Asset.Textures.PLAYER_MANA));
            item.anchor = { x: 0.5, y: 0.5 };
            item.width = 30;
            item.height = 30;
            item.tint = MANA_FULL;
            item.x = this.x + radiusX * Math.cos(deg + (degJump * (i + startOffset))) - 2;
            item.y = this.y + radiusY * Math.sin(deg + (degJump * (i + startOffset))) - 15 + YOffset;
            item.visible = false;
            this.manaCrystals[i] = item;
            this.addChild(item);
        }

        this.SetupHud();

        // Mana, deck, hand and fatigue: a status pill (DOM) next to the hero, placed in SetPosition.
        this.status = Hud.Status(isPlayer);
    }
    // Constructor
    PlayerBase.prototype = Object.create(Pixi.Sprite.prototype);
    PlayerBase.prototype.constructor = PlayerBase;

    /// The hero sprite is scaled unevenly (its texture is 385 x 255 shown as 300 x 250); the HUD container undoes
    /// that, so everything in it is placed in screen pixels relative to the hero's centre.
    PlayerBase.prototype.SetupHud = function () {
        var hud = this.hud = new Pixi.DisplayObjectContainer();
        hud.scale.x = 1 / (this._originalScale.x || 1);
        hud.scale.y = 1 / (this._originalScale.y || 1);
        var side = this.isPlayer ? 1 : -1;
        this.ringCenterY = -18 * side;

        // Can attack: green ring around the portrait
        this.glow = new Pixi.Graphics();
        this.glow.lineStyle(8, 0x4dff7a, 1);
        this.glow.drawEllipse(0, this.ringCenterY, 122, 112);
        this.glow.visible = false;

        // Valid target while aiming
        this.targetMark = new Pixi.Graphics();
        this.targetMark.visible = false;
        this.targetMarkColor = null;

        // Armor: shield next to the health heart
        this.armorBadge = new Pixi.DisplayObjectContainer();
        var shield = new Pixi.Graphics();
        shield.lineStyle(3, 0xf2f5f8, 1);
        shield.beginFill(0x7f8c99, 1);
        shield.moveTo(-22, -24);
        shield.lineTo(22, -24);
        shield.lineTo(22, 2);
        shield.lineTo(0, 26);
        shield.lineTo(-22, 2);
        shield.lineTo(-22, -24);
        shield.endFill();
        this.armorText = new Pixi.Text("0", { font: "bold 26px Arial", fill: "white", stroke: "#000000", strokeThickness: 4 });
        this.armorText.anchor = { x: 0.5, y: 0.5 };
        this.armorText.y = -4;
        this.armorBadge.addChild(shield);
        this.armorBadge.addChild(this.armorText);
        this.armorBadge.x = 136;
        this.armorBadge.y = this.isPlayer ? 50 : -50;
        this.armorBadge.visible = false;

        hud.addChild(this.glow);
        hud.addChild(this.targetMark);
        hud.addChild(this.armorBadge);
        this.addChild(hud);
    }

    PlayerBase.prototype.GetPortrait = function (portraitId) {
        var portraits =
            {
                0: Asset.Textures.PLAYER_PORTRAIT_UNKNOWN,
                1: Asset.Textures.PLAYER_PORTRAIT_ONE,
                2: Asset.Textures.PLAYER_PORTRAIT_TWO,
                3: Asset.Textures.PLAYER_PORTRAIT_THREE,
                4: Asset.Textures.PLAYER_PORTRAIT_FOUR,
                5: Asset.Textures.PLAYER_PORTRAIT_FIVE,
                6: Asset.Textures.PLAYER_PORTRAIT_SIX
            };

        if (portraits[portraitId]) {
            return Asset.GetTexture(portraits[portraitId]);
        }
        else {
            return Asset.GetTexture(portraits[0]);
        }
    }

    PlayerBase.prototype.Process = function () {
    }

    PlayerBase.prototype.Init = function () {
        this.playerNr = undefined;
    }


    /// <summary>
    /// Applies hero info from the server (GameCreate info, UseCardOk pInfo, NextTurn, GameSync heroes). The
    /// original fields are strings, the new ones numbers; any subset may be present.
    /// </summary>
    PlayerBase.prototype.SetText = function (text) {
        if (!text) return;
        this.graphicText = text;

        if (text.name) {
            this.name = text.name;
            SetLabel(this.pNamePanelText, text.name);
        }
        if (text.type !== undefined && text.type !== null && text.type !== '') {
            var type = ToNumber(text.type, 0);
            if (type !== this.type) {
                this.type = type;
                // Keep the portrait's size when its texture changes.
                this.pPortrait.setTexture(this.GetPortrait(type));
                this.pPortrait.width = 300;
                this.pPortrait.height = 250;
            }
        }
        if (text.ident !== undefined) this.ident = ToNumber(text.ident, this.ident);
        if (text.maxHealth !== undefined && text.maxHealth !== null) this.maxHealth = ToNumber(text.maxHealth, this.maxHealth);
        if (text.health !== undefined && text.health !== null && text.health !== '') {
            this.health = ToNumber(text.health, this.health);
            SetLabel(this.pHealthText, this.health);
        }
        if (this.maxHealth === undefined && typeof this.health === 'number') this.maxHealth = this.health;
        if (text.armor !== undefined && text.armor !== null) this.armor = ToNumber(text.armor, 0);
        if (text.attack !== undefined && text.attack !== null && text.attack !== '') {
            this.attack = ToNumber(text.attack, this.attack);
            SetLabel(this.pAttackText, this.attack);
        }
        if (text.maxMana !== undefined && text.maxMana !== null) this.maxMana = ToNumber(text.maxMana, this.maxMana);
        if (text.mana !== undefined && text.mana !== null && text.mana !== '') {
            this.mana = ToNumber(text.mana, 0);
        }
        if (text.hand !== undefined) this.handCount = ToNumber(text.hand, this.handCount);
        if (text.deck !== undefined) this.deckCount = ToNumber(text.deck, this.deckCount);
        if (text.fatigue !== undefined) this.fatigue = ToNumber(text.fatigue, 0);
        if (text.rating !== undefined && text.rating !== null) this.rating = ToNumber(text.rating, this.rating);
        if (text.canAttack !== undefined) this.canAttack = !!text.canAttack;
        if (text.canUsePower !== undefined) this.canUsePower = !!text.canUsePower;
        if (text.heroPowerUsed !== undefined) this.heroPowerUsed = !!text.heroPowerUsed;

        this.RefreshHud();
    }

    /// Mana crystals: maxMana crystals are shown, the spent ones dark.
    PlayerBase.prototype.UpdateManaCrystals = function () {
        var mana = typeof this.mana === 'number' ? this.mana : 0;
        var max = Math.max(typeof this.maxMana === 'number' ? this.maxMana : 0, mana);
        for (var i = 0; i < this.manaCrystals.length; i++) {
            var item = this.manaCrystals[i];
            item.visible = i < max;
            item.alpha = 1;
            item.tint = i < mana ? MANA_FULL : MANA_SPENT;
        }
    }

    PlayerBase.prototype.RefreshHud = function () {
        if (!this.hud) return;

        var damaged = typeof this.health === 'number' && typeof this.maxHealth === 'number' && this.health < this.maxHealth;
        if (this._damagedStyle !== damaged) {
            this._damagedStyle = damaged;
            this.pHealthText.setStyle({
                font: "35px Arial",
                fill: damaged ? "#ff5a4f" : "white",
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',
                wordWrapWidth: this.width
            });
        }

        this.armorBadge.visible = this.armor > 0;
        if (this.armorBadge.visible) SetLabel(this.armorText, this.armor);

        this.RefreshStatus();
        this.UpdateManaCrystals();
        this.glow.visible = !!this.isPlayer && this.canAttack && !!this.engine.myTurn && !this.isDead;
    }

    /// The status pill: mana (own hero), deck, hand and fatigue (rebuilt only when a number changes).
    PlayerBase.prototype.RefreshStatus = function () {
        if (!this.status || (this.engine && this.engine.ended)) return;
        if (typeof this.deckCount !== 'number' && typeof this.handCount !== 'number' && typeof this.mana !== 'number') return;
        this.status.Set({
            mana: typeof this.mana === 'number' ? this.mana : 0,
            maxMana: this.maxMana,
            deck: typeof this.deckCount === 'number' ? this.deckCount : null,
            hand: typeof this.handCount === 'number' ? this.handCount : null,
            fatigue: this.fatigue
        });
    }

    /// Removes the DOM parts (the game state is sent again after a reconnect).
    PlayerBase.prototype.Destroy = function () {
        if (this.status) this.status.Destroy();
        this.status = null;
    }

    /// Tints the portrait for a moment.
    PlayerBase.prototype.Flash = function (color, ms) {
        var that = this;
        this.pPortrait.tint = color;
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(function () {
            if (!that.isDead) that.pPortrait.tint = 0xFFFFFF;
        }, ms || 250);
    }

    /// Marks the hero as a valid target while the player aims (null removes the mark).
    PlayerBase.prototype.SetTargetMark = function (color) {
        if (this.targetMarkColor === color) return;
        this.targetMarkColor = color;
        this.targetMark.clear();
        if (color === null || color === undefined) {
            this.targetMark.visible = false;
            return;
        }
        this.targetMark.lineStyle(6, color, 0.95);
        this.targetMark.drawEllipse(0, this.ringCenterY, 134, 124);
        this.targetMark.visible = true;
    }

    PlayerBase.prototype.SetPosition = function (xy) {
        this.position = new Pixi.Point(xy.x, xy.y);
        this.homeX = xy.x;
        this.homeY = xy.y;
        // The status pill: ours right of the hero power (225 right of the hero, 25 up), clear of the minimized chat
        // in the corner; the opponent's (deck and hand only) under their hero power, clear of the switch and the log.
        if (this.status) {
            if (this.isPlayer) this.status.SetPosition(xy.x + 320, xy.y - 25);
            else this.status.SetPosition(xy.x + 225, xy.y + 90, true);
        }
    }

    PlayerBase.prototype.GetHome = function () {
        return { x: this.homeX !== undefined ? this.homeX : this.x, y: this.homeY !== undefined ? this.homeY : this.y };
    }

    PlayerBase.prototype.ScaleUp = function () {
        this.scale.x = this._originalScale.x * 1.08;
        this.scale.y = this._originalScale.y * 1.08;
    }

    PlayerBase.prototype.ScaleDown = function () {
        this.scale.x = this._originalScale.x;
        this.scale.y = this._originalScale.y;
    }

    /// Pulses the "can attack" glow (called every frame for the player).
    PlayerBase.prototype.PulseGlow = function () {
        if (this.glow && this.glow.visible) {
            this.glow.alpha = 0.55 + 0.45 * Math.sin(Date.now() / 220);
        }
    }

    // Heals *this* for {amount} health
    PlayerBase.prototype.Heal = function (health, src) {
        this.Animation.Heal(this.pHealthText);
        this.SetText({ health: health });
    }

    PlayerBase.prototype.AddAttack = function (attack, src) {
        this.Animation.GainAttack(this.pAttackText);
        this.SetText({ attack: attack });
    }


    return PlayerBase
});
