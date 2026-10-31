// Emotes: a button next to the settings opens the emotes (from the page config) and a switch that mutes the
// opponent's; what a hero says shows as a speech bubble above the player's hero or below the opponent's.
define("emotes", ["hud", "conf", "messages", "asset"], function (Hud, Conf, Message, Asset) {

    var EMOTE = Message.Type.Game.EMOTE;
    var MUTE_EMOTES = Message.Type.Game.MUTE_EMOTES;
    var HERO_HALF_HEIGHT = 125; // heroes are 250 high, placed by their centre

    function Emotes(engine) {
        var that = this;
        this.engine = engine;
        this.muted = false;
        this.bubbles = {};
        var root = Hud.Root();

        var button = this.button = Hud.Button('sg-icon-btn souls-classic-emotes-btn', root, null, 'smile');
        button.setAttribute('aria-label', 'Emotes');
        button.setAttribute('aria-expanded', 'false');
        button.title = 'Emotes';
        button.hidden = true;

        var panel = this.panel = Hud.El('section', 's-panel sg-emotes souls-classic-emotes', root);
        panel.setAttribute('aria-label', 'Emotes');
        panel.hidden = true;
        ((Conf.rules && Conf.rules.emotes) || []).forEach(function (text, i) {
            Hud.Button('s-btn s-btn-ghost s-btn-sm', panel, text).addEventListener('click', function () {
                that.Toggle(false);
                engine.gameSocket.send({ "Type": EMOTE, "Payload": { "emote": i } });
            });
        });
        var mute = this.muteButton = Hud.Button('s-btn s-btn-ghost s-btn-sm', panel, 'Mute opponent', 'mute');
        mute.setAttribute('aria-pressed', 'false');
        mute.addEventListener('click', function () {
            that.muted = !that.muted;
            mute.setAttribute('aria-pressed', String(that.muted));
            Hud.Clear(mute);
            mute.appendChild(Hud.Icon(that.muted ? 'volume' : 'mute'));
            Hud.Text(mute, that.muted ? 'Unmute opponent' : 'Mute opponent');
            engine.gameSocket.send({ "Type": MUTE_EMOTES, "Payload": { "muted": that.muted } });
        });

        button.addEventListener('click', function () { that.Toggle(); });
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') that.Toggle(false);
        });
        document.addEventListener('pointerdown', function (e) {
            if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) that.Toggle(false);
        }, true);
    }

    /// The game started: the button shows.
    Emotes.prototype.Show = function () {
        this.button.hidden = false;
    }

    Emotes.prototype.Hide = function () {
        this.Toggle(false);
        this.button.hidden = true;
    }

    Emotes.prototype.Toggle = function (open) {
        if (open === undefined) open = this.panel.hidden;
        this.panel.hidden = !open;
        this.button.setAttribute('aria-expanded', String(!!open));
        if (open && this.engine.settings) this.engine.settings.Toggle(false);
    }

    /// 299 Emote {ident, emote, text}: a bubble by that hero for a few seconds (not the opponent's while muted).
    Emotes.prototype.Say = function (payload) {
        var engine = this.engine;
        var hero = engine.player && (Number(payload.ident) === Number(engine.myIdent) ? engine.player : engine.opponent);
        if (!hero || engine.ended || (hero === engine.opponent && this.muted)) return;

        var mine = hero === engine.player;
        var key = mine ? 'mine' : 'theirs';
        try { Asset.GetSound(Asset.Sound.EMOTE).play({ volume: 0.6 }); } catch (e) { /* sound is optional */ }
        var old = this.bubbles[key];
        if (old) old.Remove();

        var bubble = Hud.El('div', 'sg-bubble ' + key, Hud.Root(), String(payload.text === undefined || payload.text === null ? '' : payload.text));
        bubble.setAttribute('role', 'status');
        var home = hero.GetHome();
        var untrack = Hud.Track(function (hud) {
            hud.Place(bubble, home.x, home.y + (mine ? -HERO_HALF_HEIGHT : HERO_HALF_HEIGHT), { dx: '-50%', dy: mine ? '-100%' : '0px' });
        });
        var bubbles = this.bubbles;
        var entry = bubbles[key] = {
            Remove: function () {
                untrack();
                Hud.Remove(bubble);
                if (bubbles[key] === entry) delete bubbles[key];
            }
        };
        setTimeout(entry.Remove, 2800);
    }

    return Emotes;
});
