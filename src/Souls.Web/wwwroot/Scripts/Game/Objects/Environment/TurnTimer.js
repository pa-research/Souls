// The turn timer: a burning fuse (.sg-fuse) under the End Turn button that counts down the current turn (75 s on
// the server), "Your turn · 0:42" / "Enemy turn · 0:42". It turns red and pulses in the last 15 seconds.
define("turntimer", ["hud", "conf"], function (Hud, Conf) {

    var URGENT_MS = 15000;
    // Under the End Turn button (centre (width - 310, height / 2 + 10), 75 high).
    var X = Conf.width - 310;
    var Y = Conf.height / 2 + 10 + 37 + 14;

    TurnTimer = function (engine) {
        this.engine = engine;
        this.endsAt = 0;
        this.total = 75000;
        this.mine = false;
        this.running = false;
        this.urgent = null;
        this._shown = null;
        this._width = null;

        var fuse = this.el = Hud.El('div', 'sg-fuse souls-classic-fuse', Hud.Root());
        fuse.setAttribute('role', 'timer');
        fuse.setAttribute('aria-label', 'Turn timer');
        fuse.hidden = true;
        var track = Hud.El('div', 'sg-fuse-track', fuse);
        this.fill = Hud.El('div', 'sg-fuse-fill', track);
        this.text = Hud.El('div', 'sg-fuse-text', fuse);

        this.untrack = Hud.Track(function (hud) {
            hud.Place(fuse, X, Y, { dx: '-50%', dy: '0px' });
        });
    };

    TurnTimer.prototype.constructor = TurnTimer;

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
        this.el.hidden = false;
        this.el.classList.toggle('enemy', !this.mine);
        this._shown = null;
        this.Process();
    }

    TurnTimer.prototype.Stop = function () {
        this.running = false;
        this.visible = false;
        this.el.hidden = true;
    }

    TurnTimer.prototype.Remaining = function () {
        return this.running ? Math.max(0, this.endsAt - Date.now()) : 0;
    }

    /// Called every frame: the fuse burns down.
    TurnTimer.prototype.Process = function () {
        if (!this.running) return;
        var left = this.Remaining();
        var fraction = Math.max(0, Math.min(1, left / (this.total || 75000)));
        var width = (Math.round(fraction * 1000) / 10) + '%';
        if (width !== this._width) {
            this._width = width;
            this.fill.style.width = width;
        }

        var urgent = left <= URGENT_MS;
        if (urgent !== this.urgent) {
            this.urgent = urgent;
            this.el.classList.toggle('urgent', urgent);
        }

        var shown = (this.mine ? 'Your turn' : 'Enemy turn') + ' · ' + Hud.Clock(left);
        if (shown !== this._shown) {
            this._shown = shown;
            this.text.textContent = shown;
        }
    }

    TurnTimer.prototype.Destroy = function () {
        if (this.untrack) this.untrack();
        Hud.Remove(this.el);
    }

    return TurnTimer;
});
