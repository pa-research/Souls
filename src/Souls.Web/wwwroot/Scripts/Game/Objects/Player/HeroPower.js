// The hero power button next to a hero (cost 2, once per turn): a DOM element over the canvas
// (button.sg-power > span.sg-power-orb > icon + span.sg-power-cost, span.sg-power-name). The player's own power is
// used by
//  - a click / tap (Fade, no target),
//  - dragging from the button to a target, like an attack,
//  - a click / tap on the button and then a click / tap on a target (Escape, a click elsewhere or on the button
//    again cancels; Enter / Space on the focused button work like a click).
// The aiming arrow and the valid targets are the classic ones (Player.UpdateAim reads Conf.mouse, which is set here
// from the pointer while it is over the button). The opponent's power is only shown.
// States: .ready (usable now), .armed (choosing a target), .used (used this turn); aria-disabled when not usable
// (kept focusable and hoverable, so its tooltip and the reason it cannot be used still show).
define("heropower", ["hud", "rules", "animation"], function (Hud, Rules, Animation) {

    var ICONS = { 1: 'flame', 2: 'droplet', 3: 'sparkles', 4: 'shield-plus' };
    var RADIUS = 46;        // stage units: the area of the power for Contains() and effects
    var ORB_HALF = 33;      // half the orb's CSS height: the element is placed by the orb's centre
    var DRAG_PX = 10;       // moving further than this from the press turns it into a drag
    var OWN_SCALE = 1.2;    // relative to the board scale: about the 3D client's size next to the classic hero frame
    var FOE_SCALE = 0.95;

    HeroPower = function (engine, owner, interactive) {
        this.engine = engine;
        this.owner = owner;
        this.isOwn = !!interactive;
        this.heroType = 0;
        this.cost = 2;
        this.canUse = false;
        this.used = false;
        this.pending = false;
        this.aiming = false;   // the arrow follows the pointer (drag, or armed)
        this.armed = false;    // clicked: the next click / tap on the board picks the target
        this.pressed = false;
        this.hovered = false;
        this.focused = false;
        this.target = null;
        this.x = 0;
        this.y = 0;
        this.visible = true;

        var el = this.el = Hud.El(this.isOwn ? 'button' : 'div',
            'sg-power ' + (this.isOwn ? 'souls-classic-power-own' : 'souls-classic-power-foe'), Hud.Root());
        if (this.isOwn) el.type = 'button';
        else el.setAttribute('role', 'img');
        this.orb = Hud.El('span', 'sg-power-orb', el);
        this.icon = Hud.Icon('zap');
        this.orb.appendChild(this.icon);
        this.costText = Hud.El('span', 'sg-power-cost', this.orb, String(this.cost));
        this.costText.setAttribute('aria-hidden', 'true');
        this.label = Hud.El('span', 'sg-power-name', el, 'Hero power');
        this.label.setAttribute('aria-hidden', 'true');

        this.Bind();
        var that = this;
        this.untrack = Hud.Track(function () { that.Layout(); });
        this.Redraw();
    };

    HeroPower.prototype.constructor = HeroPower;
    HeroPower.RADIUS = RADIUS;
    HeroPower.SwallowTouch = SwallowTouch; // a spell picks its target the same way (Card.OnPick)

    function TouchOf(e) {
        var list = (e.changedTouches && e.changedTouches.length) ? e.changedTouches : e.touches;
        return list && list.length ? list[0] : null;
    }

    HeroPower.prototype.Bind = function () {
        var that = this;
        var el = this.el;

        el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') that.SetHovered(true); });
        el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') that.SetHovered(false); });
        el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        if (!this.isOwn) {
            // Touch: a tap shows what the opponent's power does.
            el.addEventListener('pointerdown', function (e) {
                if (e.pointerType !== 'mouse' && that.engine.tooltip) that.engine.tooltip.Pin(that, 3000);
            });
            return;
        }

        el.addEventListener('pointerdown', function (e) { that.OnDown(e); });
        el.addEventListener('pointermove', function (e) { that.OnMove(e); });
        el.addEventListener('pointerup', function (e) { that.OnUp(e); });
        el.addEventListener('pointercancel', function (e) { that.OnCancel(e); });
        el.addEventListener('lostpointercapture', function (e) { if (that.pressed) that.OnCancel(e); });
        // Keyboard (Enter / Space): pointer clicks are handled above.
        el.addEventListener('click', function (e) { if (e.detail === 0) that.OnKey(); });
        el.addEventListener('focus', function () { that.focused = true; });
        el.addEventListener('blur', function () { that.focused = false; });

        // While armed: the next press on the board picks the target (it never reaches the board itself).
        this.onPick = function (e) { that.OnPick(e); };
        this.onKey = function (e) {
            if (e.key === 'Escape' && (that.armed || that.aiming)) that.Disarm();
        };
        this.onWindowMove = function (e) {
            if (!that.armed || that.pressed) return;
            if (e.target === that.el || that.el.contains(e.target)) that.engine.SetPointer(Hud.ToStage(e.clientX, e.clientY), false);
        };
    }

    HeroPower.prototype.SetType = function (heroType) {
        heroType = Number(heroType) || 0;
        if (heroType === this.heroType) return;
        this.heroType = heroType;
        this.cost = Rules.PowerCost(heroType);
        this.costText.textContent = String(this.cost);
        var power = Rules.HeroPower(heroType);
        this.label.textContent = power ? power.name : 'Hero power';
        var icon = Hud.Icon(ICONS[heroType] || 'zap');
        this.orb.replaceChild(icon, this.icon);
        this.icon = icon;
        this.Redraw();
    }

    /// {canUsePower, heroPowerUsed} from GameSync.
    HeroPower.prototype.SetState = function (canUse, used) {
        this.canUse = !!canUse;
        this.used = !!used;
        this.pending = false;
        if (!this.canUse && (this.armed || this.aiming)) this.Disarm();
        this.Redraw();
    }

    HeroPower.prototype.Kinds = function () {
        return Rules.PowerTargets(this.heroType);
    }

    /// Usable right now (the server says so and no request is on its way).
    HeroPower.prototype.Usable = function () {
        return this.isOwn && this.canUse && !this.pending && !this.engine.ended;
    }

    HeroPower.prototype.Redraw = function () {
        var el = this.el;
        var ready = this.Usable();
        var power = Rules.HeroPower(this.heroType);
        var name = power ? power.name : 'Hero power';

        el.classList.toggle('ready', ready && !this.armed && !this.aiming);
        el.classList.toggle('armed', this.armed || this.aiming);
        el.classList.toggle('used', this.used);

        if (this.isOwn) {
            el.setAttribute('aria-disabled', String(!ready));
            el.setAttribute('aria-pressed', String(this.armed));
            var state = this.used ? ', used this turn' : (ready ? '' : ', not available now');
            el.setAttribute('aria-label', 'Hero power: ' + name + ' (' + this.cost + ' mana)' + state);
        }
        else {
            el.setAttribute('aria-label', "Opponent's hero power: " + name + ' (' + this.cost + ' mana)' + (this.used ? ', used this turn' : ''));
        }
    }

    /// Where the orb's centre is, in stage coordinates.
    HeroPower.prototype.SetPosition = function (x, y) {
        this.x = x;
        this.y = y;
        this.Layout();
    }

    HeroPower.prototype.Layout = function () {
        Hud.Place(this.el, this.x, this.y, {
            dx: '-50%',
            dy: '-' + ORB_HALF + 'px',
            origin: '50% ' + ORB_HALF + 'px',
            scale: this.isOwn ? OWN_SCALE : FOE_SCALE
        });
    }

    HeroPower.prototype.GetHome = function () {
        return { x: this.x, y: this.y };
    }

    /// The button's box on screen (tooltips are placed next to it).
    HeroPower.prototype.TipRect = function () {
        return this.orb.getBoundingClientRect();
    }

    HeroPower.prototype.Contains = function (point) {
        if (!point) return false;
        var dx = point.x - this.x, dy = point.y - this.y;
        return dx * dx + dy * dy <= (RADIUS + 6) * (RADIUS + 6);
    }

    HeroPower.prototype.SetHovered = function (hovered) {
        this.hovered = !!hovered;
    }

    /// Called every frame (own power).
    HeroPower.prototype.Process = function () {
        if ((this.armed || this.aiming) && !this.pressed && !this.Usable()) this.Disarm();
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

    // ---- Pointer gestures ----------------------------------------------------------------------------------------

    HeroPower.prototype.OnDown = function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var touch = e.pointerType !== 'mouse';
        if (e.preventDefault) e.preventDefault();

        if (this.armed) {
            // Pressing the button again cancels the targeting.
            this.Disarm();
            return;
        }
        if (!this.Usable()) {
            this.engine.ScreenMessage([this.Reason()], false);
            if (touch && this.engine.tooltip) this.engine.tooltip.Pin(this, 3000);
            return;
        }

        this.pressed = true;
        this.pointerId = e.pointerId;
        this.touch = touch;
        this.downAt = { x: e.clientX, y: e.clientY };
        this.dragged = false;
        try { this.el.setPointerCapture(e.pointerId); } catch (x) { /* capture is optional */ }
        this.engine.SetPointer(Hud.ToStage(e.clientX, e.clientY), touch);

        if (this.Kinds().length > 0) {
            this.aiming = true;
            this.target = null;
        }
        this.Redraw();
    }

    HeroPower.prototype.OnMove = function (e) {
        if (!this.pressed || e.pointerId !== this.pointerId) return;
        this.engine.SetPointer(Hud.ToStage(e.clientX, e.clientY), this.touch);
        var dx = e.clientX - this.downAt.x, dy = e.clientY - this.downAt.y;
        if (dx * dx + dy * dy > DRAG_PX * DRAG_PX) this.dragged = true;
    }

    HeroPower.prototype.OnUp = function (e) {
        if (!this.pressed || e.pointerId !== this.pointerId) return;
        this.pressed = false;
        try { this.el.releasePointerCapture(e.pointerId); } catch (x) { /* capture is optional */ }
        var touch = this.touch;
        this.engine.SetPointer(Hud.ToStage(e.clientX, e.clientY), touch);
        var inside = Hud.Contains(this.el.getBoundingClientRect(), e.clientX, e.clientY);

        if (this.Kinds().length === 0) {
            // No target (Fade): a click uses it.
            if (inside) this.Use(-1, 1);
        }
        else if (this.dragged) {
            // Dragged: released on a target uses it, anywhere else cancels.
            if (this.owner) this.owner.UpdateAim();
            var found = this.target;
            this.StopAiming();
            if (found && found.obj && !inside) this.UseOn(found);
        }
        else {
            // A click / tap: pick the target next.
            this.Arm(touch);
        }

        this.Redraw();
        if (touch && !this.armed) this.engine.ClearPointer();
    }

    HeroPower.prototype.OnCancel = function (e) {
        if (!this.pressed) return;
        this.pressed = false;
        this.StopAiming();
        if (this.touch) this.engine.ClearPointer();
    }

    /// Enter / Space on the focused button.
    HeroPower.prototype.OnKey = function () {
        if (this.armed) {
            this.Disarm();
            return;
        }
        if (!this.Usable()) {
            this.engine.ScreenMessage([this.Reason()], false);
            return;
        }
        if (this.Kinds().length === 0) this.Use(-1, 1);
        else this.Arm(false);
    }

    /// Click-then-pick: the arrow follows the pointer until the next press picks a target or cancels.
    HeroPower.prototype.Arm = function (touch) {
        if (this.armed) return;
        this.armed = true;
        this.aiming = true;
        this.target = null;
        window.addEventListener('mousedown', this.onPick, true);
        window.addEventListener('touchstart', this.onPick, { capture: true, passive: false });
        window.addEventListener('keydown', this.onKey, true);
        window.addEventListener('pointermove', this.onWindowMove, true);
        if (touch && this.engine.tooltip) this.engine.tooltip.Pin(this, 4000);
        this.Redraw();
    }

    HeroPower.prototype.Disarm = function () {
        var was = this.armed || this.aiming;
        if (this.armed) {
            window.removeEventListener('mousedown', this.onPick, true);
            window.removeEventListener('touchstart', this.onPick, { capture: true, passive: false });
            window.removeEventListener('keydown', this.onKey, true);
            window.removeEventListener('pointermove', this.onWindowMove, true);
        }
        this.armed = false;
        this.StopAiming();
        if (was && this.engine.tooltip && this.engine.tooltip.pinned === this) this.engine.tooltip.Pin(null, 0);
    }

    HeroPower.prototype.StopAiming = function () {
        this.aiming = false;
        this.target = null;
        if (this.owner && this.owner.arrow) this.owner.arrow.Reset();
        this.Redraw();
    }

    /// A press anywhere while armed: on the board it picks the target under it (or cancels); on another control it
    /// cancels and lets that control act.
    HeroPower.prototype.OnPick = function (e) {
        if (!this.armed) return;
        var target = e.target;
        if (target === this.el || (this.el.contains && this.el.contains(target))) return; // the button cancels itself

        var canvas = Hud.Canvas();
        if (!canvas || target !== canvas) {
            this.Disarm();
            return;
        }

        var touch = e.type === 'touchstart';
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        if (touch) SwallowTouch(e);
        if (!touch && e.button !== 0) {
            this.Disarm(); // a right click cancels
            return;
        }

        var point = touch ? TouchOf(e) : e;
        if (point) this.engine.SetPointer(Hud.ToStage(point.clientX, point.clientY), touch);
        if (this.owner) this.owner.UpdateAim();
        var found = this.target;
        this.Disarm();
        if (found && found.obj) this.UseOn(found);
        if (touch) this.engine.ClearPointer();
    }

    /// The board never saw the start of this touch (it picked the target), so it must not see the rest either: Pixi
    /// expects a touchstart before every touchmove / touchend.
    function SwallowTouch(start) {
        var ids = [];
        var list = start.changedTouches || [];
        for (var i = 0; i < list.length; i++) ids.push(list[i].identifier);
        if (!ids.length) return;
        var options = { capture: true, passive: false };

        function Swallow(e) {
            var touches = e.changedTouches || [];
            var ours = false;
            for (var j = 0; j < touches.length; j++) {
                var at = ids.indexOf(touches[j].identifier);
                if (at === -1) continue;
                ours = true;
                if (e.type !== 'touchmove') ids.splice(at, 1);
            }
            if (!ours) return;
            e.stopPropagation();
            if (e.type !== 'touchmove' && e.cancelable && e.preventDefault) e.preventDefault();
            if (!ids.length) {
                window.removeEventListener('touchmove', Swallow, options);
                window.removeEventListener('touchend', Swallow, options);
                window.removeEventListener('touchcancel', Swallow, options);
            }
        }
        window.addEventListener('touchmove', Swallow, options);
        window.addEventListener('touchend', Swallow, options);
        window.addEventListener('touchcancel', Swallow, options);
    }

    HeroPower.prototype.UseOn = function (found) {
        var cid = (found.kind === 'enemyCard' || found.kind === 'friendlyCard') ? found.obj.cid : -1;
        this.Use(cid, Rules.TargetType[found.kind]);
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

    // ---- Visibility ----------------------------------------------------------------------------------------------

    /// Faded (the hero has fallen).
    HeroPower.prototype.SetDimmed = function (dimmed) {
        this.el.style.opacity = dimmed ? '0.3' : '';
    }

    HeroPower.prototype.Hide = function () {
        if (this.isOwn) this.Disarm();
        this.visible = false;
        this.hovered = false;
        this.el.hidden = true;
    }

    HeroPower.prototype.Show = function () {
        this.visible = true;
        this.el.hidden = false;
    }

    HeroPower.prototype.Destroy = function () {
        if (this.isOwn) this.Disarm();
        clearTimeout(this._pendingTimer);
        if (this.untrack) this.untrack();
        this.untrack = null;
        this.hovered = false;
        Hud.Remove(this.el);
    }

    return HeroPower;
});
