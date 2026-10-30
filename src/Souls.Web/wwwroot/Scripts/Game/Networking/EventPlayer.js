// Plays GameEvents (235): every event becomes a step that animates it and returns how long the next step has to
// wait (ms). The game service runs the steps one after another. Events are perspective-free: heroes are referred
// to by ident (1/2; ours is engine.myIdent) and cards by cid. Numbers in the events are applied as they come, the
// GameSync that follows is the final truth.
define("eventPlayer", ["animation", "rules", "card", "asset"], function (Animation, Rules, Card, Asset) {

    var Fx = Animation.Fx;

    var ABILITY = { SUMMON: 4, BURN: 8, WARD: 10, RALLY: 13, INSIGHT: 14, INFERNO: 15, REGENERATE: 16, GROW: 17, DRAIN: 18, BROOD: 19 };
    var ABILITY_COLOR = Card.ABILITY_COLOR;
    var POWER_COLOR = { 1: 0xff5544, 2: 0xa569bd, 3: 0xffe082, 4: 0x8fc8ff, 5: 0xb03a2e, 6: 0xff3b6b, 7: 0xffd36b, 8: 0xc8a27a }; // by hero power id

    // Hits that land at the same moment (Inferno on every enemy card) are shown together.
    var SIMULTANEOUS = { damage: true, ward: true, venom: true };

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

    /// A card on either board, or a spell being cast (it is the source of its events), or null.
    EventPlayer.prototype.Card = function (cid) {
        var engine = this.engine;
        if (cid === undefined || cid === null || !engine.player) return null;
        return engine.player.cardManager.board[cid] || engine.opponent.cardManager.board[cid] || engine.castSpells[cid] || null;
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

    /// Where a ref points: a hero, a card on the board, or where a card was when it died.
    EventPlayer.prototype.WhereRef = function (ref) {
        if (!ref) return null;
        if (ref.k === 'hero') return this.Hero(ref.id);
        return this.Where(ref.cid);
    }

    /// <summary>
    /// Turns a list of events into steps. An attack takes the damage (and lifesteal/log) events right after it
    /// along, so they are shown when the attacker hits. Events the client does not know are skipped.
    /// </summary>
    EventPlayer.prototype.Expand = function (events) {
        var steps = [];
        if (!events || typeof events.length !== 'number') return steps;
        var self = this;

        function Next(i) {
            return i + 1 < events.length && events[i + 1] && typeof events[i + 1].t === 'string' ? events[i + 1] : null;
        }

        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (!e || typeof e.t !== 'string') continue;
            var group;

            if (e.t === 'attack') {
                var hits = [];
                while (Next(i) && this.IsHit(Next(i), e)) {
                    hits.push(events[++i]);
                }
                steps.push(this.Bind(this.Attack, [e, hits]));
            }
            else if (e.t === 'death') {
                // Cards that die together leave together.
                group = [e];
                while (Next(i) && (Next(i).t === 'death' || Next(i).t === 'log')) {
                    group.push(events[++i]);
                }
                steps.push(this.Bind(this.Together, [group]));
            }
            else if (SIMULTANEOUS[e.t]) {
                // Damage dealt to several cards at once (Inferno) lands at once.
                group = [e];
                while (Next(i) && (SIMULTANEOUS[Next(i).t] || Next(i).t === 'log')) {
                    group.push(events[++i]);
                }
                steps.push(group.length > 1 ? this.Bind(this.Together, [group]) : this.Bind(this.handlers[e.t], [e]));
            }
            else if (e.t === 'buff' && e.src) {
                // A card rallying its neighbours buffs them together.
                group = [e];
                while (Next(i) && ((Next(i).t === 'buff' && SameRef(Next(i).src, e.src)) || Next(i).t === 'log')) {
                    group.push(events[++i]);
                }
                steps.push(group.length > 1 ? this.Bind(this.Together, [group]) : this.Bind(this.handlers.buff, [e]));
            }
            else if (this.handlers.hasOwnProperty(e.t)) {
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
        if (next.t === 'damage' || next.t === 'ward' || next.t === 'venom') {
            return SameRef(next.to, attack.src) || SameRef(next.to, attack.dst);
        }
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

    function Num(value) {
        var n = Number(value);
        return value === undefined || value === null || value === '' || !isFinite(n) ? null : n;
    }

    /// What a buff gives ("+1 attack", "+2/+2"), from the target's numbers before it; "Empowered!" when unknown.
    function Gains(target, e) {
        var attack = Num(e.attack) !== null && Num(target.attack) !== null ? Num(e.attack) - Num(target.attack) : 0;
        var newHealth = Num(e.maxHealth) !== null ? Num(e.maxHealth) : Num(e.health);
        var oldHealth = Num(target.maxHealth) !== null ? Num(target.maxHealth) : Num(target.health);
        var health = newHealth !== null && oldHealth !== null ? newHealth - oldHealth : 0;
        if (attack > 0 && health > 0) return "+" + attack + "/+" + health;
        if (attack > 0) return "+" + attack + " attack";
        if (health > 0) return "+" + health + " health";
        return "Empowered!";
    }

    /// Inferno: fire bursts across the enemy line, one card after the other (the damage events follow).
    EventPlayer.prototype.Inferno = function (e, card, at, color) {
        var engine = this.engine;
        var mine;
        if (card && card.owner) mine = card.owner === engine.player;
        else {
            var last = engine.lastCardPos && e.src && engine.lastCardPos[e.src.cid];
            mine = last ? !!last.isPlayer : true;
        }
        var enemy = mine ? engine.opponent : engine.player;
        if (!enemy) return 0;

        Fx.Burst(engine, at.x, at.y, color, 70);
        Fx.Glow(engine, at, color);
        Animation.PlaySound(Asset.Sound.ABILITY_SACRIFICE, 0.25);

        var targets = [];
        for (var cid in enemy.cardManager.board) {
            var c = enemy.cardManager.board[cid];
            if (c && !c.isDead) targets.push(c);
        }
        targets.sort(function (a, b) { return a.x - b.x; });

        var step = 90;
        if (targets.length === 0) {
            var hero = enemy.GetHome();
            setTimeout(function () { Fx.Fire(engine, hero.x, hero.y); }, 120);
            return 600;
        }
        targets.forEach(function (target, i) {
            setTimeout(function () {
                var home = target.GetHome();
                Fx.Fire(engine, home.x, home.y);
                if (!target.isDead) target.SetFlash(0xff9a3c, 260);
            }, 120 + i * step);
        });
        return 420 + step * targets.length;
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

        /// New stats after Sacrifice, Rally (src: the rallying card) or Grow (src: the card itself).
        buff: function (e) {
            var self = this;
            var engine = this.engine;
            var target = this.Resolve(e.to);
            if (!target) return 0;
            var source = e.src ? this.Resolve(e.src) : null;
            var gains = Gains(target, e);

            function Apply() {
                self.SetStats(target, { attack: e.attack, health: e.health, maxHealth: e.maxHealth, armor: e.armor });
                Fx.Float(engine, target, gains, "#ffd54a", gains.charAt(0) === '+' ? 46 : 38);
                Fx.Glow(engine, target, 0xffd54a);
                if (IsHero(target)) {
                    Animation.General.GainAttack(target.pAttackText);
                    Animation.General.Heal(target.pHealthText);
                }
                else {
                    Animation.General.GainAttack(target.txtAttack);
                    Animation.General.Heal(target.txtHealth);
                }
            }

            if (source && source !== target) {
                // A streak from the rallying card to the card it buffs.
                return Fx.Streak(engine, source, target, ABILITY_COLOR[ABILITY.RALLY], 260, Apply) + 420;
            }
            Apply();
            return 520;
        },

        /// Vampiric heal (src: the card that dealt the damage) or the heal of Drain (src: the drained target).
        lifesteal: function (e) {
            var engine = this.engine;
            var src = this.WhereRef(e.src);
            var hero = this.Resolve(e.to);
            if (!hero) return 0;
            hero.SetText({ health: e.health });
            var amount = Number(e.amount) || 0;
            Fx.Projectile(engine, src || hero, hero, 0xd63a4a, src && src !== hero ? 320 : 0, function () {
                Fx.Float(engine, hero, "+" + amount, "#4cff6a", 50);
                Animation.General.Heal(hero.pHealthText);
            });
            return 360;
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
            if (src && dst && src !== dst && Number(e.abilityId) === ABILITY.DRAIN) {
                // A bolt of blood; the life flows back with the lifesteal event that follows.
                Fx.Bolt(engine, src, dst, color, 300, function () {
                    if (dst.SetFlash) dst.SetFlash(0xff4d6a, 260);
                    else if (dst.Flash) dst.Flash(0xff4d6a, 260);
                });
                return 600;
            }
            if (src && dst && src !== dst) {
                Fx.Projectile(engine, src, dst, color, 360);
                return 620;
            }
            if (dst) Fx.Glow(engine, dst, color);
            return 450;
        },

        /// An on-play, turn-start or on-death ability fires; its effects (damage, buff, heal, summon) follow.
        trigger: function (e) {
            var engine = this.engine;
            var id = Number(e.abilityId);
            var card = this.Resolve(e.src);
            var at = card || this.WhereRef(e.src); // Brood: the card is already gone
            if (!at) return 0;
            var ability = Rules.Ability(id);
            var label = e.label || (card && card.abilityLabel) || (ability && ability.name);
            var color = ABILITY_COLOR[id] || 0xffffff;
            if (label) Fx.Float(engine, at, String(label), "#ffd98a", 38, -120);

            switch (id) {
                case ABILITY.INFERNO:
                    return this.Inferno(e, card, at, color);
                case ABILITY.RALLY:
                    Fx.Pulse(engine, at, color);
                    return 480;
                case ABILITY.INSIGHT:
                    Fx.Glow(engine, at, color);
                    Fx.Sparkle(engine, at, color, 16);
                    return 560;
                case ABILITY.REGENERATE:
                    Fx.Sparkle(engine, at, color, 14);
                    return 420;
                case ABILITY.GROW:
                    if (card) Animation.Card.Grow(card);
                    Fx.Sparkle(engine, at, color, 10);
                    return 620;
                case ABILITY.SUMMON:
                case ABILITY.BROOD:
                    Fx.Portal(engine, at.x, at.y, color);
                    return 520;
                default:
                    if (card) Fx.Glow(engine, card, color);
                    return 380;
            }
        },

        /// A ward broke and blocked the damage (on: false).
        ward: function (e) {
            var card = this.Resolve(e.to);
            if (!card || IsHero(card)) return 0;
            if (e.on === true) {
                card.UpdateFromJson({ ward: true });
                return 0;
            }
            var ms = card.BreakWard();
            Fx.Float(this.engine, card, "Blocked!", "#ffd36b", 46);
            return Math.max(ms, 420);
        },

        /// Venom destroys the damaged card (its death follows).
        venom: function (e) {
            var engine = this.engine;
            var target = this.Resolve(e.to);
            if (!target) return 0;
            var at = Animation.Home(target);
            Fx.Venom(engine, at.x, at.y);
            Fx.Float(engine, target, "Venom!", "#8dff5a", 48, -40);
            if (!IsHero(target)) {
                target.UpdateFromJson({ health: 0 });
                target.SetFlash(0x7dff4a, 600);
            }
            return 480;
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

        /// A token appears (Summon; Brood: src is the dead card, which may be gone already).
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
            Fx.Sparkle(this.engine, card, 0xc9a8ff, 6);
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
            this.engine.ScreenMessage([mine ? "Time's up!" : "Your opponent ran out of time"], mine ? 'warn' : 'info');
            return 900;
        },

        heroDeath: function (e) {
            var hero = this.Hero(e.id);
            if (!hero) return 0;
            if (hero.heroPower) hero.heroPower.SetDimmed(true);
            return Animation.Player.Death(hero);
        }
    };

    return EventPlayer;
});
