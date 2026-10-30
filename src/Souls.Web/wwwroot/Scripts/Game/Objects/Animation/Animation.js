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

    /// A card swells up and settles back (Grow).
    Animation.prototype.Card.Grow = function (card) {
        if (!card || card.isDead || card._lunging) return 0;
        var base = card.scale.x || 1;
        var values = { s: base };
        function Apply() {
            if (card.isDead || card._lunging) return;
            card.scale.x = card.scale.y = values.s;
        }
        CreateJS.Tween.get(values, { onChange: Apply })
            .to({ s: base * 1.25 }, 200, CreateJS.Ease.quadOut)
            .to({ s: base }, 520, CreateJS.Ease.elasticOut)
            .call(Apply);
        return 720;
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

    /// A cast spell is used up (after its events): it flares in its colour, rises and fades away. Removes it.
    Animation.prototype.Card.Spend = function (card, color) {
        if (!card) return 0;
        CreateJS.Tween.removeTweens(card);
        if (card.SetFlash) card.SetFlash(color || 0xffffff);
        if (card.engine) Animation.prototype.Fx.Sparkle(card.engine, card, color || 0xffffff, 10);
        Animate(card, { alpha: 0, scaleX: card.scale.x * 1.15, scaleY: card.scale.y * 1.15, y: card.y - 50 }, 650, CreateJS.Ease.quadIn,
            function () { Remove(card); });
        return 650;
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

    function Random(min, max) {
        return min + Math.random() * (max - min);
    }

    /// A four-pointed star of radius r around (0, 0).
    function DrawStar(g, r) {
        g.moveTo(0, -r);
        for (var i = 1; i <= 8; i++) {
            var a = -Math.PI / 2 + i * Math.PI / 4;
            var radius = i % 2 ? r * 0.32 : r;
            g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
        }
    }

    /// Small stars that pop up around an object and drift upwards (Insight, Regenerate, Grow, rare cards).
    Animation.prototype.Fx.Sparkle = function (engine, target, color, count) {
        if (!engine || !target) return;
        var pos = Home(target);
        var group = EffectsGroup(engine);
        count = count || 12;
        for (var i = 0; i < count; i++) {
            var star = new Pixi.Graphics();
            var r = Random(7, 15);
            star.beginFill(color || 0xffffff, 1);
            DrawStar(star, r);
            star.endFill();
            star.beginFill(0xffffff, 0.9);
            star.drawCircle(0, 0, r * 0.28);
            star.endFill();
            star.x = pos.x + Random(-80, 80);
            star.y = pos.y + Random(-100, 90);
            star.scale.x = star.scale.y = 0;
            group.addChild(star);
            (function (star) {
                setTimeout(function () {
                    Animate(star, { scaleX: 1, scaleY: 1, rotation: 0.6 }, 180, CreateJS.Ease.backOut, function () {
                        Animate(star, { y: star.y - Random(40, 80), alpha: 0, scaleX: 0.3, scaleY: 0.3, rotation: 1.4 }, 560,
                            CreateJS.Ease.quadIn, function () { Remove(star); });
                    });
                }, i * 35 + Random(0, 60));
            })(star);
        }
    }

    /// Rings of light pulsing out of an object (Rally).
    Animation.prototype.Fx.Pulse = function (engine, target, color) {
        if (!engine || !target) return;
        var pos = Home(target);
        var isHero = target.isPlayer !== undefined;
        var group = EffectsGroup(engine);

        var flash = new Pixi.Graphics();
        flash.beginFill(color, 0.4);
        if (isHero) flash.drawEllipse(0, 0, 130, 110);
        else flash.drawRect(-75, -105, 150, 210);
        flash.endFill();
        flash.x = pos.x;
        flash.y = pos.y;
        group.addChild(flash);
        Animate(flash, { alpha: 0 }, 450, CreateJS.Ease.quadIn, function () { Remove(flash); });

        for (var i = 0; i < 3; i++) {
            setTimeout(function () {
                var ring = new Pixi.Graphics();
                ring.lineStyle(8, color, 0.9);
                if (isHero) ring.drawEllipse(0, 0, 140, 118);
                else ring.drawRect(-80, -110, 160, 220);
                ring.x = pos.x;
                ring.y = pos.y;
                group.addChild(ring);
                Animate(ring, { scaleX: 1.5, scaleY: 1.3, alpha: 0 }, 560, CreateJS.Ease.quadOut, function () { Remove(ring); });
            }, i * 150);
        }
    }

    /// A burst of fire at a point: a hot flash, flames licking upwards and embers (Inferno).
    Animation.prototype.Fx.Fire = function (engine, x, y) {
        if (!engine) return;
        var group = EffectsGroup(engine);

        var flash = new Pixi.Graphics();
        flash.beginFill(0xff8c1a, 0.5);
        flash.drawCircle(0, 0, 80);
        flash.endFill();
        flash.beginFill(0xffd34d, 0.7);
        flash.drawCircle(0, 0, 48);
        flash.endFill();
        flash.beginFill(0xffffff, 0.6);
        flash.drawCircle(0, 0, 20);
        flash.endFill();
        flash.x = x;
        flash.y = y;
        flash.scale.x = flash.scale.y = 0.3;
        group.addChild(flash);
        Animate(flash, { scaleX: 1.25, scaleY: 1.25, alpha: 0 }, 480, CreateJS.Ease.quadOut, function () { Remove(flash); });
        Animation.prototype.Fx.Burst(engine, x, y, 0xff6a1a, 62);

        var colors = [0xffd34d, 0xff9a1a, 0xff5a1a, 0xd8301a];
        for (var i = 0; i < 11; i++) {
            var flame = new Pixi.Graphics();
            var w = Random(10, 20), h = Random(24, 42);
            flame.beginFill(colors[i % colors.length], 0.85);
            flame.drawEllipse(0, 0, w, h);
            flame.endFill();
            flame.beginFill(0xfff1a8, 0.65);
            flame.drawEllipse(0, h * 0.3, w * 0.45, h * 0.4);
            flame.endFill();
            flame.x = x + Random(-70, 70);
            flame.y = y + Random(10, 90);
            flame.scale.x = flame.scale.y = 0.2;
            group.addChild(flame);
            (function (flame) {
                setTimeout(function () {
                    Animate(flame, { scaleX: 1, scaleY: 1, y: flame.y - 40 }, 160, CreateJS.Ease.quadOut, function () {
                        Animate(flame, { y: flame.y - Random(70, 130), scaleX: 0.3, scaleY: 0.5, alpha: 0 }, Random(420, 620),
                            CreateJS.Ease.quadIn, function () { Remove(flame); });
                    });
                }, Random(0, 140));
            })(flame);
        }

        for (var j = 0; j < 8; j++) {
            var ember = new Pixi.Graphics();
            ember.beginFill(j % 2 ? 0xffd34d : 0xff7a1a, 1);
            ember.drawCircle(0, 0, Random(2.5, 5));
            ember.endFill();
            ember.x = x + Random(-40, 40);
            ember.y = y + Random(-20, 40);
            group.addChild(ember);
            Animate(ember, { x: ember.x + Random(-90, 90), y: ember.y - Random(90, 190), alpha: 0 }, Random(600, 900),
                CreateJS.Ease.quadOut, (function (ember) { return function () { Remove(ember); }; })(ember));
        }
    }

    /// A swirling portal opening at a point (Summon, Brood).
    Animation.prototype.Fx.Portal = function (engine, x, y, color) {
        if (!engine) return;
        var group = EffectsGroup(engine);
        color = color || 0xb07cff;

        var portal = new Pixi.Graphics();
        portal.lineStyle(0, 0, 0);
        portal.beginFill(color, 0.25);
        portal.drawCircle(0, 0, 92);
        portal.endFill();
        portal.lineStyle(8, color, 0.95);
        portal.beginFill(0x1e0b33, 0.75);
        portal.drawCircle(0, 0, 70);
        portal.endFill();
        portal.lineStyle(4, 0xe7c6ff, 0.85);
        portal.drawEllipse(-8, -4, 46, 38);
        portal.lineStyle(3, color, 0.9);
        portal.drawEllipse(6, 4, 26, 22);
        portal.x = x;
        portal.y = y;
        portal.scale.x = portal.scale.y = 0;
        group.addChild(portal);
        Animate(portal, { scaleX: 1, scaleY: 1, rotation: 2.2 }, 300, CreateJS.Ease.backOut, function () {
            Animate(portal, { rotation: 4.4 }, 260, CreateJS.Ease.linear, function () {
                Animate(portal, { scaleX: 0.1, scaleY: 0.1, rotation: 6, alpha: 0 }, 300, CreateJS.Ease.quadIn, function () { Remove(portal); });
            });
        });

        // Motes spiralling in
        for (var i = 0; i < 12; i++) {
            var mote = new Pixi.Graphics();
            mote.beginFill(i % 3 ? color : 0xffffff, 1);
            mote.drawCircle(0, 0, Random(3, 6));
            mote.endFill();
            var a = (i / 12) * Math.PI * 2;
            mote.x = x + Math.cos(a) * 140;
            mote.y = y + Math.sin(a) * 140;
            mote.alpha = 0;
            group.addChild(mote);
            Animate(mote, { x: x + Math.cos(a + 1.4) * 12, y: y + Math.sin(a + 1.4) * 12, alpha: 1 }, Random(380, 560),
                CreateJS.Ease.quadIn, (function (mote) { return function () { Remove(mote); }; })(mote));
        }
        setTimeout(function () { Animation.prototype.Fx.Burst(engine, x, y, color, 70); }, 380);
    }

    /// A splash of venom at a point: a green burst, a toxic cloud and droplets.
    Animation.prototype.Fx.Venom = function (engine, x, y) {
        if (!engine) return;
        var group = EffectsGroup(engine);
        Animation.prototype.Fx.Burst(engine, x, y, 0x7dff4a, 60);
        setTimeout(function () { Animation.prototype.Fx.Burst(engine, x, y, 0x3ea82a, 90); }, 120);

        for (var i = 0; i < 6; i++) {
            var puff = new Pixi.Graphics();
            puff.beginFill(i % 2 ? 0x5fd93a : 0x2e8a1f, 0.4);
            puff.drawCircle(0, 0, Random(26, 42));
            puff.endFill();
            puff.x = x + Random(-50, 50);
            puff.y = y + Random(-60, 60);
            puff.scale.x = puff.scale.y = 0.3;
            group.addChild(puff);
            Animate(puff, { scaleX: 1.6, scaleY: 1.6, alpha: 0, y: puff.y - 30 }, Random(650, 900), CreateJS.Ease.quadOut,
                (function (puff) { return function () { Remove(puff); }; })(puff));
        }
        for (var j = 0; j < 14; j++) {
            var drop = new Pixi.Graphics();
            drop.beginFill(j % 3 ? 0x8dff5a : 0xd9ffb8, 1);
            drop.drawCircle(0, 0, Random(4, 8));
            drop.endFill();
            drop.x = x;
            drop.y = y;
            group.addChild(drop);
            var a = Random(0, Math.PI * 2), d = Random(70, 150);
            Animate(drop, { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 40, alpha: 0, scaleX: 0.4, scaleY: 0.4 }, Random(500, 750),
                CreateJS.Ease.quadOut, (function (drop) { return function () { Remove(drop); }; })(drop));
        }
    }

    /// Golden shards flying apart from the edge of a card (a ward breaks).
    Animation.prototype.Fx.Shards = function (engine, x, y, color, count) {
        if (!engine) return;
        var group = EffectsGroup(engine);
        count = count || 14;
        for (var i = 0; i < count; i++) {
            var shard = new Pixi.Graphics();
            var s = Random(7, 14);
            shard.lineStyle(1.5, 0xffffff, 0.8);
            shard.beginFill(i % 3 ? color : 0xfff3c4, 0.95);
            shard.moveTo(0, -s);
            shard.lineTo(s * 0.6, s * 0.5);
            shard.lineTo(-s * 0.5, s * 0.7);
            shard.lineTo(0, -s);
            shard.endFill();
            // Start on the card's edge, fly outwards
            var a = (i / count) * Math.PI * 2 + Random(-0.2, 0.2);
            var ex = Math.cos(a), ey = Math.sin(a);
            var k = Math.min(80 / Math.abs(ex || 0.001), 110 / Math.abs(ey || 0.001));
            shard.x = x + ex * k;
            shard.y = y + ey * k;
            shard.rotation = Random(0, 6);
            group.addChild(shard);
            var d = Random(50, 110);
            Animate(shard, { x: shard.x + ex * d, y: shard.y + ey * d + 30, rotation: shard.rotation + Random(-4, 4), alpha: 0 },
                Random(450, 700), CreateJS.Ease.quadOut, (function (shard) { return function () { Remove(shard); }; })(shard));
        }
    }

    /// A jagged bolt from one object to another (Drain): it races to the target, flickers and fades. Calls onArrive
    /// when it hits.
    Animation.prototype.Fx.Bolt = function (engine, from, to, color, duration, onArrive) {
        var start = from && from.x !== undefined ? Home(from) : null;
        var end = to && to.x !== undefined ? Home(to) : null;
        duration = duration || 260;
        if (!engine || !start || !end) {
            if (onArrive) setTimeout(onArrive, 0);
            return 0;
        }

        var dx = end.x - start.x, dy = end.y - start.y;
        var length = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = -dy / length, ny = dx / length;
        var segments = Math.max(4, Math.round(length / 45));
        var points = [];
        for (var i = 0; i <= segments; i++) {
            var t = i / segments;
            var offset = (i === 0 || i === segments) ? 0 : Random(-24, 24);
            points.push({ x: start.x + dx * t + nx * offset, y: start.y + dy * t + ny * offset });
        }

        var bolt = new Pixi.Graphics();
        EffectsGroup(engine).addChild(bolt);
        var strokes = [[18, color, 0.28], [8, color, 0.95], [3, 0xffffff, 0.95]];
        var progress = { t: 0 };
        function Draw() {
            bolt.clear();
            var upto = progress.t * segments;
            var whole = Math.floor(upto);
            for (var s = 0; s < strokes.length; s++) {
                bolt.lineStyle(strokes[s][0], strokes[s][1], strokes[s][2]);
                bolt.moveTo(points[0].x, points[0].y);
                for (var k = 1; k <= whole && k <= segments; k++) bolt.lineTo(points[k].x, points[k].y);
                if (whole < segments) {
                    var f = upto - whole, a = points[whole], b = points[whole + 1];
                    bolt.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
                }
            }
        }

        var arrived = false;
        function Arrive() {
            if (arrived) return;
            arrived = true;
            progress.t = 1;
            Draw();
            Animation.prototype.Fx.Burst(engine, end.x, end.y, color, 50);
            if (onArrive) onArrive();
            // Flicker, then fade
            CreateJS.Tween.get(bolt).to({ alpha: 0.3 }, 50).to({ alpha: 1 }, 50).to({ alpha: 0 }, 260, CreateJS.Ease.quadIn)
                .call(function () { Remove(bolt); });
        }

        CreateJS.Tween.get(progress, { onChange: Draw }).to({ t: 1 }, duration, CreateJS.Ease.quadIn).call(Arrive);
        setTimeout(Arrive, duration + 400); // guard
        return duration;
    }

    /// A quick streak of light from one object to another (a card buffing another). Calls onArrive when it lands.
    Animation.prototype.Fx.Streak = function (engine, from, to, color, duration, onArrive) {
        var start = from && from.x !== undefined ? Home(from) : null;
        var end = to && to.x !== undefined ? Home(to) : null;
        duration = duration || 260;
        if (!engine || !start || !end) {
            if (onArrive) setTimeout(onArrive, 0);
            return 0;
        }
        var group = EffectsGroup(engine);
        var trail = new Pixi.Graphics();
        var orb = new Pixi.Graphics();
        orb.beginFill(color, 0.4);
        orb.drawCircle(0, 0, 17);
        orb.endFill();
        orb.beginFill(0xffffff, 1);
        orb.drawCircle(0, 0, 7);
        orb.endFill();
        orb.x = start.x;
        orb.y = start.y;
        group.addChild(trail);
        group.addChild(orb);

        var head = { x: start.x, y: start.y };
        function Draw() {
            orb.x = head.x;
            orb.y = head.y;
            trail.clear();
            trail.lineStyle(10, color, 0.35);
            trail.moveTo(start.x, start.y);
            trail.lineTo(head.x, head.y);
            trail.lineStyle(3, 0xfff3c4, 0.9);
            trail.moveTo(start.x, start.y);
            trail.lineTo(head.x, head.y);
        }

        var arrived = false;
        function Arrive() {
            if (arrived) return;
            arrived = true;
            head.x = end.x;
            head.y = end.y;
            Draw();
            Remove(orb);
            Animation.prototype.Fx.Burst(engine, end.x, end.y, color, 34);
            Animate(trail, { alpha: 0 }, 260, CreateJS.Ease.quadIn, function () { Remove(trail); });
            if (onArrive) onArrive();
        }

        CreateJS.Tween.get(head, { onChange: Draw }).to({ x: end.x, y: end.y }, duration, CreateJS.Ease.quadInOut).call(Arrive);
        setTimeout(Arrive, duration + 400); // guard
        return duration;
    }

    /// An epic or legendary card lands on the board: rings and a column of light (gold) or a violet ring (epic).
    Animation.prototype.Fx.RareEntrance = function (engine, x, y, legendary) {
        if (!engine) return;
        var color = legendary ? 0xffc04d : 0xb26bff;
        var group = EffectsGroup(engine);

        var pillar = new Pixi.Graphics();
        var widths = legendary ? [[150, 0.16], [100, 0.22], [52, 0.32], [18, 0.55]] : [[110, 0.14], [56, 0.24], [16, 0.45]];
        for (var i = 0; i < widths.length; i++) {
            pillar.beginFill(i === widths.length - 1 ? 0xffffff : color, widths[i][1]);
            pillar.drawRect(-widths[i][0] / 2, -y - 20, widths[i][0], y + 140);
            pillar.endFill();
        }
        pillar.x = x;
        pillar.y = y;
        pillar.scale.x = 0.2;
        pillar.alpha = 0;
        group.addChild(pillar);
        Animate(pillar, { scaleX: 1, alpha: 1 }, 160, CreateJS.Ease.quadOut, function () {
            Animate(pillar, { scaleX: 0.15, alpha: 0 }, legendary ? 900 : 600, CreateJS.Ease.quadIn, function () { Remove(pillar); });
        });

        var rings = legendary ? 3 : 2;
        for (var r = 0; r < rings; r++) {
            setTimeout(function () { Animation.prototype.Fx.Burst(engine, x, y, color, legendary ? 110 : 80); }, r * 140);
        }
        Animation.prototype.Fx.Sparkle(engine, { x: x, y: y }, legendary ? 0xffe08a : 0xd9a8ff, legendary ? 18 : 10);
    }

    /// <summary>
    /// A spell is cast: the card flies to (x, y) beside the board (where it rests until it is used up, see
    /// Card.Spend) and flares up in its ability's colour with rings and sparks. Returns how long the next step waits.
    /// </summary>
    Animation.prototype.Fx.CastSpell = function (engine, card, x, y, color) {
        color = color || 0xd9c2ff;
        card.position.originX = x; // the effects of its events start here
        card.position.originY = y;
        CreateJS.Tween.removeTweens(card);
        Animate(card, { x: x, y: y, alpha: 1, rotation: 0, scaleX: 1.3, scaleY: 1.3 }, 380, CreateJS.Ease.cubicOut, function () {
            if (card.SetFlash) card.SetFlash(color, 260);
            Animation.prototype.Fx.Pulse(engine, { x: x, y: y }, color);
            Animation.prototype.Fx.Burst(engine, x, y, color, 100);
            setTimeout(function () { Animation.prototype.Fx.Burst(engine, x, y, 0xffffff, 70); }, 140);
            Animation.prototype.Fx.Sparkle(engine, { x: x, y: y }, color, 14);
        });
        PlaySound(Asset.Sound.ABILITY_SACRIFICE, 0.3);
        return 900;
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
