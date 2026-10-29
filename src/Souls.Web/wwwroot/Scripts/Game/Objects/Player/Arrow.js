define("arrow", ["jquery", "pixi", "asset", "rules"], function ($, pixi, Asset, Rules) {

    // Arrow colour per kind of action.
    var MODE_COLOR = {
        attack: 0xFF2A2A,
        ability: 0x3399FF,
        power: 0xFFC107
    };

    var CARD_HALF_WIDTH = 75;
    var CARD_HALF_HEIGHT = 105;

    Arrow = function (engine) {
        this.engine = engine;
        pixi.Graphics.call(this);

        this.filter = new pixi.ColorMatrixFilter();
        this.filters = [this.filter];

        this.originPos = {};
        this.mousePos = {};
        this.active = false;
        this.visible = false;
        this.mode = 'attack';
        this.highlighted = null;
        this.marked = [];

        var texture = Asset.GetTexture(Asset.Textures.ARROW_CORSHAIR);
        this.arrowHead = new pixi.Sprite(texture)
        this.arrowHead.anchor = { x: 0.2, y: 0.5 };
        this.arrowHead.width = 100;
        this.arrowHead.height = 100;
        this.arrowHead.visible = false;

        // What can be targeted ("Pick an enemy card"), shown next to the arrow head.
        this.hint = new pixi.Text(" ", {
            font: "bold 26px Arial",
            fill: "#ffffff",
            stroke: "#000000",
            strokeThickness: 6
        });
        this.hint.anchor = { x: 0.5, y: 1 };
        this.hint.visible = false;

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
        this.engine.getGroup("Arrow").addChild(this.hint);
    }
    // Constructor
    Arrow.prototype = Object.create(pixi.Graphics.prototype);
    Arrow.prototype.constructor = Arrow;

    function Inside(obj, mouse) {
        if (!obj || obj.isDead) return false;
        if (obj.isPlayer !== undefined) {
            // A hero
            var home = obj.GetHome ? obj.GetHome() : { x: obj.x, y: obj.y };
            return Math.abs(mouse.x - home.x) <= obj.width / 2 && Math.abs(mouse.y - home.y) <= obj.height / 2;
        }
        // A card (its face is 150 x 210)
        var sx = Math.abs(obj.scale.x || 1), sy = Math.abs(obj.scale.y || 1);
        return Math.abs(mouse.x - obj.x) <= CARD_HALF_WIDTH * sx && Math.abs(mouse.y - obj.y) <= CARD_HALF_HEIGHT * sy;
    }

    /// Everything that matches the target kinds: [{obj, kind}].
    Arrow.prototype.Candidates = function (kinds, source) {
        var list = [];
        var engine = this.engine;
        var key;
        for (var i = 0; i < kinds.length; i++) {
            var kind = kinds[i];
            if (kind === 'enemyCard' && engine.opponent) {
                for (key in engine.opponent.cardManager.board) {
                    var enemy = engine.opponent.cardManager.board[key];
                    if (!enemy.isDead) list.push({ obj: enemy, kind: kind });
                }
            }
            else if (kind === 'friendlyCard' && engine.player) {
                for (key in engine.player.cardManager.board) {
                    var friend = engine.player.cardManager.board[key];
                    // Sacrifice cannot target the card itself.
                    if (friend.isDead || (friend === source && source.abilityId == 2 && this.mode === 'ability')) continue;
                    list.push({ obj: friend, kind: kind });
                }
            }
            else if (kind === 'enemyHero' && engine.opponent) {
                list.push({ obj: engine.opponent, kind: kind });
            }
            else if (kind === 'ownHero' && engine.player) {
                list.push({ obj: engine.player, kind: kind });
            }
        }
        return list;
    }

    /// <summary>
    /// Draws the arrow from source to the pointer and finds the target under the pointer.
    /// kinds: what may be targeted ("friendlyCard", "ownHero", "enemyHero", "enemyCard");
    /// mode: "attack", "ability" or "power" (colour); hint: text shown when nothing valid is under the pointer.
    /// Returns {obj, kind} or null.
    /// </summary>
    Arrow.prototype.Aim = function (source, kinds, mode, hint) {
        var mouse = this.engine.conf.mouse;
        var origin = source.GetHome ? source.GetHome() : { x: source.x, y: source.y };
        if (source.inSlot) origin = { x: source.x, y: source.y };
        this.mode = mode;

        var color = MODE_COLOR[mode] || MODE_COLOR.attack;
        this.arrowHead.tint = color;
        this.color = color;
        this.Show();
        this.Draw(mouse, origin);

        var candidates = this.Candidates(kinds, source);

        // Mark the valid targets (abilities and hero powers; attacks show the Taunt shields instead).
        var marks = mode === 'attack' ? [] : candidates;
        this.MarkTargets(marks, color);

        var found = null;
        for (var i = 0; i < candidates.length; i++) {
            if (Inside(candidates[i].obj, mouse)) {
                found = candidates[i];
                if (candidates[i].kind !== 'enemyHero' && candidates[i].kind !== 'ownHero') break; // cards win over heroes
            }
        }

        this.Highlight(found ? found.obj : null);

        // Hint text
        var text = null;
        if (!found && mode !== 'attack') {
            text = hint || ("Pick " + Rules.DescribeTargets(kinds));
        }
        if (text) {
            if (this.hint.text !== text) this.hint.setText(text);
            this.hint.x = mouse.x;
            this.hint.y = mouse.y - 50;
            this.hint.visible = true;
        }
        else {
            this.hint.visible = false;
        }

        return found;
    }

    Arrow.prototype.Highlight = function (obj) {
        if (this.highlighted === obj) return;
        if (this.highlighted && this.highlighted.ScaleDown && !this.highlighted.isDead) this.highlighted.ScaleDown();
        this.highlighted = obj;
        if (obj && obj.ScaleUp) obj.ScaleUp();
    }

    Arrow.prototype.MarkTargets = function (candidates, color) {
        var keep = [];
        var i;
        for (i = 0; i < candidates.length; i++) {
            var obj = candidates[i].obj;
            if (obj.SetTargetMark) obj.SetTargetMark(color);
            keep.push(obj);
        }
        for (i = 0; i < this.marked.length; i++) {
            if (keep.indexOf(this.marked[i]) === -1 && this.marked[i].SetTargetMark) this.marked[i].SetTargetMark(null);
        }
        this.marked = keep;
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
        this.arrowHead.rotation = Math.atan2(deltaY, deltaX);
        this.arrowHead.x = mouse.x;
        this.arrowHead.y = mouse.y;

        // Draw the arrow shaft
        this.clear();
        this.lineStyle(5, this.color || 0xff0000, 1);
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
        this.active = true;
    }

    Arrow.prototype.Hide = function () {
        if (this.visible) {
            this.visible = false;
            this.arrowHead.visible = false;
            this.arrowHeadTween.setPaused(true);
        }
        this.hint.visible = false;
    }

    Arrow.prototype.Reset = function () {
        if (this.active) {
            $("#game-window").css("cursor", "");

            this.arrowHead.visible = false;
            this.active = false;

            this.Hide();
        }
        this.Highlight(null);
        if (this.marked.length) this.MarkTargets([], null);
        if (this.engine.opponent) this.engine.opponent.ScaleDown();
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
