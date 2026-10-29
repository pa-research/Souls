// Chooses between the classic game client (PixiJS) and the modern 3D client (three.js), renders the switch
// between them and lets either client resume a running game after switching (the server re-sends the game
// state when a player reconnects within the grace period).
(function () {
    'use strict';

    var MODE_KEY = 'souls.gameMode';
    var IN_GAME_KEY = 'souls.inGame';
    var RESUME_WINDOW_MS = 55000; // a little under the server's 60 s reconnect grace period
    var inGameTimer = null;

    function storage(kind) {
        try { return window[kind]; } catch (e) { return null; }
    }

    function webgl2() {
        try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
    }

    /** Watching live games and replays are 3D only. */
    function spectatorPage() {
        try {
            var config = JSON.parse(document.getElementById('souls-game-config').textContent);
            return !!(config.watch || config.replayUrl);
        } catch (e) {
            return false;
        }
    }

    function currentMode() {
        if (spectatorPage()) return '3d';
        var query = new URLSearchParams(window.location.search).get('mode');
        if (query === 'classic' || query === '3d') {
            setMode(query);
            return query;
        }
        var local = storage('localStorage');
        var saved = local && local.getItem(MODE_KEY);
        if (saved === 'classic' || saved === '3d') return saved;
        return webgl2() ? '3d' : 'classic';
    }

    function setMode(mode) {
        var local = storage('localStorage');
        if (local) local.setItem(MODE_KEY, mode);
    }

    function writeInGame(normal) {
        var session = storage('sessionStorage');
        if (session) session.setItem(IN_GAME_KEY, JSON.stringify({ normal: !!normal, at: Date.now() }));
    }

    var api = {
        mode: currentMode(),

        /** Called by a client when a game starts (and kept fresh while it runs). */
        markInGame: function (normal) {
            writeInGame(normal);
            clearInterval(inGameTimer);
            inGameTimer = setInterval(function () { writeInGame(normal); }, 5000);
        },

        /** Called by a client when the game is over. */
        clearInGame: function () {
            clearInterval(inGameTimer);
            var session = storage('sessionStorage');
            if (session) session.removeItem(IN_GAME_KEY);
        },

        /** {normal} when this tab was in a game moments ago (so the client should skip its menu), else null. */
        resume: function () {
            var session = storage('sessionStorage');
            var raw = session && session.getItem(IN_GAME_KEY);
            if (!raw) return null;
            try {
                var data = JSON.parse(raw);
                if (Date.now() - data.at < RESUME_WINDOW_MS) return { normal: !!data.normal };
            } catch (e) { /* ignore */ }
            session.removeItem(IN_GAME_KEY);
            return null;
        }
    };
    window.SoulsGameMode = api;

    function renderSwitch() {
        var bar = document.createElement('div');
        bar.className = 'game-mode-switch';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Game client');
        [['classic', 'Classic'], ['3d', 'Modern 3D']].forEach(function (option) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = option[1];
            button.setAttribute('aria-pressed', String(api.mode === option[0]));
            if (api.mode === option[0]) button.className = 'active';
            button.addEventListener('click', function () {
                if (api.mode === option[0]) return;
                setMode(option[0]);
                // Drop ?mode= so the saved choice wins after the reload.
                window.location.replace(window.location.pathname);
            });
            bar.appendChild(button);
        });
        document.body.appendChild(bar);
    }

    function loadClient() {
        var script = document.createElement('script');
        if (api.mode === '3d') {
            script.type = 'module';
            script.src = '/Scripts/Game3D/main.js';
        } else {
            script.src = '/lib/requirejs/require.js';
            script.setAttribute('data-main', '/Scripts/Game/Main');
        }
        document.body.appendChild(script);
    }

    if (!spectatorPage()) renderSwitch();
    loadClient();
})();
