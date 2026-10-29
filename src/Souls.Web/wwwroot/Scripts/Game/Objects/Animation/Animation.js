define("animation", ['tweenjs', 'easeljs', 'asset', 'pixi'], function (_, CreateJS, Asset, Pixi) {

    Animation = function () {

    }

    Animation.prototype.constructor = Animation;
    Animation.prototype.Card = {};
    Animation.prototype.Player = {};
    Animation.prototype.General = {};
    Animation.prototype.Fx = {};

    // Durations (ms) of the animations below; the game service waits this long before the next message.
    Animation.prototype.Duration = {
        LUNGE_IMPACT: 360,
        LUNGE_TOTAL: 760,
        DEATH: 520,
        FLOAT: 1300,
        PROJECTILE: 360
    };

    function PlaySound(sound, volume) {
        try {
            var instance = Asset.GetSound(sound);
            if (instance && instance.play) instance.play({ volume: volume === undefined ? 0.5 : volume });
        }
        catch (e) { /* sound is optional */ }
    }
    Animation.prototype.PlaySound = PlaySound;

    /// Tweens properties of a display object; scaleX/scaleY address object.scale. Calls done at the end.
    function Animate(target, to, duration, ease, done) {
        var values = {};
        var key;
        for (key in to) {
            if (key === 'scaleX') values[key] = target.scale.x;
            else if (key === 'scaleY') values[key] = target.scale.y;
            else values[key] = target[key];
        }

        function apply() {
            for (var k in to) {
                if (k === 'scaleX') target.scale.x = values[k];
                else if (k === 'scaleY') target.scale.y = values[k];
                else target[k] = values[k];
            }
        }

        return CreateJS.Tween.get(values, { onChange: apply })
            .to(to, duration, ease || CreateJS.Ease.linear)
            .call(function () {
                apply();
                if (done) done();
            });
    }
    Animation.prototype.Animate = Animate;

    /// Where an object (card or hero) rests when it is not animated.
    function Home(obj) {
        if (obj.GetHome) return obj.GetHome();
        return { x: obj.x, y: obj.y };
    }
    Animation.prototype.Home = Home;

    function Remove(obj) {
        if (obj && obj.parent) obj.parent.removeChild(obj);
    }


    ///////////////////////////////////////////////////////////////////
    ////////////////////////////// CARDS //////////////////////////////
    ///////////////////////////////////////////////////////////////////

    /// Short shake of a card or hero that was hit.
    Animation.prototype.Card.Defend = Animation.prototype.Shake = function (defender) {
        // Not while it is dead or in the middle of its own attack (the attack brings it home).
        if (!defender || defender.isDead || defender._lunging) return;
        var home = Home(defender);
        var speed = 45;
        var step = (defender.isPlayer === undefined) ? 14 : 10; // heroes shake less

        // No override: a tween that moves or flips the card (put in slot) keeps running; the shake only moves x.
        CreateJS.Tween.get(defender, { override: false })
            .to({ x: home.x - step }, speed)
            .to({ x: home.x + step }, speed)
            .to({ x: home.x - step * 0.6 }, speed)
            .to({ x: home.x + step * 0.6 }, speed)
            .to({ x: home.x }, speed)
            .call(function () {
                if (defender.owner && defender.owner == defender.engine.player && !defender.isDead) {
                    defender.interactive = true;
                }
            });
    }

    /// An attack (based on the original card attack: jump to the defender, hit it, return). The attacker can be a
    /// card or a hero. onImpact is called when it hits. Returns the duration until it is back.
    Animation.prototype.Lunge = function (attacker, defender, onImpact) {
        var D = Animation.prototype.Duration;
        var impacted = false;
        function impact() {
            if (impacted) return;
            impacted = true;
            if (onImpact) onImpact();
        }

        if (!attacker || !defender || attacker.isDead) {
            setTimeout(impact, 0);
            return D.LUNGE_IMPACT;
        }

        var engine = attacker.engine;
        var isCard = attacker.isPlayer === undefined; // heroes have isPlayer
        var home = Home(attacker);
        var target = Home(defender);
        var delta = { x: target.x - home.x, y: target.y - home.y };
        var reach = isCard ? 0.78 : 0.55;

        var homeGroup = attacker.parent;
        if (engine && engine.getGroup("Attacker") && homeGroup) {
            engine.getGroup("Attacker").addChild(attacker);
        }

        var wasInteractive = attacker.interactive;
        attacker.interactive = false;
        attacker._lunging = true;
        PlaySound(Asset.Sound.ATTACK_1, 0.5);

        var values = { x: home.x, y: home.y, s: attacker.scale.x || 1 };
        var baseScale = values.s;
        var tween = CreateJS.Tween.get(values, {
            override: false,
            onChange: function () {
                if (attacker.isDead) return;
                attacker.x = values.x;
                attacker.y = values.y;
                if (isCard) {
                    attacker.scale.x = values.s;
                    attacker.scale.y = values.s;
                }
            }
        })
        // Wind up
        .to({ x: home.x - delta.x * 0.06, y: home.y - delta.y * 0.06, s: baseScale * 1.12 }, 110, CreateJS.Ease.quadOut)
        // Jump onto the defender
        .to({ x: home.x + delta.x * reach, y: home.y + delta.y * reach, s: baseScale * 1.05 }, D.LUNGE_IMPACT - 110, CreateJS.Ease.quadIn)
        .call(impact)
        .wait(90)
        // Return to the origin position
        .to({ x: home.x, y: home.y, s: baseScale }, D.LUNGE_TOTAL - D.LUNGE_IMPACT - 90, CreateJS.Ease.quadOut)
        .call(function () {
            attacker._lunging = false;
            if (attacker.isDead) return;
            if (homeGroup && attacker.parent !== homeGroup) homeGroup.addChild(attacker);
            var back = Home(attacker);
            attacker.x = back.x;
            attacker.y = back.y;
            if (isCard) {
                attacker.scale.x = attacker.scale.y = 1;
                attacker.interactive = !!(attacker.owner && attacker.owner == engine.player);
            }
            else {
                attacker.interactive = wasInteractive;
            }
        });

        // Guard: the impact happens even if the tween is removed (e.g. game over).
        setTimeout(impact, D.LUNGE_IMPACT + 400);
        return D.LUNGE_TOTAL;
    }

    /// A card leaves the board: it flashes, shrinks, spins a little and fades out. Calls done when it is gone.
    Animation.prototype.Card.Death = function (card, done) {
        var D = Animation.prototype.Duration;
        card.interactive = false;
        CreateJS.Tween.removeTweens(card);
        if (card.SetFlash) card.SetFlash(0xff5544);

        var dir = (card.owner && card.owner.isPlayer) ? 1 : -1;
        Animate(card, { alpha: 0, scaleX: 0.35, scaleY: 0.35, rotation: 0.5 * dir, y: card.y + 30 * dir },
            D.DEATH, CreateJS.Ease.quadIn, function () {
                Remove(card);
                if (done) done();
            });

        PlaySound(Asset.Sound.DEFEND_1, 0.4);
        return D.DEATH;
    }

    /// A card appears (summoned token, card returned by Haunt): grows from nothing.
    Animation.prototype.Card.Appear = function (card, done) {
        var scale = 1;
        card.alpha = 0;
        card.scale.x = card.scale.y = 0.2;
        Animate(card, { alpha: 1, scaleX: scale, scaleY: scale }, 420, CreateJS.Ease.backOut, done);
        return 450;
    }

    Animation.prototype.Card.MoveBack = function (c) {

        c.OrderOriginalPosition();
        var target =
            {
                x: c.position.originX,
                y: c.position.originY
            }

        CreateJS.Tween.get(c, { override: true })
            .to(target, 1000, CreateJS.Ease.elasticOut)
            .call(onComplete);

        function onComplete() {
            c._awaitRequest = false;
        }
    }

    Animation.prototype.Card.MoveTo = function () {

    }

    Animation.prototype.Card.PutIn = function () {
        // TODO
    }


    /// Pulses a text (health/attack label) to show that it changed.
    Animation.prototype.General.Heal = Animation.prototype.General.GainAttack = function (healthText) {
        if (!healthText || !healthText._originalScale) return;

        var originalScale =
            {
                scaleX: healthText._originalScale.x,
                scaleY: healthText._originalScale.y
            }

        var values =
            {
                scaleX: originalScale.scaleX * 1.8,
                scaleY: originalScale.scaleY * 1.8
            }

        CreateJS.Tween.get(values, {
            override: true,
            onChange: function onChange(e) {
                healthText.scale.y = values.scaleY;
                healthText.scale.x = values.scaleX;
            }
        })
        .to(originalScale, 600, CreateJS.Ease.quadOut)

    }


    ///////////////////////////////////////////////////////////////////
    ////////////////////////////// HEROES /////////////////////////////
    ///////////////////////////////////////////////////////////////////

    /// A hero falls: the portrait turns dark red, shakes and sinks.
    Animation.prototype.Player.Death = function (player) {
        if (!player) return 0;
        player.isDead = true;
        if (player.pPortrait) player.pPortrait.tint = 0x772222;
        Animation.prototype.Shake(player);
        var home = Home(player);
        setTimeout(function () {
            Animate(player, { alpha: 0.45, rotation: player.isPlayer ? -0.12 : 0.12, y: home.y + (player.isPlayer ? 18 : -18) },
                900, CreateJS.Ease.quadIn);
        }, 260);
        PlaySound(Asset.Sound.DEFEND_1, 0.7);
        return 1300;
    }

    Animation.prototype.Player.Defend = function (player) {
        Animation.prototype.Shake(player);
        if (player.Flash) player.Flash(0xFF3333, 300);
    }


    ///////////////////////////////////////////////////////////////////
    //////////////////////////// EFFECTS //////////////////////////////
    ///////////////////////////////////////////////////////////////////

    function EffectsGroup(engine) {
        return engine.getGroup("Effects") || engine.getGroup("Text");
    }

    /// A number or word floating up from a card or hero ("-3", "+2", "Paralyzed").
    /// color: CSS color; size: font size in px. Several floats on one target are stacked.
    Animation.prototype.Fx.Float = function (engine, target, text, color, size, offsetY) {
        if (!engine || !target) return;
        var pos = Home(target);
        var now = Date.now();
        if (!target._floatAt || now - target._floatAt > 450) target._floatStack = 0;
        target._floatAt = now;
        var stack = target._floatStack = (target._floatStack || 0) + 1;

        var label = new Pixi.Text(String(text), {
            font: "bold " + (size || 52) + "px Arial",
            fill: color || "#ff3b30",
            stroke: "#000000",
            strokeThickness: 7
        });
        label.anchor = { x: 0.5, y: 0.5 };
        label.x = pos.x + (stack - 1) * 18;
        label.y = pos.y + (offsetY || 0) - (stack - 1) * 44;
        label.scale.x = label.scale.y = 0.4;
        EffectsGroup(engine).addChild(label);

        Animate(label, { scaleX: 1.15, scaleY: 1.15 }, 160, CreateJS.Ease.backOut, function () {
            Animate(label, { y: label.y - 80, alpha: 0, scaleX: 0.95, scaleY: 0.95 }, Animation.prototype.Duration.FLOAT - 160,
                CreateJS.Ease.quadIn, function () { Remove(label); });
        });
    }

    /// An expanding ring at a point.
    Animation.prototype.Fx.Burst = function (engine, x, y, color, radius) {
        var ring = new Pixi.Graphics();
        ring.lineStyle(10, color || 0xffffff, 0.9);
        ring.drawCircle(0, 0, radius || 40);
        ring.x = x;
        ring.y = y;
        ring.scale.x = ring.scale.y = 0.3;
        EffectsGroup(engine).addChild(ring);
        Animate(ring, { scaleX: 1.6, scaleY: 1.6, alpha: 0 }, 420, CreateJS.Ease.quadOut, function () { Remove(ring); });
    }

    /// A glowing orb flying from one object (or point) to another. Calls onArrive when it lands.
    Animation.prototype.Fx.Projectile = function (engine, from, to, color, duration, onArrive) {
        var start = from && from.x !== undefined ? Home(from) : null;
        var end = to && to.x !== undefined ? Home(to) : null;
        duration = duration || Animation.prototype.Duration.PROJECTILE;
        if (!start || !end) {
            if (onArrive) setTimeout(onArrive, 0);
            return 0;
        }

        var orb = new Pixi.Graphics();
        orb.beginFill(color || 0xffffff, 0.35);
        orb.drawCircle(0, 0, 24);
        orb.endFill();
        orb.beginFill(color || 0xffffff, 1);
        orb.drawCircle(0, 0, 13);
        orb.endFill();
        orb.beginFill(0xffffff, 0.9);
        orb.drawCircle(0, 0, 6);
        orb.endFill();
        orb.x = start.x;
        orb.y = start.y;
        EffectsGroup(engine).addChild(orb);

        var arrived = false;
        function arrive() {
            if (arrived) return;
            arrived = true;
            Remove(orb);
            Animation.prototype.Fx.Burst(engine, end.x, end.y, color);
            if (onArrive) onArrive();
        }

        Animate(orb, { x: end.x, y: end.y }, duration, CreateJS.Ease.quadIn, arrive);
        setTimeout(arrive, duration + 400); // guard
        return duration;
    }

    /// A glowing ring around an object for a moment (blessing, hero power use, ...).
    Animation.prototype.Fx.Glow = function (engine, target, color) {
        if (!target) return;
        var pos = Home(target);
        var isHero = target.isPlayer !== undefined;
        var ring = new Pixi.Graphics();
        ring.lineStyle(8, color || 0xffe082, 0.95);
        if (isHero) ring.drawEllipse(0, 0, 140, 118);
        else ring.drawRect(-82, -112, 164, 224);
        ring.x = pos.x;
        ring.y = pos.y;
        ring.alpha = 0;
        EffectsGroup(engine).addChild(ring);
        Animate(ring, { alpha: 1 }, 150, CreateJS.Ease.quadOut, function () {
            Animate(ring, { alpha: 0, scaleX: 1.12, scaleY: 1.12 }, 550, CreateJS.Ease.quadIn, function () { Remove(ring); });
        });
    }

    /// Shows a card face for a moment, then burns it away (a card drawn into a full hand).
    Animation.prototype.Fx.BurnCard = function (engine, card, x, y) {
        card.interactive = false;
        card.x = x;
        card.y = y;
        card.alpha = 0;
        card.scale.x = card.scale.y = 0.4;
        EffectsGroup(engine).addChild(card);
        Animate(card, { alpha: 1, scaleX: 1.35, scaleY: 1.35 }, 300, CreateJS.Ease.backOut, function () {
            CreateJS.Tween.get(card).wait(800).call(function () {
                if (card.SetFlash) card.SetFlash(0xff7a1a);
                Animation.prototype.Fx.Burst(engine, x, y, 0xff7a1a, 70);
                Animate(card, { alpha: 0, scaleX: 0.7, scaleY: 0.7, rotation: 0.35, y: y - 40 }, 500, CreateJS.Ease.quadIn,
                    function () { Remove(card); });
            });
        });
        return 1650;
    }

    return new Animation();
});
