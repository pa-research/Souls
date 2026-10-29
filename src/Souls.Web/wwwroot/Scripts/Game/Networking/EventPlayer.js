// Plays GameEvents (235): every event becomes a step that animates it and returns how long the next step has to
// wait (ms). The game service runs the steps one after another. Events are perspective-free: heroes are referred
// to by ident (1/2; ours is engine.myIdent) and cards by cid. Numbers in the events are applied as they come, the
// GameSync that follows is the final truth.
define("eventPlayer", ["animation", "rules", "card", "asset"], function (Animation, Rules, Card, Asset) {

    var Fx = Animation.Fx;

    var ABILITY_COLOR = {
        1: 0x4cff6a, // Heal
        2: 0xa569bd, // Sacrifice
        5: 0x5aa9ff, // Paralyze
        7: 0xb8c4cf, // Harden
        8: 0xff7a1a  // Burn
    };
    var POWER_COLOR = { 1: 0xff5544, 2: 0xa569bd, 3: 0xffe082, 4: 0x8fc8ff };

    function EventPlayer(engine) {
        this.engine = engine;
    }

    function SameRef(a, b) {
        if (!a || !b || a.k !== b.k) return false;
        return a.k === 'hero' ? Number(a.id) === Number(b.id) : Number(a.cid) === Number(b.cid);
    }

    function IsHero(obj) {
        return !!obj && obj.isPlayer !== undefined;
    }

    /// The hero with this ident (1 = player one, 2 = player two).
    EventPlayer.prototype.Hero = function (ident) {
        var engine = this.engine;
        if (!engine.player || !engine.opponent) return null;
        return Number(ident) === Number(engine.myIdent) ? engine.player : engine.opponent;
    }

    /// A card on either board, or null.
    EventPlayer.prototype.Card = function (cid) {
        var engine = this.engine;
        if (cid === undefined || cid === null || !engine.player) return null;
        return engine.player.cardManager.board[cid] || engine.opponent.cardManager.board[cid] || null;
    }

    /// The object a ref ({k: "card", cid} or {k: "hero", id}) points at, or null.
    EventPlayer.prototype.Resolve = function (ref) {
        if (!ref) return null;
        if (ref.k === 'hero') return this.Hero(ref.id);
        if (ref.k === 'card') return this.Card(ref.cid);
        return null;
    }

    /// Where a card is, or where it was when it died.
    EventPlayer.prototype.Where = function (cid) {
        var card = this.Card(cid);
        if (card) return card;
        var last = this.engine.lastCardPos && this.engine.lastCardPos[cid];
        return last ? { x: last.x, y: last.y } : null;
    }

    /// <summary>
    /// Turns a list of events into steps. An attack takes the damage (and lifesteal/log) events right after it
    /// along, so they are shown when the attacker hits.
    /// </summary>
    EventPlayer.prototype.Expand = function (events) {
        var steps = [];
        if (!events || typeof events.length !== 'number') return steps;
        var self = this;

        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (!e || typeof e.t !== 'string') continue;

            if (e.t === 'attack') {
                var hits = [];
                while (i + 1 < events.length && events[i + 1] && this.IsHit(events[i + 1], e)) {
                    hits.push(events[++i]);
                }
                steps.push(this.Bind(this.Attack, [e, hits]));
            }
            else if (e.t === 'death') {
                // Cards that die together leave together.
                var group = [e];
                while (i + 1 < events.length && events[i + 1] && (events[i + 1].t === 'death' || events[i + 1].t === 'log')) {
                    group.push(events[++i]);
                }
                steps.push(this.Bind(this.Together, [group]));
            }
            else if (this.handlers[e.t]) {
                steps.push(this.Bind(this.handlers[e.t], [e]));
            }
        }

        return steps;
    }

    /// Runs several events at once; waits as long as the longest one.
    EventPlayer.prototype.Together = function (group) {
        var ms = 0;
        for (var i = 0; i < group.length; i++) {
            var handler = this.handlers[group[i].t];
            if (!handler) continue;
            try { ms = Math.max(ms, handler.call(this, group[i]) || 0); }
            catch (err) { console.error('[EVENTS] ' + group[i].t, err); }
        }
        return ms;
    }

    EventPlayer.prototype.IsHit = function (next, attack) {
        if (next.t === 'log' || next.t === 'lifesteal') return true;
        if (next.t === 'damage') return SameRef(next.to, attack.src) || SameRef(next.to, attack.dst);
        return false;
    }

    EventPlayer.prototype.Bind = function (fn, args) {
        var self = this;
        return function () { return fn.apply(self, args); };
    }

    /// Runs one event at once (inside an attack).
    EventPlayer.prototype.Apply = function (e) {
        var handler = this.handlers[e.t];
        if (!handler) return;
        try { handler.call(this, e); } catch (err) { console.error('[EVENTS] ' + e.t, err); }
    }

    EventPlayer.prototype.Attack = function (e, hits) {
        var self = this;
        var src = this.Resolve(e.src);
        var dst = this.Resolve(e.dst);

        function impact() {
            for (var i = 0; i < hits.length; i++) self.Apply(hits[i]);
        }

        if (!src || !dst) {
            impact();
            return 350;
        }

        return Animation.Lunge(src, dst, impact) + 60;
    }

    EventPlayer.prototype.SetStats = function (target, stats) {
        if (IsHero(target)) target.SetText(stats);
        else target.UpdateFromJson(stats);
    }

    EventPlayer.prototype.handlers = {

        log: function (e) {
            if (this.engine.battleLog && e.text !== undefined && e.text !== null) this.engine.battleLog.Add(e.text);
            return 0;
        },

        damage: function (e) {
            var target = this.Resolve(e.to);
            if (!target) return 0;
            var amount = Number(e.amount) || 0;
            var armorLost = Number(e.armorLost) || 0;
            this.SetStats(target, { health: e.health, armor: e.armor });

            if (IsHero(target)) {
                target.Flash(0xff3333, 260);
                Animation.Shake(target);
                Animation.General.Heal(target.pHealthText);
            }
            else {
                target.SetFlash(0xff6655, 240);
                Animation.Shake(target);
                Animation.General.Heal(target.txtHealth);
            }

            Fx.Float(this.engine, target, "-" + amount, "#ff3b30", 58);
            if (armorLost > 0) {
                Fx.Float(this.engine, target, "-" + armorLost + " armor", "#c3ccd5", 30, 48);
            }
            return 430;
        },

        heal: function (e) {
            var target = this.Resolve(e.to);
            if (!target) return 0;
            var amount = Number(e.amount) || 0;
            this.SetStats(target, { health: e.health });
            if (amount <= 0) return 0;
            Fx.Float(this.engine, target, "+" + amount, "#4cff6a", 54);
            Fx.Glow(this.engine, target, 0x4cff6a);
            Animation.General.Heal(IsHero(target) ? target.pHealthText : target.txtHealth);
            return 400;
        },

        armor: function (e) {
            var target = this.Resolve(e.to);
            if (!target) return 0;
            this.SetStats(target, { armor: e.armor });
            Fx.Float(this.engine, target, "+" + (Number(e.amount) || 0) + " armor", "#a9d4ff", 40);
            Fx.Glow(this.engine, target, 0xb8c4cf);
            return 420;
        },

        buff: function (e) {
            var target = this.Resolve(e.to);
            if (!target) return 0;
            this.SetStats(target, { attack: e.attack, health: e.health, maxHealth: e.maxHealth, armor: e.armor });
            Fx.Float(this.engine, target, "Empowered!", "#ffd54a", 38);
            Fx.Glow(this.engine, target, 0xffd54a);
            if (IsHero(target)) {
                Animation.General.GainAttack(target.pAttackText);
                Animation.General.Heal(target.pHealthText);
            }
            else {
                Animation.General.GainAttack(target.txtAttack);
                Animation.General.Heal(target.txtHealth);
            }
            return 520;
        },

        lifesteal: function (e) {
            var engine = this.engine;
            var src = this.Where(e.src && e.src.cid);
            var hero = this.Resolve(e.to);
            if (!hero) return 0;
            hero.SetText({ health: e.health });
            var amount = Number(e.amount) || 0;
            Fx.Projectile(engine, src || hero, hero, 0xd63a4a, 280, function () {
                Fx.Float(engine, hero, "+" + amount, "#4cff6a", 50);
                Animation.General.Heal(hero.pHealthText);
            });
            return 320;
        },

        blessing: function (e) {
            var engine = this.engine;
            var card = this.Card(e.cid);
            var hero = this.Resolve(e.to);
            if (card) {
                Fx.Glow(engine, card, 0xffe082);
                Fx.Float(engine, card, "Blessing", "#ffe082", 34, -120);
            }
            if (card && hero) Fx.Projectile(engine, card, hero, 0xffe082, 380);
            return 560;
        },

        ability: function (e) {
            var engine = this.engine;
            var src = this.Resolve(e.src);
            var dst = this.Resolve(e.dst);
            var ability = Rules.Ability(e.abilityId);
            var color = ABILITY_COLOR[e.abilityId] || 0xffffff;

            if (Number(e.abilityId) === 1) Animation.PlaySound(Asset.Sound.ABILITY_HEAL, 0.3);
            if (Number(e.abilityId) === 2) Animation.PlaySound(Asset.Sound.ABILITY_SACRIFICE, 0.3);

            if (src) {
                Fx.Glow(engine, src, color);
                Fx.Float(engine, src, (ability ? ability.name : (src.abilityName || "Ability")) + "!", "#ffffff", 36, -120);
            }
            if (src && dst && src !== dst) {
                Fx.Projectile(engine, src, dst, color, 360);
                return 620;
            }
            if (dst) Fx.Glow(engine, dst, color);
            return 450;
        },

        heroPower: function (e) {
            var engine = this.engine;
            var hero = this.Hero(e.id);
            var dst = this.Resolve(e.dst);
            if (!hero) return 0;
            var origin = hero.heroPower || hero;
            var color = POWER_COLOR[e.power] || 0xffd54a;

            if (hero.heroPower) {
                hero.heroPower.used = true;
                hero.heroPower.Redraw();
                hero.heroPower.Activate();
            }
            Fx.Float(engine, origin, String(e.name || "Hero power"), "#ffd54a", 34, -80);

            if (dst && dst !== hero) {
                Fx.Projectile(engine, origin, dst, color, 380);
                return 650;
            }
            Fx.Glow(engine, hero, color);
            return 500;
        },

        paralyze: function (e) {
            var card = this.Card(e.cid);
            if (!card) return 0;
            card.UpdateFromJson({ paralyzed: e.on !== false });
            if (e.on !== false) {
                Fx.Float(this.engine, card, "Paralyzed!", "#8fc8ff", 34);
                Fx.Burst(this.engine, card.x, card.y, 0x5aa9ff, 70);
            }
            return 450;
        },

        summon: function (e) {
            var owner = this.Hero(e.owner);
            if (!owner || !e.card) return 0;
            var manager = owner.cardManager;
            if (manager.board[e.card.cid]) return 0;

            var source = this.Card(e.src);
            if (source) Fx.Glow(this.engine, source, 0xc9a8ff);
            var card = manager.CreateBoardCard(e.card);
            if (!card) return 0;
            card.playedOnTurn = this.engine.turnNumber;
            Animation.Card.Appear(card);
            Fx.Burst(this.engine, card.x, card.y, 0xc9a8ff, 60);
            return 560;
        },

        death: function (e) {
            var card = this.Card(e.cid);
            if (!card) return 0;
            var manager = card.owner && card.owner.cardManager;
            if (!manager) {
                var owner = this.Hero(e.owner);
                manager = owner && owner.cardManager;
            }
            if (!manager) return 0;
            return manager.KillCard(card) + 40;
        },

        curse: function (e) {
            var engine = this.engine;
            var from = this.Where(e.src);
            var dst = this.Resolve(e.dst);
            if (from) Fx.Float(engine, from, "Death curse", "#c39bff", 34, -60);
            if (from && dst) {
                Fx.Projectile(engine, from, dst, 0x7d3c98, 420);
                return 620;
            }
            return 300;
        },

        haunt: function (e) {
            var engine = this.engine;
            var from = this.Where(e.cid);
            var owner = this.Hero(e.owner);
            if (!from) return 0;
            Fx.Float(engine, from, "Haunt!", "#c9a8ff", 40, -40);
            if (owner) {
                var manager = owner.cardManager;
                var hand = { x: manager.startCardX + manager.cardSpacing * manager.HandCount(), y: manager.startCardY };
                Fx.Projectile(engine, from, hand, 0xc9a8ff, 450);
            }
            return 560;
        },

        burned: function (e) {
            var engine = this.engine;
            var owner = this.Hero(e.owner);
            if (!e.card) return 0;
            var card = new Card(engine, e.card, 0);
            var mine = owner === engine.player;
            var x = 300, y = mine ? 760 : 330;
            Fx.Float(engine, { x: x, y: y - 150 }, "Burned!", "#ff9a3c", 44);
            return Fx.BurnCard(engine, card, x, y) - 150;
        },

        fatigue: function (e) {
            var hero = this.Hero(e.id);
            if (!hero) return 0;
            Fx.Float(this.engine, hero, "Fatigue " + (Number(e.amount) || 0), "#c39bff", 42, hero.isPlayer ? -90 : 90);
            Fx.Glow(this.engine, hero, 0x8e44ad);
            return 650;
        },

        timeout: function (e) {
            var hero = this.Hero(e.id);
            var mine = hero === this.engine.player;
            Fx.Banner(this.engine, mine ? "Time's up!" : "Your opponent ran out of time", mine ? "#ff6b5e" : "#f3e9d2", null, mine ? 72 : 52);
            return 900;
        },

        heroDeath: function (e) {
            var hero = this.Hero(e.id);
            if (!hero) return 0;
            if (hero.heroPower) hero.heroPower.alpha = 0.3;
            return Animation.Player.Death(hero);
        }
    };

    return EventPlayer;
});
