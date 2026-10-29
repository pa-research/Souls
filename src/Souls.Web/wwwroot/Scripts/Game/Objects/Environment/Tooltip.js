// Tooltips (a DOM overlay above the canvas) for cards in the hand and on the board, heroes and hero powers:
// name, ability, race passive, statuses and level. All text is set with textContent (server strings are never
// treated as HTML). Touch devices get the same box when a card, hero or hero power is tapped (Pin).
define("tooltip", ["conf", "rules"], function (Conf, Rules) {

    var CARD_HALF_WIDTH = 75;
    var CARD_HALF_HEIGHT = 105;

    function Tooltip(engine) {
        this.engine = engine;
        this.current = null;
        this.pinned = null;
        this.pinnedUntil = 0;
        this.builtAt = 0;

        var el = this.el = document.createElement('div');
        el.className = 'souls-classic-tooltip';
        el.setAttribute('role', 'tooltip');
        el.hidden = true;
        document.body.appendChild(el);
    }

    function Line(parent, className, text) {
        var div = document.createElement('div');
        div.className = className;
        div.textContent = text;
        parent.appendChild(div);
        return div;
    }

    function Section(parent, title, text, className) {
        var div = document.createElement('div');
        div.className = 'souls-classic-tooltip-section' + (className ? ' ' + className : '');
        var strong = document.createElement('strong');
        strong.textContent = title;
        div.appendChild(strong);
        if (text) div.appendChild(document.createTextNode(' ' + text));
        parent.appendChild(div);
        return div;
    }

    function Num(value) {
        return (typeof value === 'number' && isFinite(value)) ? value : null;
    }

    Tooltip.prototype.BuildCard = function (card) {
        var el = this.el;
        var engine = this.engine;
        var name = String(card.name || '');
        Line(el, 'souls-classic-tooltip-title', name + (card.level >= 2 ? '  (level ' + card.level + ')' : ''));

        var stats = [];
        if (Num(card.cost) !== null) stats.push('Cost ' + card.cost);
        if (Num(card.attack) !== null) stats.push('Attack ' + card.attack);
        if (Num(card.health) !== null) stats.push('Health ' + card.health + (Num(card.maxHealth) !== null && card.maxHealth !== card.health ? ' / ' + card.maxHealth : ''));
        if (card.armor > 0) stats.push('Armor ' + card.armor);
        if (stats.length) Line(el, 'souls-classic-tooltip-stats', stats.join('  \u00B7  '));

        if (card.abilityId) {
            var ability = Rules.Ability(card.abilityId);
            var abilityName = ability ? ability.name : (card.abilityName || 'Ability');
            var abilityText = ability ? ability.text : '';
            if (ability && ability.activated) abilityText += ' (right-drag, or hold and drag on touch)';
            Section(el, abilityName + ':', abilityText, 'souls-classic-tooltip-ability');
        }

        if (card.race) {
            var race = Rules.Race(card.race);
            if (race) Section(el, race.name + ':', race.text, 'souls-classic-tooltip-race');
            else if (card.raceName) Section(el, String(card.raceName), '', 'souls-classic-tooltip-race');
        }

        if (card.token) Line(el, 'souls-classic-tooltip-status', 'Token: summoned, not from a deck.');

        // Statuses of cards on the board
        if (card.inSlot) {
            if (card.taunt) {
                var taunt = Rules.Ability(3);
                Section(el, 'Taunt', taunt ? taunt.text : '', 'souls-classic-tooltip-status');
            }
            if (card.paralyzed) {
                Section(el, 'Paralyzed', Rules.Keyword('paralyzed'), 'souls-classic-tooltip-status souls-classic-tooltip-bad');
            }
            var own = engine.player && card.owner === engine.player;
            if (own && engine.myTurn && !card.canAct && !card.paralyzed) {
                if (card.playedOnTurn !== undefined && card.playedOnTurn === engine.turnNumber) {
                    Section(el, 'Exhausted', Rules.Keyword('summoningSick'), 'souls-classic-tooltip-status');
                }
                else {
                    Section(el, 'Exhausted', 'It already attacked or used its ability this turn.', 'souls-classic-tooltip-status');
                }
            }
            else if (own && engine.myTurn && card.canAct) {
                Line(el, 'souls-classic-tooltip-good', 'Ready: can attack or use its ability this turn.');
            }
        }

        if (card.armor > 0 && Rules.Keyword('armor')) {
            Line(el, 'souls-classic-tooltip-note', Rules.Keyword('armor'));
        }
        if (card.level >= 2) {
            Line(el, 'souls-classic-tooltip-note', 'Level ' + card.level + ': +' + (card.level - 1) + ' attack and health.');
        }
    }

    Tooltip.prototype.BuildHero = function (hero) {
        var el = this.el;
        var type = Rules.HeroType(hero.type);
        Line(el, 'souls-classic-tooltip-title', String(hero.name || '') + (type ? '  (' + type.name + ')' : ''));

        var stats = [];
        if (Num(hero.attack) !== null) stats.push('Attack ' + hero.attack);
        if (Num(hero.health) !== null) stats.push('Health ' + hero.health + (Num(hero.maxHealth) !== null ? ' / ' + hero.maxHealth : ''));
        if (hero.armor > 0) stats.push('Armor ' + hero.armor);
        if (stats.length) Line(el, 'souls-classic-tooltip-stats', stats.join('  \u00B7  '));

        var cards = [];
        if (Num(hero.mana) !== null) cards.push('Mana ' + hero.mana + ' / ' + Math.max(hero.maxMana || 0, hero.mana));
        if (Num(hero.deckCount) !== null) cards.push('Deck ' + hero.deckCount);
        if (Num(hero.handCount) !== null) cards.push('Hand ' + hero.handCount);
        if (cards.length) Line(el, 'souls-classic-tooltip-stats', cards.join('  \u00B7  '));

        if (type && type.race) {
            var race = Rules.Race(type.race);
            if (race) Section(el, race.name + ':', race.text, 'souls-classic-tooltip-race');
        }
        var power = Rules.HeroPower(hero.type);
        if (power) Section(el, power.name + ' (' + power.cost + ' mana):', power.text, 'souls-classic-tooltip-ability');

        if (hero.armor > 0 && Rules.Keyword('armor')) Line(el, 'souls-classic-tooltip-note', Rules.Keyword('armor'));
        if (hero.deckCount === 0 && Rules.Keyword('fatigue')) {
            Section(el, 'Fatigue', Rules.Keyword('fatigue'), 'souls-classic-tooltip-status souls-classic-tooltip-bad');
        }
        if (hero === this.engine.player && this.engine.myTurn) {
            Line(el, hero.canAttack ? 'souls-classic-tooltip-good' : 'souls-classic-tooltip-note',
                hero.canAttack ? 'Drag from your hero to an enemy to attack.' : 'Your hero cannot attack right now.');
        }
    }

    Tooltip.prototype.BuildPower = function (power) {
        var el = this.el;
        var info = Rules.HeroPower(power.heroType);
        Line(el, 'souls-classic-tooltip-title', (info ? info.name : 'Hero power') + '  (' + power.cost + ' mana)');
        if (info) Line(el, 'souls-classic-tooltip-text', info.text);
        var kinds = power.Kinds();
        if (power.isOwn) {
            Line(el, 'souls-classic-tooltip-note', kinds.length ? 'Drag from the button to ' + Rules.DescribeTargets(kinds) + '.' : 'Click to use.');
            Line(el, 'souls-classic-tooltip-note', 'Once per turn.');
        }
        if (power.used) Line(el, 'souls-classic-tooltip-status', 'Used this turn.');
        else if (power.isOwn && !power.canUse) Line(el, 'souls-classic-tooltip-bad', power.Reason());
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

    /// The object under the mouse, or null.
    Tooltip.prototype.FindHovered = function () {
        var engine = this.engine;
        var player = engine.player, opponent = engine.opponent;
        if (!player || !opponent) return null;
        var m = Conf.mouse;
        if (m.x < 0 || m.y < 0) return null;
        var key;

        if (player.heroPower && player.heroPower.Contains(m)) return player.heroPower;
        if (opponent.heroPower && opponent.heroPower.Contains(m)) return opponent.heroPower;
        if (player._chover && !player._chover.isDead) return player._chover;
        for (key in player.cardManager.board) if (HitCard(player.cardManager.board[key], m)) return player.cardManager.board[key];
        for (key in opponent.cardManager.board) if (HitCard(opponent.cardManager.board[key], m)) return opponent.cardManager.board[key];
        if (HitHero(player, m)) return player;
        if (HitHero(opponent, m)) return opponent;
        return null;
    }

    /// Shows the box for an object for a while (touch taps).
    Tooltip.prototype.Pin = function (obj, ms) {
        this.pinned = obj;
        this.pinnedUntil = Date.now() + (ms || 3000);
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

        var target = null;
        if (this.pinned && Date.now() < this.pinnedUntil && !this.pinned.isDead) {
            target = this.pinned;
        }
        else {
            this.pinned = null;
            var busy = !!player.holdingCard || player.isClicked || (player.heroPower && (player.heroPower.aiming || player.heroPower.armed));
            if (!busy) target = this.FindHovered();
        }

        if (!target) { this.Hide(); return; }

        // (Re)build when the object changes, and now and then for changing numbers.
        var now = Date.now();
        if (target !== this.current || now - this.builtAt > 300) {
            this.current = target;
            this.builtAt = now;
            while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
            if (target.isPlayer !== undefined) this.BuildHero(target);
            else if (target.heroType !== undefined) this.BuildPower(target);
            else this.BuildCard(target);
        }
        this.el.hidden = false;
        this.Place(target);
    }

    /// Positions the box next to the object (stage coordinates are mapped to the scaled canvas).
    Tooltip.prototype.Place = function (target) {
        var canvas = engine_canvas();
        if (!canvas) return;
        var rect = canvas.getBoundingClientRect();
        var sx = rect.width / Conf.width, sy = rect.height / Conf.height;

        var home = target.GetHome ? target.GetHome() : { x: target.x, y: target.y };
        var halfWidth = target.isPlayer !== undefined ? 150 : (target.heroType !== undefined ? 55 : CARD_HALF_WIDTH * Math.abs(target.scale.x || 1));
        var box = this.el.getBoundingClientRect();

        var left = rect.left + (home.x + halfWidth + 12) * sx;
        if (left + box.width > window.innerWidth - 8) left = rect.left + (home.x - halfWidth - 12) * sx - box.width;
        var top = rect.top + home.y * sy - box.height / 2;
        top = Math.max(8, Math.min(top, window.innerHeight - box.height - 8));
        left = Math.max(8, left);

        this.el.style.left = Math.round(left) + 'px';
        this.el.style.top = Math.round(top) + 'px';
    }

    function engine_canvas() {
        return document.querySelector('#game-window canvas');
    }

    Tooltip.prototype.Destroy = function () {
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    return Tooltip;
});
