// The hero power button next to a hero (cost 2, once per turn). The player's own button is clicked (Fade, no
// target) or dragged to a target like an attack (the other powers); the opponent's is only shown.
define("heropower", ["pixi", "asset", "rules", "animation", "card"], function (Pixi, Asset, Rules, Animation, Card) {

    var RADIUS = 46;

    // Disc colour by class
    var CLASS_COLOR = { 1: 0xa8322a, 2: 0x6c3483, 3: 0xc99a10, 4: 0x2e75b6 };

    HeroPower = function (engine, owner, interactive) {
        Pixi.DisplayObjectContainer.call(this);
        this.engine = engine;
        this.owner = owner;
        this.heroType = 0;
        this.cost = 2;
        this.canUse = false;
        this.used = false;
        this.pending = false;
        this.aiming = false;
        this.armed = false;
        this.hovered = false;
        this.target = null;
        this.isOwn = !!interactive;

        this.ring = new Pixi.Graphics();
        this.disc = new Pixi.Graphics();
        this.icon = new Pixi.Graphics();

        // Cost gem
        this.gem = new Pixi.Graphics();
        this.gem.beginFill(0x2f6fd0, 1);
        this.gem.lineStyle(3, 0xd8e8ff, 1);
        this.gem.drawCircle(0, 0, 17);
        this.gem.endFill();
        this.gem.x = 0;
        this.gem.y = -RADIUS - 2;
        this.costText = new Pixi.Text("2", { font: "bold 22px Arial", fill: "white", stroke: "#000000", strokeThickness: 4 });
        this.costText.anchor = { x: 0.5, y: 0.5 };
        this.costText.y = -1;
        this.gem.addChild(this.costText);

        // Name below the disc
        this.label = new Pixi.Text(" ", { font: "bold 18px Arial", fill: "#f3e9d2", stroke: "#000000", strokeThickness: 5, align: "center" });
        this.label.anchor = { x: 0.5, y: 0 };
        this.label.y = RADIUS + 4;

        // "Used" mark
        this.usedText = new Pixi.Text("USED", { font: "bold 20px Arial", fill: "#dddddd", stroke: "#000000", strokeThickness: 5 });
        this.usedText.anchor = { x: 0.5, y: 0.5 };
        this.usedText.visible = false;

        this.addChild(this.ring);
        this.addChild(this.disc);
        this.addChild(this.icon);
        this.addChild(this.usedText);
        this.addChild(this.gem);
        this.addChild(this.label);

        this.hitArea = new Pixi.Circle(0, 0, RADIUS + 6);
        this.interactive = this.isOwn;
        this.Redraw();
    };

    HeroPower.prototype = Object.create(Pixi.DisplayObjectContainer.prototype);
    HeroPower.prototype.constructor = HeroPower;
    HeroPower.RADIUS = RADIUS;

    HeroPower.prototype.SetType = function (heroType) {
        heroType = Number(heroType) || 0;
        if (heroType === this.heroType) return;
        this.heroType = heroType;
        this.cost = Rules.PowerCost(heroType);
        this.costText.setText(String(this.cost));
        var power = Rules.HeroPower(heroType);
        this.label.setText(power ? power.name : "Hero power");
        this.Redraw();
    }

    /// {canUsePower, heroPowerUsed} from GameSync.
    HeroPower.prototype.SetState = function (canUse, used) {
        this.canUse = !!canUse;
        this.used = !!used;
        this.pending = false;
        this.Redraw();
    }

    HeroPower.prototype.Kinds = function () {
        return Rules.PowerTargets(this.heroType);
    }

    HeroPower.prototype.Redraw = function () {
        var usable = this.canUse && !this.pending && this.isOwn;
        var kinds = this.Kinds();
        var color = CLASS_COLOR[this.heroType] || 0x555555;

        this.ring.clear();
        this.ring.lineStyle(7, usable ? 0xffd54a : 0x8a8a8a, 1);
        this.ring.drawCircle(0, 0, RADIUS + 3);

        this.disc.clear();
        this.disc.beginFill(0x15100c, 1);
        this.disc.drawCircle(0, 0, RADIUS);
        this.disc.endFill();
        this.disc.beginFill(color, 1);
        this.disc.drawCircle(0, 0, RADIUS - 6);
        this.disc.endFill();

        // Icon: damage (enemy targets) = bolt, healing (friendly targets) = cross, no target = shield
        this.icon.clear();
        if (kinds.indexOf('enemyCard') !== -1 || kinds.indexOf('enemyHero') !== -1) {
            Card.DrawBolt(this.icon, 24);
        }
        else if (kinds.length > 0) {
            this.icon.beginFill(0xffffff, 1);
            this.icon.drawRect(-7, -22, 14, 44);
            this.icon.drawRect(-22, -7, 44, 14);
            this.icon.endFill();
        }
        else {
            Card.DrawShield(this.icon, 38, 44, 0xb8c4cf, 0xffffff);
        }

        this.usedText.visible = this.used;
        this.icon.alpha = this.used ? 0.35 : 1;
        this.alpha = usable || !this.isOwn ? 1 : 0.7;
        if (!this.isOwn) this.alpha = this.used ? 0.7 : 0.95;
    }

    HeroPower.prototype.GetHome = function () {
        return { x: this.x, y: this.y };
    }

    HeroPower.prototype.Contains = function (point) {
        var dx = point.x - this.x, dy = point.y - this.y;
        return dx * dx + dy * dy <= (RADIUS + 6) * (RADIUS + 6);
    }

    HeroPower.prototype.Process = function () {
        this.hovered = this.isOwn && this.Contains(this.engine.conf.mouse);
        var usable = this.canUse && !this.pending;
        this.ring.alpha = usable ? 0.65 + 0.35 * Math.sin(Date.now() / 260) : 1;
    }

    /// Glow when a hero power is used (event).
    HeroPower.prototype.Activate = function () {
        Animation.Fx.Burst(this.engine, this.x, this.y, 0xffd54a, RADIUS);
    }

    /// Why the power cannot be used right now.
    HeroPower.prototype.Reason = function () {
        if (!this.engine.myTurn) return "Not your turn!";
        if (this.used) return "Hero power already used this turn!";
        if (this.owner && typeof this.owner.mana === 'number' && this.owner.mana < this.cost) return "Not enough mana!";
        return "Cannot use the hero power now!";
    }

    HeroPower.prototype.mousedown = HeroPower.prototype.touchstart = function (mouseData) {
        if (!this.isOwn) return;
        var pointer = Card.Pointer(mouseData);
        if (pointer.right) return;
        this.engine.SetPointer(mouseData.global, pointer.touch);
        this._downAt = Date.now();

        if (!this.canUse || this.pending) {
            this.engine.ScreenMessage([this.Reason()], false);
            if (pointer.touch && this.engine.tooltip) this.engine.tooltip.Pin(this, 3000);
            return;
        }

        if (this.Kinds().length === 0) {
            this.armed = true; // used on release over the button (a click)
        }
        else {
            this.aiming = true;
            this.target = null;
        }
    }

    HeroPower.prototype.Release = function (mouseData, inside) {
        var pointer = Card.Pointer(mouseData);
        if (pointer.touch) this.engine.SetPointer(mouseData.global, true);

        if (this.armed) {
            this.armed = false;
            if (inside) this.Use(-1, 1);
        }
        else if (this.aiming) {
            if (pointer.touch && this.owner) this.owner.UpdateAim();
            var found = this.target;
            this.aiming = false;
            this.target = null;
            if (this.owner) this.owner.arrow.Reset();
            if (found && found.obj) {
                var cid = (found.kind === 'enemyCard' || found.kind === 'friendlyCard') ? found.obj.cid : -1;
                this.Use(cid, Rules.TargetType[found.kind]);
            }
            else if (inside && pointer.touch && this.engine.tooltip) {
                this.engine.tooltip.Pin(this, 3000);
            }
        }

        if (pointer.touch) this.engine.ClearPointer();
    }

    HeroPower.prototype.mouseup = HeroPower.prototype.touchend = function (mouseData) {
        this.Release(mouseData, true);
    }

    HeroPower.prototype.mouseupoutside = HeroPower.prototype.touchendoutside = function (mouseData) {
        this.Release(mouseData, false);
    }

    HeroPower.prototype.Use = function (targetCid, type) {
        // Dimmed until the next GameSync; if the server refuses (no sync follows) it comes back after a moment.
        var that = this;
        this.pending = true;
        this.Redraw();
        clearTimeout(this._pendingTimer);
        this._pendingTimer = setTimeout(function () {
            if (that.pending) {
                that.pending = false;
                that.Redraw();
            }
        }, 2500);
        this.engine.gameService.Request_HeroPower(targetCid, type);
    }

    return HeroPower;
});
