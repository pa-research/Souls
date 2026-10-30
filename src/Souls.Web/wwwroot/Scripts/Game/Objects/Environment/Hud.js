// The classic client's DOM interface: one div.sg-root laid exactly over the scaled canvas and built from the shared
// in-game components (css/game-hud.css on css/theme.css), so it looks like the 3D client's. Board positions are given
// in stage coordinates (the 1920 x 1080 stage) and converted to overlay pixels; everything placed on the board is
// laid out again when the window resizes. Server text is always inserted as text, never as HTML.
define("hud", ["conf"], function (Conf) {

    var SVG = 'http://www.w3.org/2000/svg';
    var SPRITE = '/img/icons.svg';
    var SCALE_MIN = 0.55;
    var SCALE_MAX = 1.25;

    var TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
    var DIVISIONS = ['III', 'II', 'I'];

    // ---- Small DOM helpers ----------------------------------------------------------------------------------------

    function El(tag, className, parent, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        if (parent) parent.appendChild(node);
        return node;
    }

    /// An icon from the sprite: <svg class="s-icon" aria-hidden="true"><use href="/img/icons.svg#i-NAME"></use></svg>.
    function Icon(name, className) {
        var svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', className || 's-icon');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var use = document.createElementNS(SVG, 'use');
        use.setAttribute('href', SPRITE + (name === 'emblem' ? '#emblem' : '#i-' + name));
        svg.appendChild(use);
        return svg;
    }

    function Text(parent, text) {
        var node = document.createTextNode(String(text));
        parent.appendChild(node);
        return node;
    }

    function Clear(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    function Remove(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    /// <button type="button"> with an optional icon in front of its label.
    function Button(className, parent, label, iconName) {
        var button = El('button', className, parent);
        button.type = 'button';
        if (iconName) button.appendChild(Icon(iconName));
        if (label !== undefined && label !== null) Text(button, label);
        return button;
    }

    function Clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /// .s-progress (style="--p: 40%") with its inner span.
    function Progress(parent, fraction, extra, label) {
        var bar = El('div', 's-progress' + (extra ? ' ' + extra : ''), parent);
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        if (label) bar.setAttribute('aria-label', label);
        El('span', '', bar);
        SetProgress(bar, fraction);
        return bar;
    }

    function SetProgress(bar, fraction) {
        var percent = Math.round(Clamp(Number(fraction) || 0, 0, 1) * 100);
        bar.style.setProperty('--p', percent + '%');
        bar.setAttribute('aria-valuenow', String(percent));
    }

    /// Rank tier of a rating (same rules as Souls.Model.Ratings: rank 1 up to 1000, one more every 50 points).
    function TierOf(rating) {
        var rank = Math.max(1, 1 + Math.trunc((Number(rating) - 1000) / 50));
        var index = rank - 1;
        if (index >= TIER_NAMES.length * DIVISIONS.length) return { name: 'Champion', css: 'tier-champion' };
        var name = TIER_NAMES[Math.floor(index / 3)];
        return { name: name + ' ' + DIVISIONS[index % 3], css: 'tier-' + name.toLowerCase() };
    }

    /// How far a rating is towards the next rank (0-1).
    function RankProgress(rating) {
        rating = Number(rating);
        if (!isFinite(rating) || rating < 1000) return 0;
        return ((rating - 1000) % 50) / 50;
    }

    /// span.s-rank.tier-x > emblem + tier name + rating.
    function RankBadge(parent, rating, tierName, tierCss) {
        var tier = TierOf(rating);
        var badge = El('span', 's-rank ' + (tierCss || tier.css), parent);
        badge.appendChild(Icon('emblem', 's-emblem'));
        var text = El('span', '', badge);
        El('span', 's-rank-name', text, tierName || tier.name);
        Text(text, ' ');
        El('span', 's-rank-rating s-num', text, String(rating));
        return badge;
    }

    /// m:ss, rounded up.
    function Clock(ms) {
        var s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
        var rest = s % 60;
        return Math.floor(s / 60) + ':' + (rest < 10 ? '0' : '') + rest;
    }

    /// Icon and class of a battle log line, from its wording (the server's log texts).
    function Classify(line) {
        if (/ wins against | play a draw/.test(line)) return ['trophy', 'end'];
        if (/ dies| has fallen|'s venom kills /.test(line)) return ['skull', 'death'];
        if (/ attacks | burns |curse| ablaze/.test(line)) return ['sword', 'attack'];
        if (/ heal| drains | blesses | regenerates /.test(line)) return ['heart-pulse', 'heal'];
        if (/'s ward breaks/.test(line)) return ['shield', ''];
        if (/ rallies | grows stronger| reveals /.test(line)) return ['sparkles', ''];
        if (/ gives the turn |ran out of time/.test(line)) return ['hourglass', 'turn'];
        if (/ plays | summons /.test(line)) return ['deck', ''];
        if (/ uses | paralyzes | hardens /.test(line)) return ['wand', ''];
        if (/haunt/i.test(line)) return ['ghost', ''];
        return ['flag', ''];
    }

    function ReducedMotion() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
        catch (e) { return false; }
    }

    function SmallScreen() {
        try { return !!(window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 560px)').matches); }
        catch (e) { return false; }
    }

    function ReadStorage(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function WriteStorage(key, value) {
        try { window.localStorage.setItem(key, String(value)); } catch (e) { /* storage is optional */ }
    }

    function Contains(rect, x, y) {
        return !!rect && x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
    }

    // ---- The overlay ---------------------------------------------------------------------------------------------

    function Hud() {
        this.root = null;
        this.canvas = null;
        this.rect = { left: 0, top: 0, width: Conf.width, height: Conf.height };
        this.sx = 1;
        this.sy = 1;
        this.k = 1;
        this.trackers = [];
        this.overCanvas = true;
        this.toasts = null;
        this.banner = null;
        this.legend = null;
    }

    Hud.prototype.El = El;
    Hud.prototype.Icon = Icon;
    Hud.prototype.Text = Text;
    Hud.prototype.Clear = Clear;
    Hud.prototype.Remove = Remove;
    Hud.prototype.Button = Button;
    Hud.prototype.Progress = Progress;
    Hud.prototype.SetProgress = SetProgress;
    Hud.prototype.TierOf = TierOf;
    Hud.prototype.RankProgress = RankProgress;
    Hud.prototype.RankBadge = RankBadge;
    Hud.prototype.Clock = Clock;
    Hud.prototype.Classify = Classify;
    Hud.prototype.ReducedMotion = ReducedMotion;
    Hud.prototype.SmallScreen = SmallScreen;
    Hud.prototype.ReadStorage = ReadStorage;
    Hud.prototype.WriteStorage = WriteStorage;
    Hud.prototype.Contains = Contains;

    /// Attaches the overlay to the game canvas (Main.js); later calls only lay it out again.
    Hud.prototype.Init = function (canvas) {
        var that = this;
        this.Root();
        if (canvas && canvas !== this.canvas) {
            this.canvas = canvas;
            // Whether the mouse is over the board (tooltips of board objects only show then).
            canvas.addEventListener('mouseenter', function () { that.overCanvas = true; });
            canvas.addEventListener('mouseleave', function () { that.overCanvas = false; });
        }
        if (!this._listening) {
            this._listening = true;
            var relayout = function () { that.Layout(); };
            window.addEventListener('resize', relayout);
            window.addEventListener('orientationchange', relayout);
        }
        this.Layout();
    }

    Hud.prototype.Root = function () {
        if (!this.root) {
            this.root = El('div', 'sg-root souls-classic-hud', document.body);
        }
        return this.root;
    }

    Hud.prototype.Canvas = function () {
        if (!this.canvas) this.canvas = document.querySelector('#game-window canvas');
        return this.canvas;
    }

    /// Lays the overlay over the canvas and places everything that follows the board.
    Hud.prototype.Layout = function () {
        var root = this.Root();
        var canvas = this.Canvas();
        var r = canvas ? canvas.getBoundingClientRect() : null;
        if (!r || !(r.width > 0 && r.height > 0)) {
            r = { left: 0, top: 0, width: window.innerWidth || Conf.width, height: window.innerHeight || Conf.height };
        }
        this.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
        root.style.left = Math.round(r.left) + 'px';
        root.style.top = Math.round(r.top) + 'px';
        root.style.width = Math.round(r.width) + 'px';
        root.style.height = Math.round(r.height) + 'px';

        this.sx = r.width / Conf.width;
        this.sy = r.height / Conf.height;
        // Things on the board grow and shrink with it, within limits (touch targets stay usable on phones).
        this.k = Clamp(Math.min(this.sx, this.sy), SCALE_MIN, SCALE_MAX);

        var list = this.trackers.slice();
        for (var i = 0; i < list.length; i++) {
            try { list[i](this); }
            catch (e) { console.error('[HUD] layout', e); }
        }
    }

    /// Calls fn(hud) now and after every layout; returns a function that stops it.
    Hud.prototype.Track = function (fn) {
        var trackers = this.trackers;
        trackers.push(fn);
        try { fn(this); } catch (e) { console.error('[HUD] layout', e); }
        return function () {
            var index = trackers.indexOf(fn);
            if (index !== -1) trackers.splice(index, 1);
        };
    }

    /// Stage coordinates to overlay pixels.
    Hud.prototype.ToOverlay = function (x, y) {
        return { x: x * this.sx, y: y * this.sy };
    }

    /// Client (viewport) coordinates to stage coordinates.
    Hud.prototype.ToStage = function (clientX, clientY) {
        return {
            x: (clientX - this.rect.left) / (this.sx || 1),
            y: (clientY - this.rect.top) / (this.sy || 1)
        };
    }

    /// <summary>
    /// Puts a node (position: absolute; left: 0; top: 0) at a stage point. dx/dy move the node's own anchor onto the
    /// point (CSS lengths: '-50%' centres it); with scale the board scale is applied around that anchor (origin).
    /// </summary>
    Hud.prototype.Place = function (node, x, y, options) {
        options = options || {};
        var p = this.ToOverlay(x, y);
        var transform = 'translate(' + Math.round(p.x) + 'px, ' + Math.round(p.y) + 'px) translate(' +
            (options.dx || '-50%') + ', ' + (options.dy || '-50%') + ')';
        if (options.scale) {
            transform += ' scale(' + (Math.round(this.k * options.scale * 1000) / 1000) + ')';
            node.style.transformOrigin = options.origin || '50% 50%';
        }
        node.style.transform = transform;
    }

    /// A full-screen layer (.sg-layer.sg-shade) above everything placed so far.
    Hud.prototype.Layer = function (className) {
        return El('div', 'sg-layer sg-shade' + (className ? ' ' + className : ''), this.Root());
    }

    /// Fades a layer out (sg-fade-out) and removes it; at once with fade false or reduced motion.
    Hud.prototype.CloseLayer = function (layer, fade, done) {
        if (!layer) return;
        if (!fade || ReducedMotion()) {
            Remove(layer);
            if (done) done();
            return;
        }
        layer.classList.add('sg-fade-out');
        setTimeout(function () {
            Remove(layer);
            if (done) done();
        }, 950);
    }

    // ---- Turn banner and toasts ----------------------------------------------------------------------------------

    /// The turn banner: small "Turn N" over a big "Your turn" (enemy: red, smaller). Removed after its animation.
    Hud.prototype.Banner = function (text, sub, enemy) {
        var that = this;
        if (this.banner) Remove(this.banner);
        var banner = El('div', 'sg-banner' + (enemy ? ' enemy' : ''), this.Root());
        banner.setAttribute('aria-hidden', 'true');
        if (sub) El('small', '', banner, sub);
        El('b', '', banner, text);
        this.banner = banner;

        var removed = false;
        function done() {
            if (removed) return;
            removed = true;
            Remove(banner);
            if (that.banner === banner) that.banner = null;
        }
        banner.addEventListener('animationend', function (e) {
            if (e && e.target && e.target !== banner) return;
            done();
        });
        setTimeout(done, 2300); // the animation lasts 2.1 s (2.2 s with reduced motion)
        return banner;
    }

    /// A legendary card was played: "Legendary" and its name in gold across the board (.sg-legend, as in the 3D
    /// client; enemy: the opponent's). Removed after its animation (2.6 s).
    Hud.prototype.Legendary = function (name, enemy) {
        var that = this;
        if (this.legend) Remove(this.legend);
        var legend = El('div', 'sg-legend' + (enemy ? ' enemy' : ''), this.Root());
        legend.setAttribute('aria-hidden', 'true');
        El('small', '', legend, 'Legendary');
        El('b', '', legend, name);
        this.legend = legend;
        setTimeout(function () {
            Remove(legend);
            if (that.legend === legend) that.legend = null;
        }, 2700);
        return legend;
    }

    /// A flash of light over the board centred on a stage point: kind "legendary" (gold, the whole board) or "epic"
    /// (violet, smaller). Removed after its animation.
    Hud.prototype.Flash = function (kind, x, y) {
        var flash = El('div', 'souls-classic-flash ' + (kind === 'legendary' ? 'legendary' : 'epic'), this.Root());
        flash.setAttribute('aria-hidden', 'true');
        var p = this.ToOverlay(x, y);
        flash.style.setProperty('--x', Math.round(p.x) + 'px');
        flash.style.setProperty('--y', Math.round(p.y) + 'px');
        setTimeout(function () { Remove(flash); }, 1300);
        return flash;
    }

    /// The container of the short messages (created on first use, announced politely).
    Hud.prototype.Toasts = function () {
        if (!this.toasts || !this.toasts.parentNode) {
            this.toasts = El('div', 'sg-toasts', this.Root());
            this.toasts.setAttribute('role', 'status');
            this.toasts.setAttribute('aria-live', 'polite');
        }
        return this.toasts;
    }

    /// A short message ("Not enough mana!"); warn (default) for errors. At most three at once, each for 2.4 s.
    Hud.prototype.Toast = function (text, warn) {
        if (text === undefined || text === null || String(text) === '') return null;
        var box = this.Toasts();
        while (box.childNodes.length >= 3) box.removeChild(box.firstChild);
        var toast = El('div', 'sg-toast' + (warn === false ? '' : ' warn'), box);
        toast.appendChild(Icon(warn === false ? 'sparkles' : 'info'));
        Text(toast, text);
        setTimeout(function () { Remove(toast); }, 2400);
        return toast;
    }

    // ---- Player status (mana, deck, hand, fatigue) ---------------------------------------------------------------

    function Status(hud, isPlayer) {
        this.hud = hud;
        this.isPlayer = !!isPlayer;
        this.key = null;
        this.at = null;
        var box = this.el = El('div', 'sg-status ' + (isPlayer ? 'souls-classic-status-me' : 'souls-classic-status-foe'), hud.Root());
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', isPlayer ? 'Your mana and cards' : "Opponent's cards");
        box.hidden = true;
        var that = this;
        this.untrack = hud.Track(function () { that.Layout(); });
    }

    /// Where the pill is, in stage coordinates: its left edge (or its centre with centred), vertically centred.
    Status.prototype.SetPosition = function (x, y, centred) {
        this.at = { x: x, y: y, centred: !!centred };
        this.Layout();
    }

    Status.prototype.Layout = function () {
        if (!this.at) return;
        var centred = this.at.centred;
        this.hud.Place(this.el, this.at.x, this.at.y, {
            dx: centred ? '-50%' : '0px',
            dy: '-50%',
            origin: centred ? '50% 50%' : '0 50%',
            scale: this.isPlayer ? 1.15 : 0.95
        });
    }

    /// {mana, maxMana, deck, hand, fatigue}: rebuilt only when a number changes.
    Status.prototype.Set = function (info) {
        info = info || {};
        var mana = Math.max(0, Number(info.mana) || 0);
        var max = Math.min(10, Math.max(Number(info.maxMana) || 0, mana));
        mana = Math.min(mana, 10);
        var deck = typeof info.deck === 'number' ? info.deck : null;
        var hand = typeof info.hand === 'number' ? info.hand : null;
        var fatigue = Number(info.fatigue) || 0;
        var key = [mana, max, deck, hand, fatigue].join('|');
        if (key === this.key) return;
        this.key = key;

        var box = this.el;
        Clear(box);
        if (this.isPlayer) {
            var pips = El('span', 'sg-mana', box);
            pips.setAttribute('role', 'img');
            pips.setAttribute('aria-label', 'Mana ' + mana + ' of ' + max);
            pips.title = 'Mana';
            for (var i = 0; i < 10; i++) {
                // Available mana is full, mana spent this turn dim, the rest of the ten empty.
                El('i', i < mana ? 'full' : i < max ? 'spent' : '', pips);
            }
            El('b', '', pips, mana + '/' + max);
        }
        if (deck !== null) {
            var deckSpan = El('span', '', box);
            deckSpan.title = 'Cards left in the deck';
            deckSpan.appendChild(Icon('deck'));
            Text(deckSpan, deck);
            El('span', 's-sr-only', deckSpan, ' in the deck');
        }
        if (hand !== null) {
            var handSpan = El('span', '', box);
            handSpan.title = 'Cards in hand';
            handSpan.appendChild(Icon('hand'));
            Text(handSpan, hand);
            El('span', 's-sr-only', handSpan, ' in hand');
        }
        if (fatigue > 0) {
            var warn = El('span', 'warn', box);
            warn.title = 'The deck is empty: every draw deals fatigue damage';
            warn.appendChild(Icon('skull'));
            Text(warn, 'Fatigue ' + fatigue);
        }
        box.hidden = !box.firstChild;
    }

    Status.prototype.Hide = function () {
        this.el.hidden = true;
    }

    Status.prototype.Destroy = function () {
        if (this.untrack) this.untrack();
        this.untrack = null;
        Remove(this.el);
    }

    Hud.prototype.Status = function (isPlayer) {
        return new Status(this, isPlayer);
    }

    // ---- Daily quests and counters (menu and end screen) ---------------------------------------------------------

    /// ul.sg-quest-list > li[.done] > text + coin chip + progress. animate: the bars grow from 0 after a moment.
    Hud.prototype.QuestList = function (parent, quests, animate) {
        var list = El('ul', 'sg-quest-list', parent);
        quests = quests || [];
        for (var i = 0; i < quests.length; i++) {
            var q = quests[i] || {};
            var target = Number(q.target) || 0;
            var progress = Math.max(0, Math.min(Number(q.progress) || 0, target || Number(q.progress) || 0));
            var fraction = target > 0 ? progress / target : (q.done ? 1 : 0);
            var item = El('li', q.done ? 'done' : '', list);
            El('span', '', item, (q.done ? '✔ ' : '') + String(q.text === undefined || q.text === null ? '' : q.text));
            var chip = El('span', 's-chip s-chip-coin', item);
            chip.title = 'Reward';
            chip.appendChild(Icon('coin'));
            Text(chip, Number(q.reward) || 0);
            var bar = Progress(item, animate ? 0 : fraction, q.done ? 's-progress-done' : '', 'Progress ' + progress + ' of ' + target);
            if (animate) this.Later(bar, fraction, 1300);
        }
        return list;
    }

    /// Sets a progress bar after a delay (the bar's width transition animates it).
    Hud.prototype.Later = function (bar, fraction, delay) {
        if (ReducedMotion()) {
            SetProgress(bar, fraction);
            return;
        }
        setTimeout(function () { SetProgress(bar, fraction); }, delay || 0);
    }

    /// Counts a number up from 0 to target in a text node ("+12"), starting after delay ms.
    Hud.prototype.CountUp = function (node, target, prefix, delay) {
        target = Math.abs(Number(target) || 0);
        prefix = prefix || '';
        if (ReducedMotion() || target === 0) {
            node.textContent = prefix + target;
            return;
        }
        var duration = 900;
        var start = Date.now() + (delay || 0);
        var timer = setInterval(function () {
            var t = Math.min(1, Math.max(0, (Date.now() - start) / duration));
            node.textContent = prefix + Math.round(target * (1 - Math.pow(1 - t, 3)));
            if (t >= 1) clearInterval(timer);
        }, 33);
    }

    return new Hud();
});
