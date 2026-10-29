// The turn timer: a burning rope under the End Turn button that counts down the current turn (75 s on the
// server). It turns red and pulses in the last 15 seconds.
define("turntimer", ["pixi", "conf"], function (Pixi, Conf) {

    var WIDTH = 240;
    var HEIGHT = 16;
    var URGENT_MS = 15000;

    TurnTimer = function (engine) {
        Pixi.DisplayObjectContainer.call(this);
        this.engine = engine;
        this.endsAt = 0;
        this.total = 75000;
        this.mine = false;
        this.running = false;
        this.urgent = null;

        this.back = new Pixi.Graphics();
        this.back.beginFill(0x000000, 0.6);
        this.back.lineStyle(2, 0x6b5537, 1);
        this.back.drawRect(-WIDTH / 2 - 3, -HEIGHT / 2 - 3, WIDTH + 6, HEIGHT + 6);
        this.back.endFill();

        // The rope is drawn from its left end, so scale.x is the time left.
        this.rope = new Pixi.Graphics();
        this.rope.x = -WIDTH / 2;

        this.spark = new Pixi.Graphics();
        this.spark.beginFill(0xffe082, 0.45);
        this.spark.drawCircle(0, 0, 14);
        this.spark.endFill();
        this.spark.beginFill(0xfff3c4, 1);
        this.spark.drawCircle(0, 0, 6);
        this.spark.endFill();

        this.label = new Pixi.Text(" ", { font: "bold 22px Arial", fill: "#f3e9d2", stroke: "#000000", strokeThickness: 5 });
        this.label.anchor = { x: 0.5, y: 0 };
        this.label.y = HEIGHT / 2 + 6;

        this.addChild(this.back);
        this.addChild(this.rope);
        this.addChild(this.spark);
        this.addChild(this.label);

        this.x = Conf.width - 310;
        this.y = (Conf.height / 2) + 10 + 60;
        this.visible = false;
        this.DrawRope(false);
    };

    TurnTimer.prototype = Object.create(Pixi.DisplayObjectContainer.prototype);
    TurnTimer.prototype.constructor = TurnTimer;

    TurnTimer.prototype.DrawRope = function (urgent) {
        if (this.urgent === urgent) return;
        this.urgent = urgent;
        this.rope.clear();
        this.rope.beginFill(urgent ? 0xe53935 : 0xc8a165, 1);
        this.rope.drawRect(0, -HEIGHT / 2, WIDTH, HEIGHT);
        this.rope.endFill();
        // Twist marks
        this.rope.lineStyle(2, urgent ? 0x7f1d1d : 0x7a5a30, 0.8);
        for (var x = 8; x < WIDTH; x += 14) {
            this.rope.moveTo(x, -HEIGHT / 2);
            this.rope.lineTo(x + 7, HEIGHT / 2);
        }
    }

    /// Starts the countdown: turnEndsIn ms from now, out of turnTime; mine = it is the player's turn.
    TurnTimer.prototype.Set = function (turnEndsIn, turnTime, mine) {
        var left = Number(turnEndsIn);
        if (!isFinite(left)) return;
        left = Math.max(0, left);
        if (Number(turnTime) > 0) this.total = Number(turnTime);
        this.endsAt = Date.now() + left;
        this.mine = !!mine;
        this.running = true;
        this.visible = true;
        this._shown = null;
    }

    TurnTimer.prototype.Stop = function () {
        this.running = false;
        this.visible = false;
    }

    TurnTimer.prototype.Remaining = function () {
        return this.running ? Math.max(0, this.endsAt - Date.now()) : 0;
    }

    TurnTimer.prototype.Process = function () {
        if (!this.running) return;
        var left = this.Remaining();
        var fraction = Math.max(0, Math.min(1, left / (this.total || 75000)));
        var urgent = left <= URGENT_MS;

        this.DrawRope(urgent);
        this.rope.scale.x = Math.max(0.001, fraction);
        this.spark.x = -WIDTH / 2 + WIDTH * fraction;
        this.spark.visible = left > 0;
        this.spark.scale.x = this.spark.scale.y = 0.8 + 0.35 * Math.abs(Math.sin(Date.now() / 90));
        this.rope.alpha = urgent ? 0.65 + 0.35 * Math.abs(Math.sin(Date.now() / 160)) : 1;

        var seconds = Math.ceil(left / 1000);
        var shown = (this.mine ? "Your turn " : "Opponent's turn ") + Math.floor(seconds / 60) + ":" + ("0" + (seconds % 60)).slice(-2);
        if (shown !== this._shown) {
            this._shown = shown;
            this.label.setText(shown);
            this.label.setStyle({
                font: "bold 22px Arial",
                fill: urgent ? "#ff6b5e" : "#f3e9d2",
                stroke: "#000000",
                strokeThickness: 5
            });
        }
    }

    return TurnTimer;
});
