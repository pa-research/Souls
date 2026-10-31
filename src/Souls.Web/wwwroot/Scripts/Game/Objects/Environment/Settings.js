// The settings button (a corner of the board) and its panel: sound on / off (remembered, see AudioButton.js), the
// language (the page reloads in it and the running game is resumed, see SoulsGameMode.resume) and leaving the game.
// Leaving forfeits the game unless the player comes back within the server's grace period.
define("settings", ["hud", "audio"], function (Hud, Sound) {

    var PANEL_ID = 'souls-classic-settings';
    var L10n = window.SoulsL10n;
    var T = L10n.t;

    function Settings(engine) {
        var that = this;
        this.engine = engine;
        var root = Hud.Root();

        var button = this.button = Hud.Button('sg-icon-btn souls-classic-settings-btn', root, null, 'settings');
        button.setAttribute('aria-label', T('classic.settings'));
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', PANEL_ID);
        button.title = T('classic.settings');
        button.hidden = true;

        var panel = this.panel = Hud.El('section', 's-panel sg-settings souls-classic-settings', root);
        panel.id = PANEL_ID;
        panel.setAttribute('aria-label', T('classic.settings'));
        panel.hidden = true;

        var head = Hud.El('div', 's-panel-head', panel);
        head.appendChild(Hud.Icon('settings'));
        Hud.El('h3', '', head, T('classic.settings'));
        var close = this.closeButton = Hud.Button('sg-icon-btn souls-classic-settings-close', head, null, 'close');
        close.setAttribute('aria-label', T('classic.settings.close'));

        // Sound: On / Off
        var row = Hud.El('div', 'sg-setting', panel);
        var label = Hud.El('span', '', row, T('classic.settings.sound'));
        label.id = PANEL_ID + '-sound';
        var seg = Hud.El('div', 's-seg', row);
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-labelledby', label.id);
        this.soundButtons = [[T('classic.settings.on'), false, 'volume'], [T('classic.settings.off'), true, 'mute']].map(function (option) {
            var b = Hud.Button('', seg, option[0], option[2]);
            b.addEventListener('click', function () {
                if (Sound.IsMuted() !== option[1]) Sound.SetMuted(option[1]);
                that.UpdateSound();
            });
            b.mutedValue = option[1];
            return b;
        });
        this.UpdateSound();

        // Language: the current one is pressed; another reloads the page in it.
        if (L10n.languages.length > 1) {
            var languageRow = Hud.El('div', 'sg-setting', panel);
            var languageLabel = Hud.El('span', '', languageRow, T('classic.settings.language'));
            languageLabel.id = PANEL_ID + '-language';
            var languages = Hud.El('div', 's-seg', languageRow);
            languages.setAttribute('role', 'group');
            languages.setAttribute('aria-labelledby', languageLabel.id);
            L10n.languages.forEach(function (language) {
                var current = language.code === L10n.lang;
                var b = Hud.Button(current ? 'active' : '', languages, language.name);
                b.lang = language.code;
                b.setAttribute('aria-pressed', String(current));
                b.addEventListener('click', function () { L10n.setLanguage(language.code); });
            });
        }

        var leave = this.leaveButton = Hud.Button('s-btn s-btn-danger s-btn-sm', panel, T('classic.settings.leave'), 'logout');
        leave.addEventListener('click', function () { that.Leave(); });

        button.addEventListener('click', function () { that.Toggle(); });
        close.addEventListener('click', function () {
            that.Toggle(false);
            button.focus();
        });

        // Escape and a click outside close the panel (not one in the leave dialog, which opens from it).
        this.onKey = function (e) {
            if (e.key === 'Escape' && !panel.hidden) {
                that.Toggle(false);
                button.focus();
            }
        };
        this.onOutside = function (e) {
            if (panel.hidden) return;
            var target = e.target;
            if (panel.contains(target) || button.contains(target) || (target.closest && target.closest('dialog'))) return;
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
            if (this.engine.emotes) this.engine.emotes.Toggle(false);
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

    /// Asks first while the game runs (the dialog shared with the 3D client), then goes back to the game menu.
    Settings.prototype.Leave = function () {
        window.SoulsGameMode.leave(!this.engine.ended);
    }

    Settings.prototype.Destroy = function () {
        window.removeEventListener('keydown', this.onKey);
        document.removeEventListener('pointerdown', this.onOutside, true);
        Hud.Remove(this.button);
        Hud.Remove(this.panel);
    }

    return Settings;
});
