// Tooltips (.sg-tip.s-tip in the HUD overlay) for cards in the hand and on the board, heroes and hero powers: name
// and level, rarity (also as data-rarity on the box), race and class, stats, ability, race passive, statuses, notes
// and the card's flavor text. Rules texts come from the card JSON and the page config
// (Client/Rules.js). All text is set as text (server strings are never treated as HTML). Touch devices get the same
// box when a card, hero or hero power is tapped (Pin); a tap on empty board closes it.
define("tooltip", ["conf", "rules", "hud"], function (Conf, Rules, Hud) {

    var CARD_HALF_WIDTH = 75;
    var CARD_HALF_HEIGHT = 105;
    var HERO_HALF_WIDTH = 150;
    var HERO_HALF_HEIGHT = 125;
    var TAP_MS = 400;
    var TAP_SLOP = 20;
    var T = window.SoulsL10n.t;

    function Tooltip(engine) {
        this.engine = engine;
        this.current = null;
        this.pinned = null;
        this.pinnedUntil = 0;
        this.pinnedAt = 0;
        this.builtAt = 0;

        var el = this.el = Hud.El('div', 'sg-tip s-tip souls-classic-tip', Hud.Root());
        el.setAttribute('role', 'tooltip');
        el.hidden = true;
        this.WatchTaps();
    }

    /// Taps on the board: the opponent's cards and hero are not interactive on the canvas, so a short tap anywhere
    /// shows the tooltip of what is under it (the player's own cards and hero pin theirs themselves).
    Tooltip.prototype.WatchTaps = function () {
        var canvas = Hud.Canvas();
        if (!canvas) return;
        var that = this;
        var start = null;
        canvas.addEventListener('touchstart', function (e) {
            var t = e.changedTouches && e.changedTouches[0];
            start = (t && (!e.touches || e.touches.length === 1)) ? { id: t.identifier, x: t.clientX, y: t.clientY, at: Date.now() } : null;
        }, { passive: true });
        canvas.addEventListener('touchend', function (e) {
            var t = e.changedTouches && e.changedTouches[0];
            var s = start;
            start = null;
            if (!s || !t || t.identifier !== s.id) return;
            if (Date.now() - s.at > TAP_MS || Math.abs(t.clientX - s.x) + Math.abs(t.clientY - s.y) > TAP_SLOP) return;
            var point = Hud.ToStage(t.clientX, t.clientY);
            // After the board's own handlers (a card or hero may pin itself on this tap).
            setTimeout(function () { that.Tap(point); }, 0);
        }, { passive: true });
    }

    Tooltip.prototype.Tap = function (point) {
        var engine = this.engine;
        var player = engine.player;
        if (!player || engine.ended || player.holdingCard || player.isClicked || player.armedSpell) return;
        if (player.heroPower && (player.heroPower.armed || player.heroPower.aiming)) return;
        if (this.pinned && Date.now() - this.pinnedAt < 250) return; // pinned by this tap already
        var obj = this.FindAt(point);
        if (obj) this.Pin(obj, 3500);
        else if (this.pinned) this.Pin(null);
    }

    function Num(value) {
        return (typeof value === 'number' && isFinite(value)) ? value : null;
    }

    function Stars(level) {
        return level >= 2 ? ' ' + new Array(Math.min(level, 6)).join('★') : '';
    }

    /// .sg-tip-block[.kind] > b label + text
    function Block(parent, kind, label, text) {
        if (!label && !text) return null;
        var block = Hud.El('div', 'sg-tip-block' + (kind ? ' ' + kind : ''), parent);
        if (label) Hud.El('b', '', block, label);
        if (text) Hud.Text(block, (label ? ' ' : '') + text);
        return block;
    }

    /// .sg-tip-stats: cost (gem), attack (sword), health (heart), armor (shield, when above 0).
    function Stats(parent, stats) {
        var box = Hud.El('div', 'sg-tip-stats', parent);
        function Add(className, iconName, value, label) {
            if (value === null || value === undefined || value === '') return;
            var span = Hud.El('span', className, box);
            span.title = label;
            span.appendChild(Hud.Icon(iconName));
            Hud.Text(span, value);
            Hud.El('span', 's-sr-only', span, ' ' + label);
        }
        Add('cost', 'gem', Num(stats.cost), T('classic.stat.cost'));
        Add('atk', 'sword', Num(stats.attack), T('classic.stat.attack'));
        var health = Num(stats.health);
        if (health !== null) {
            var max = Num(stats.maxHealth);
            Add('hp', 'heart', max !== null && health < max ? health + '/' + max : health, T('classic.stat.health'));
        }
        if (stats.armor > 0) Add('arm', 'shield', stats.armor, T('classic.stat.armor'));
        if (!box.firstChild) Hud.Remove(box);
        return box;
    }

    Tooltip.prototype.BuildCard = function (card) {
        var el = this.el;
        var engine = this.engine;
        var level = Num(card.level) || 1;
        var rarity = card.token ? null : Rules.Rarity(card.rarity);
        if (rarity) el.setAttribute('data-rarity', rarity);
        Hud.El('div', 's-tip-title', el, String(card.name || '') + Stars(level));

        var race = card.race ? Rules.Race(card.race) : null;
        var raceName = race ? race.name : (card.raceName || null);
        var sub = [];
        if (rarity) sub.push(T('rarity.' + rarity));
        if (raceName) sub.push(raceName);
        if (card.token) sub.push(T('classic.card.token'));
        if (card.spell) sub.push(T('classic.tooltip.spell'));
        sub.push(T('classic.level', { n: level }));
        Hud.El('div', 'sg-tip-sub', el, sub.join(' · '));

        Stats(el, card.spell ? { cost: card.cost } : card);

        if (card.abilityId) {
            // The card's own label and rules text ("Burn 3": "Deals 3 damage ..."), else the generic rules text.
            var ability = Rules.Ability(card.abilityId);
            var abilityText = card.abilityText || (ability ? ability.text : '');
            if (card.spell) {
                var kinds = card.TargetedSpell() ? Rules.AbilityTargets(card.abilityId) : [];
                abilityText += ' ' + (kinds.length ? T('classic.tooltip.spellTarget', { targets: Rules.DescribeTargets(kinds) })
                    : T('classic.tooltip.spellBoard'));
            }
            else if (Rules.IsActivated(card.abilityId, card.abilityActivated)) abilityText += ' ' + T('classic.tooltip.activated');
            Block(el, '', card.abilityLabel || (ability ? ability.name : (card.abilityName || T('classic.ability'))), abilityText);
        }
        if (card.spell) Block(el, 'info', '', Rules.Keyword('spell') || T('keyword.spell'));
        // Spells never attack or die: only the Vampiric and Lightbringer passives work for them.
        var passive = !card.spell || Number(card.race) === 2 || Number(card.race) === 3;
        if (race && passive) Block(el, 'race', race.name, race.text);
        else if (card.raceName && passive) Block(el, 'race', String(card.raceName), '');

        // The ward (as in the 3D client): unbroken, or broken on a Ward card.
        if (card.ward) Block(el, 'info', '', Rules.Keyword('ward') || T('keyword.ward'));
        else if (card.inSlot && Number(card.abilityId) === 10) Block(el, 'info', '', T('classic.tooltip.wardBroken'));

        // Statuses of cards on the board
        if (card.inSlot) {
            if (card.taunt && Number(card.abilityId) !== 3) {
                var taunt = Rules.Ability(3);
                Block(el, '', taunt ? taunt.name : T('ability.3.name'), taunt ? taunt.text : '');
            }
            if (card.paralyzed) Block(el, 'warn', T('classic.status.paralyzed'), Rules.Keyword('paralyzed'));
            var own = engine.player && card.owner === engine.player;
            if (own && engine.myTurn && !card.canAct && !card.paralyzed) {
                if (card.playedOnTurn !== undefined && card.playedOnTurn === engine.turnNumber) {
                    Block(el, 'warn', T('classic.status.exhausted'), Rules.Keyword('summoningSick'));
                }
                else {
                    Block(el, 'warn', T('classic.status.exhausted'), T('classic.tooltip.acted'));
                }
            }
            else if (own && engine.myTurn && card.canAct) {
                Block(el, '', T('classic.status.ready'), T('classic.tooltip.ready'));
            }
        }

        if (card.token) Block(el, 'info', '', T('classic.tooltip.token'));
        if (card.armor > 0 && Rules.Keyword('armor')) Block(el, 'info', '', Rules.Keyword('armor'));
        if (level >= 2) Block(el, 'info', '', T(card.spell ? 'classic.tooltip.levelSpell' : 'classic.tooltip.levelCard', { level: level, n: level - 1 }));
        if (card.flavor) Block(el, 'flavor', '', String(card.flavor));
    }

    Tooltip.prototype.BuildHero = function (hero) {
        var el = this.el;
        var engine = this.engine;
        var type = Rules.HeroType(hero.type);
        Hud.El('div', 's-tip-title', el, String(hero.name || ''));

        var sub = [];
        if (type) sub.push(type.name);
        if (Num(hero.rating) !== null) sub.push(T('classic.tooltip.rating', { n: hero.rating }));
        if (sub.length) Hud.El('div', 'sg-tip-sub', el, sub.join(' · '));

        Stats(el, { attack: hero.attack, health: hero.health, maxHealth: hero.maxHealth, armor: hero.armor });

        var power = Rules.HeroPower(hero.power);
        if (power) Block(el, '', power.name, T('classic.tooltip.powerCost', { n: power.cost }) + ' ' + power.text);
        if (type && type.race) {
            var race = Rules.Race(type.race);
            if (race) Block(el, 'race', race.name, race.text);
        }

        if (hero.deckCount === 0 && Rules.Keyword('fatigue')) Block(el, 'warn', T('classic.status.fatigued'), Rules.Keyword('fatigue'));

        if (type && Number(type.mana) > 0) Block(el, 'info', '', T('classic.tooltip.manaPerTurn', { n: type.mana }));
        var cards = [];
        if (Num(hero.mana) !== null) cards.push(T('classic.tooltip.mana', { n: hero.mana, max: Math.max(hero.maxMana || 0, hero.mana) }));
        if (Num(hero.deckCount) !== null) cards.push(T('classic.tooltip.deck', { n: hero.deckCount }));
        if (Num(hero.handCount) !== null) cards.push(T('classic.tooltip.hand', { n: hero.handCount }));
        if (cards.length) Block(el, 'info', '', cards.join(' · '));
        if (hero.armor > 0 && Rules.Keyword('armor')) Block(el, 'info', '', Rules.Keyword('armor'));
        if (hero === engine.player && engine.myTurn) {
            Block(el, 'info', '', hero.canAttack ? T('classic.tooltip.heroAttack') : T('classic.tooltip.heroCannotAttack'));
        }
    }

    Tooltip.prototype.BuildPower = function (power) {
        var el = this.el;
        var info = Rules.HeroPower(power.heroType);
        Hud.El('div', 's-tip-title', el, info ? info.name : T('classic.heroPower'));
        Hud.El('div', 'sg-tip-sub', el, (power.isOwn ? T('classic.power.own') : T('classic.power.foe')) + ' · ' +
            T('classic.power.costOnce', { n: power.cost }));
        if (info) Block(el, '', '', info.text);

        var kinds = power.Kinds();
        if (power.isOwn) {
            if (power.armed) {
                Block(el, 'info', '', T('classic.tooltip.pickEscape', { targets: Rules.DescribeTargets(kinds) }));
            }
            else if (!power.used && power.canUse) {
                Block(el, 'info', '', kinds.length
                    ? T('classic.tooltip.dragPower', { targets: Rules.DescribeTargets(kinds) })
                    : T('classic.tooltip.clickToUse'));
            }
        }
        if (power.used) Block(el, 'info', '', T('classic.tooltip.used'));
        else if (power.isOwn && !power.canUse) Block(el, 'warn', '', power.Reason());
    }

    function HitCard(card, m) {
        if (!card || card.isDead || !card.visible) return false;
        var sx = Math.abs(card.scale.x || 1), sy = Math.abs(card.scale.y || 1);
        return Math.abs(m.x - card.x) <= CARD_HALF_WIDTH * sx && Math.abs(m.y - card.y) <= CARD_HALF_HEIGHT * sy;
    }

    function HitHero(hero, m) {
        if (!hero) return false;
        var home = hero.GetHome();
        return Math.abs(m.x - home.x) <= hero.width / 2 && Math.abs(m.y - home.y) <= hero.height / 2;
    }

    /// Focused from the keyboard (a click or tap also focuses the button, but then its tooltip follows the pointer).
    function KeyboardFocus(power) {
        if (!power.focused) return false;
        try { return !!(power.el.matches && power.el.matches(':focus-visible')); }
        catch (e) { return false; }
    }

    function IsPower(obj) {
        return !!obj && obj.heroType !== undefined && obj.isPlayer === undefined;
    }

    /// The object under the pointer, or null: a hero power under the mouse (DOM) or focused, else what is under
    /// the mouse on the board.
    Tooltip.prototype.FindHovered = function () {
        var engine = this.engine;
        var player = engine.player, opponent = engine.opponent;
        if (!player || !opponent) return null;
        if (player.heroPower && player.heroPower.visible && (player.heroPower.hovered || KeyboardFocus(player.heroPower))) return player.heroPower;
        if (opponent.heroPower && opponent.heroPower.visible && opponent.heroPower.hovered) return opponent.heroPower;

        // Board objects only while the mouse is over the board (Conf.mouse keeps its last point when it leaves).
        if (!Hud.overCanvas) return null;
        if (player._chover && !player._chover.isDead) return player._chover;
        return this.FindAt(Conf.mouse);
    }

    /// The card or hero at a stage point, or null.
    Tooltip.prototype.FindAt = function (m) {
        var engine = this.engine;
        var player = engine.player, opponent = engine.opponent;
        if (!player || !opponent || !m || m.x < 0 || m.y < 0) return null;
        var key;
        for (key in player.cardManager.board) if (HitCard(player.cardManager.board[key], m)) return player.cardManager.board[key];
        for (key in opponent.cardManager.board) if (HitCard(opponent.cardManager.board[key], m)) return opponent.cardManager.board[key];
        if (HitHero(player, m)) return player;
        if (HitHero(opponent, m)) return opponent;
        return null;
    }

    /// Shows the box for an object for a while (touch taps); Pin(null) lets go.
    Tooltip.prototype.Pin = function (obj, ms) {
        this.pinned = obj || null;
        this.pinnedUntil = obj ? Date.now() + (ms || 3000) : 0;
        this.pinnedAt = obj ? Date.now() : 0;
        this.current = null;
    }

    Tooltip.prototype.Hide = function () {
        this.current = null;
        this.el.hidden = true;
    }

    /// Called every frame.
    Tooltip.prototype.Update = function () {
        var engine = this.engine;
        var player = engine.player;
        if (!player || engine.ended) { this.Hide(); return; }

        var power = player.heroPower;
        var target = null;
        if (this.pinned && Date.now() < this.pinnedUntil && !this.pinned.isDead && this.pinned.visible !== false) {
            target = this.pinned;
        }
        else {
            this.pinned = null;
            var busy = !!player.holdingCard || player.isClicked || !!player.armedSpell || (power && (power.aiming || power.armed || power.pressed));
            if (!busy) target = this.FindHovered();
        }

        if (!target) { this.Hide(); return; }

        // (Re)build when the object changes, and now and then for changing numbers.
        var now = Date.now();
        if (target !== this.current || now - this.builtAt > 300) {
            this.current = target;
            this.builtAt = now;
            Hud.Clear(this.el);
            this.el.removeAttribute('data-rarity');
            if (target.isPlayer !== undefined) this.BuildHero(target);
            else if (IsPower(target)) this.BuildPower(target);
            else this.BuildCard(target);
        }
        this.el.hidden = false;
        this.Place(target);
    }

    /// The object's box in overlay pixels.
    Tooltip.prototype.Anchor = function (target) {
        if (target.TipRect) {
            var r = target.TipRect();
            var host = Hud.rect;
            if (r && r.width > 0) return { left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height };
        }
        var halfW, halfH, at;
        if (target.isPlayer !== undefined) {
            at = target.GetHome();
            halfW = HERO_HALF_WIDTH;
            halfH = HERO_HALF_HEIGHT;
        }
        else {
            // Board cards rest in their slot; a hand card is where it is (lifted while hovered).
            at = target.inSlot && target.GetHome ? target.GetHome() : { x: target.x, y: target.y };
            halfW = CARD_HALF_WIDTH * Math.abs(target.scale ? target.scale.x || 1 : 1);
            halfH = CARD_HALF_HEIGHT * Math.abs(target.scale ? target.scale.y || 1 : 1);
        }
        var topLeft = Hud.ToOverlay(at.x - halfW, at.y - halfH);
        return { left: topLeft.x, top: topLeft.y, width: 2 * halfW * Hud.sx, height: 2 * halfH * Hud.sy };
    }

    /// Positions the box next to the object (right of it, else left), inside the overlay.
    Tooltip.prototype.Place = function (target) {
        var host = Hud.rect;
        var a = this.Anchor(target);
        var box = this.el.getBoundingClientRect();
        var x = a.left + a.width + 12;
        if (x + box.width > host.width - 8) x = a.left - 12 - box.width;
        x = Math.max(8, Math.min(x, host.width - box.width - 8));
        var y = a.top + a.height / 2 - box.height / 2;
        y = Math.max(8, Math.min(y, host.height - box.height - 8));
        this.el.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
    }

    Tooltip.prototype.Destroy = function () {
        Hud.Remove(this.el);
    }

    return Tooltip;
});
