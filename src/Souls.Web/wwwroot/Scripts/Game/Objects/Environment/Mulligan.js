// The mulligan, as a DOM layer over the canvas (shared components from css/game-hud.css, the card face from
// site.css): the starting hand as card faces, tap the ones to replace and confirm once before the countdown ends.
// The new cards are shown until both players have chosen and the first turn starts. Server strings are set as text.
define("mulligan", ["hud"], function (Hud) {

    var RARITIES = ['', 'common', 'rare', 'epic', 'legendary'];

    function Url(value) {
        return 'url(' + JSON.stringify(String(value === undefined || value === null ? '' : value)) + ')';
    }

    /// A card face like the site's card tiles (.s-card in site.css, same layout as Views/Shared/_CardTile.cshtml).
    function CardFace(parent, d) {
        var spell = d.kind === 'spell';
        var card = Hud.El('div', 's-card card-container rarity-' + (RARITIES[Number(d.rarity)] || 'common') + (spell ? ' spell' : ''), parent);
        card.style.backgroundImage = Url((d.race && d.race.cardUrl) || '/Content/Images/Card/Texture/card_error.png');
        Hud.El('div', 's-card-portrait card-portrait', card).style.backgroundImage = Url(d.portrait);
        Hud.El('div', 's-card-cost', card, d.cost);
        var name = String(d.name === undefined || d.name === null ? '' : d.name);
        Hud.El('div', 's-card-title' + (name.length > 14 ? ' xlong' : name.length > 10 ? ' long' : ''), card, name);
        if (Number(d.level) > 1) Hud.El('div', 's-card-stars', card, new Array(Number(d.level)).join('★'));
        Hud.El('span', 's-card-gem', card);
        if (d.ability) {
            Hud.El('div', 's-card-ability', card, d.ability.label || d.ability.name || '');
            Hud.El('div', 's-card-rules', card, d.ability.text || '');
        }
        else if (d.flavor) {
            Hud.El('div', 's-card-flavor', card, d.flavor);
        }
        if (spell) {
            var plate = Hud.El('div', 's-card-spell', card);
            Hud.El('span', '', plate, 'Spell');
            Hud.El('span', '', plate, 'Spell');
        }
        else {
            Hud.El('div', 's-card-attack', card, d.attack);
            Hud.El('div', 's-card-health', card, d.health);
        }
        if (Number(d.armor) > 0) Hud.El('div', 's-card-armor', card, d.armor);
        return card;
    }

    function Mark(button, iconName, text) {
        var mark = Hud.El('span', 'sg-mulligan-mark', button);
        mark.appendChild(Hud.Icon(iconName));
        Hud.Text(mark, text);
    }

    function Pressed(button) {
        return button.getAttribute('aria-pressed') === 'true';
    }

    /// cards: the starting hand; info: GameCreate's mulligan {endsIn, time, done}; onConfirm(cids to replace).
    function Mulligan(cards, info, opponent, onConfirm) {
        var that = this;
        this.opponent = String(opponent === undefined || opponent === null ? '' : opponent);
        this.opponentDone = false;
        this.locked = false;
        this.buttons = [];

        var layer = this.layer = Hud.Layer('sg-mulligan');
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', 'Mulligan');
        var box = Hud.El('div', 'sg-mulligan-box', layer);
        Hud.El('div', 's-eyebrow', box, 'Mulligan');
        Hud.El('h2', '', box, 'Your starting hand');
        Hud.El('p', '', box, 'Tap the cards you want to replace. You can do this once.');
        var row = Hud.El('div', 'sg-mulligan-cards', box);
        var timer = Hud.El('div', 'sg-mulligan-timer', box);
        var bar = Hud.Progress(timer, 1, 's-progress-ember', 'Time left');
        var time = Hud.El('span', 'sg-time', timer);
        var confirm = this.confirm = Hud.Button('s-btn s-btn-gold s-btn-lg sg-mulligan-confirm', box, 'Keep hand', 'check');
        this.status = Hud.El('p', 'sg-mulligan-status s-muted', box);
        this.status.setAttribute('aria-live', 'polite');

        cards = cards || [];
        for (var i = 0; i < cards.length; i++) {
            var button = Hud.Button('sg-mulligan-card', row);
            button.setAttribute('aria-pressed', 'false');
            button.cid = cards[i].cid;
            CardFace(button, cards[i]);
            Mark(button, 'refresh', 'Replace');
            button.addEventListener('click', function () {
                this.setAttribute('aria-pressed', String(!Pressed(this)));
                var n = that.buttons.filter(Pressed).length;
                Hud.Clear(confirm);
                confirm.appendChild(Hud.Icon(n ? 'refresh' : 'check'));
                Hud.Text(confirm, n ? 'Replace ' + n + ' card' + (n > 1 ? 's' : '') : 'Keep hand');
            });
            this.buttons.push(button);
        }

        confirm.addEventListener('click', function () {
            that.Lock('Waiting for ' + that.opponent + '…');
            onConfirm(that.buttons.filter(Pressed).map(function (b) { return b.cid; }));
        });
        if (info && info.done) this.Lock('Waiting for ' + this.opponent + '…');

        var endsAt = Date.now() + (Number(info && info.endsIn) || 0);
        var total = Number(info && info.time) || 30000;
        function Tick() {
            var left = Math.max(0, endsAt - Date.now());
            Hud.SetProgress(bar, left / total);
            time.textContent = Hud.Clock(left);
            if (left > 0 || that.locked) return;
            for (var k = 0; k < that.buttons.length; k++) that.buttons[k].setAttribute('aria-pressed', 'false');
            that.Lock('Time is up: you keep your hand.');
        }
        Tick();
        this.clock = setInterval(Tick, 250);
        if (!this.locked) confirm.focus({ preventScroll: true });
    }

    Mulligan.prototype.constructor = Mulligan;

    Mulligan.prototype.Lock = function (text) {
        this.locked = true;
        for (var i = 0; i < this.buttons.length; i++) this.buttons[i].disabled = true;
        this.confirm.disabled = true;
        this.status.textContent = text;
    }

    /// A mulligan was made (227 / 228): ours shows the new cards in place of the replaced ones, the opponent's how many.
    Mulligan.prototype.Chosen = function (mine, hand, replaced) {
        if (!mine) {
            this.opponentDone = true;
            this.status.textContent = replaced
                ? this.opponent + ' replaced ' + replaced + ' card' + (replaced > 1 ? 's' : '') + '.'
                : this.opponent + ' kept their hand.';
            return;
        }
        for (var i = 0; i < hand.length && i < this.buttons.length; i++) {
            var button = this.buttons[i];
            var isNew = replaced > 0 && Pressed(button);
            button.disabled = true;
            button.setAttribute('aria-pressed', 'false');
            button.classList.toggle('new', isNew);
            Hud.Clear(button);
            CardFace(button, hand[i]);
            Mark(button, isNew ? 'sparkles' : 'check', isNew ? 'New' : 'Kept');
        }
        this.locked = true;
        this.status.textContent = this.opponentDone ? 'The battle begins!' : 'Waiting for ' + this.opponent + '…';
    }

    /// The first turn starts (or the game ended): the layer fades out.
    Mulligan.prototype.Close = function () {
        clearInterval(this.clock);
        Hud.CloseLayer(this.layer, true);
    }

    return Mulligan;
});
