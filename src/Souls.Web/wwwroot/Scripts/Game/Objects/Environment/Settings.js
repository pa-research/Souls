// The settings button (a corner of the board) and its panel: sound on / off (remembered, see AudioButton.js) and
// leaving the game. Leaving forfeits the game unless the player comes back within the server's grace period.
define("settings", ["hud", "audio"], function (Hud, Sound) {

    var PANEL_ID = 'souls-classic-settings';
    var LEAVE_QUESTION = 'Leave the game? You lose it if you do not come back within a minute.';

    function Settings(engine) {
        var that = this;
        this.engine = engine;
        var root = Hud.Root();

        var button = this.button = Hud.Button('sg-icon-btn souls-classic-settings-btn', root, null, 'settings');
        button.setAttribute('aria-label', 'Settings');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', PANEL_ID);
        button.title = 'Settings';
        button.hidden = true;

        var panel = this.panel = Hud.El('section', 's-panel sg-settings souls-classic-settings', root);
        panel.id = PANEL_ID;
        panel.setAttribute('aria-label', 'Settings');
        panel.hidden = true;

        var head = Hud.El('div', 's-panel-head', panel);
        head.appendChild(Hud.Icon('settings'));
        Hud.El('h3', '', head, 'Settings');
        var close = this.closeButton = Hud.Button('sg-icon-btn souls-classic-settings-close', head, null, 'close');
        close.setAttribute('aria-label', 'Close settings');

        // Sound: On / Off
        var row = Hud.El('div', 'sg-setting', panel);
        var label = Hud.El('span', '', row, 'Sound');
        label.id = PANEL_ID + '-sound';
        var seg = Hud.El('div', 's-seg', row);
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-labelledby', label.id);
        this.soundButtons = [['On', false, 'volume'], ['Off', true, 'mute']].map(function (option) {
            var b = Hud.Button('', seg, option[0], option[2]);
            b.addEventListener('click', function () {
                if (Sound.IsMuted() !== option[1]) Sound.SetMuted(option[1]);
                that.UpdateSound();
            });
            b.mutedValue = option[1];
            return b;
        });
        this.UpdateSound();

        var leave = this.leaveButton = Hud.Button('s-btn s-btn-danger s-btn-sm', panel, 'Leave game', 'logout');
        leave.addEventListener('click', function () { that.Leave(); });

        button.addEventListener('click', function () { that.Toggle(); });
        close.addEventListener('click', function () {
            that.Toggle(false);
            button.focus();
        });

        // Escape and a click outside close the panel.
        this.onKey = function (e) {
            if (e.key === 'Escape' && !panel.hidden) {
                that.Toggle(false);
                button.focus();
            }
        };
        this.onOutside = function (e) {
            if (panel.hidden) return;
            var target = e.target;
            if (panel.contains(target) || button.contains(target)) return;
            that.Toggle(false);
        };
        window.addEventListener('keydown', this.onKey);
        document.addEventListener('pointerdown', this.onOutside, true);
    }

    Settings.prototype.constructor = Settings;

    /// Shows the settings button (the game has started).
    Settings.prototype.Show = function () {
        this.button.hidden = false;
    }

    Settings.prototype.Hide = function () {
        this.Toggle(false);
        this.button.hidden = true;
    }

    Settings.prototype.IsOpen = function () {
        return !this.panel.hidden;
    }

    Settings.prototype.Toggle = function (open) {
        if (open === undefined) open = this.panel.hidden;
        open = !!open;
        this.panel.hidden = !open;
        this.button.setAttribute('aria-expanded', String(open));
        if (open) {
            this.UpdateSound();
            var active = this.soundButtons[Sound.IsMuted() ? 1 : 0];
            try { active.focus({ preventScroll: true }); } catch (e) { /* focus is optional */ }
        }
    }

    Settings.prototype.UpdateSound = function () {
        var muted = Sound.IsMuted();
        this.soundButtons.forEach(function (b) {
            var on = b.mutedValue === muted;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    }

    /// Asks first while the game runs, then goes back to the game menu.
    Settings.prototype.Leave = function () {
        var engine = this.engine;
        if (engine && !engine.ended && !window.confirm(LEAVE_QUESTION)) return;
        // Forget the running game, or /Game would resume it instead of showing the menu.
        if (window.SoulsGameMode) window.SoulsGameMode.clearInGame();
        window.location.href = '/Game';
    }

    Settings.prototype.Destroy = function () {
        window.removeEventListener('keydown', this.onKey);
        document.removeEventListener('pointerdown', this.onOutside, true);
        Hud.Remove(this.button);
        Hud.Remove(this.panel);
    }

    return Settings;
});
