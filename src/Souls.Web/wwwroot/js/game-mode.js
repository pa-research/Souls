// Chooses between the classic game client (PixiJS) and the modern 3D client (three.js), renders the switch
// between them and lets either client resume a running game after switching (the server re-sends the game
// state when a player reconnects within the grace period). Both clients leave a running game through it.
(function () {
    'use strict';

    var MODE_KEY = 'souls.gameMode';
    var IN_GAME_KEY = 'souls.inGame';
    var RESUME_WINDOW_MS = 55000; // a little under the server's 60 s reconnect grace period
    var inGameTimer = null;
    var leaveDialog = document.getElementById('sg-leave');

    // While the leave dialog is open, the keys are its own (Esc, Enter, Tab), not the camera keys or panels behind it,
    // and Tab goes round its two buttons (the browser would move on to the page behind it).
    window.addEventListener('keydown', function (e) {
        if (!leaveDialog || !leaveDialog.open) return;
        e.stopPropagation();
        if (e.key !== 'Tab') return;
        e.preventDefault();
        var buttons = leaveDialog.querySelectorAll('button');
        var at = Array.prototype.indexOf.call(buttons, document.activeElement);
        var next = at < 0 ? (e.shiftKey ? buttons.length - 1 : 0) : (at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length;
        buttons[next].focus();
    }, true);

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
            return !!(config.watch || config.replayUrl || new URLSearchParams(window.location.search).get('live'));
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

        /** Called by a client when the game is over (and so no longer asked about leaving it). */
        clearInGame: function () {
            clearInterval(inGameTimer);
            var session = storage('sessionStorage');
            if (session) session.removeItem(IN_GAME_KEY);
            if (leaveDialog && leaveDialog.open) leaveDialog.close();
        },

        /**
         * Back to the game menu. With `ask` (a game is running: leaving forfeits it unless the player comes back within
         * the server's grace period) the dialog in Views/Game/Index.cshtml asks first.
         */
        leave: function (ask) {
            var go = function () {
                api.clearInGame();
                window.location.href = '/Game';
            };
            if (!ask) return go();
            if (!leaveDialog || typeof leaveDialog.showModal !== 'function') {
                if (window.confirm('Leave the game? You lose it if you do not come back within a minute.')) go();
                return;
            }
            leaveDialog.returnValue = '';
            leaveDialog.onclose = function () { if (leaveDialog.returnValue === 'leave') go(); };
            leaveDialog.showModal();
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

        // The game page has no site navigation: a way home.
        var home = document.createElement('a');
        home.className = 'sg-icon-btn';
        home.href = '/';
        home.setAttribute('aria-label', 'Home');
        home.title = 'Home';
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 's-icon');
        svg.setAttribute('aria-hidden', 'true');
        var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '/img/icons.svg#i-home');
        svg.appendChild(use);
        home.appendChild(svg);
        bar.appendChild(home);

        var seg = document.createElement('div');
        seg.className = 's-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Game client');
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
            seg.appendChild(button);
        });
        bar.appendChild(seg);
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

    /** Removes the boot screen once the client shows its own interface (or after a while, whatever happens). */
    function dismissBoot() {
        var boot = document.getElementById('sg-boot');
        if (!boot) return;
        var done = function () {
            boot.classList.add('gone');
            setTimeout(function () { boot.remove(); }, 600);
            observer.disconnect();
        };
        var ready = function () {
            return document.querySelector('.sg-root, #game-window canvas') !== null;
        };
        var observer = new MutationObserver(function () { if (ready()) done(); });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(done, 30000);
        if (ready()) done();
    }

    if (!spectatorPage()) renderSwitch();
    dismissBoot();
    loadClient();
})();
