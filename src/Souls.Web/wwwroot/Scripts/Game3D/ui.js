// DOM overlay for the 3D client: loading, menu, queue status, screen messages, end screen, chat and audio.
import { Images, sound } from './assets.js';
import { VIEWS } from './scene.js';

function readNumber(key, fallback) {
    try {
        const value = Number(localStorage.getItem(key));
        return localStorage.getItem(key) !== null && Number.isFinite(value) ? value : fallback;
    } catch (e) {
        return fallback;
    }
}

function el(tag, className, parent, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
}

export class UI {
    constructor(root) {
        this.root = el('div', 'souls3d-ui', root);
        this.messages = [];

        // Loading / queue overlay.
        this.overlay = el('div', 'souls3d-overlay', this.root);
        const logo = el('img', 'souls3d-logo', this.overlay);
        logo.src = Images.logo;
        logo.alt = 'Souls';
        this.status = el('div', 'souls3d-status', this.overlay, 'Loading...');
        this.progress = el('div', 'souls3d-progress', this.overlay);
        this.progressBar = el('div', '', this.progress);

        // Menu with the classic practice / normal game buttons.
        this.menu = el('div', 'souls3d-menu', this.overlay);
        this.menu.hidden = true;
        this.practiceButton = this.menuButton(Images.practice, Images.practiceFocus, 'Practice game');
        this.normalButton = this.menuButton(Images.normal, Images.normalFocus, 'Normal game');
        // Practice difficulty (remembered per browser) and spectating.
        const extras = el('div', 'souls3d-menu-extras', this.menu);
        const difficulty = el('div', 'souls3d-difficulty', extras);
        difficulty.setAttribute('role', 'radiogroup');
        difficulty.setAttribute('aria-label', 'Practice difficulty');
        el('span', 'souls3d-difficulty-label', difficulty, 'Bot:');
        this.difficulty = readNumber('souls.difficulty', 1);
        this.difficultyButtons = ['Easy', 'Normal', 'Hard'].map((label, level) => {
            const button = el('button', '', difficulty, label);
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.addEventListener('click', () => this.setDifficulty(level));
            return button;
        });
        this.setDifficulty(this.difficulty);
        this.watchButton = el('button', 'souls3d-watch-button', extras, 'Watch live games');
        this.watchButton.type = 'button';

        // Centre screen messages ("Not enough mana!").
        this.flash = el('div', 'souls3d-flash', this.root);

        // Turn indicator.
        this.turn = el('div', 'souls3d-turn', this.root);
        this.turn.hidden = true;

        // End of game.
        this.end = el('div', 'souls3d-end', this.root);
        this.end.hidden = true;
        this.endText = el('div', 'souls3d-end-text', this.end);
        this.endHint = el('div', 'souls3d-end-hint', this.end, 'Loading statistics...');

        // Audio toggle (classic audio_on/off images).
        this.audio = el('button', 'souls3d-audio', this.root);
        this.audio.type = 'button';
        this.audioImg = el('img', '', this.audio);
        this.audioImg.alt = '';
        this.updateAudioButton();
        this.audio.addEventListener('click', () => { sound.toggle(); this.updateAudioButton(); });

        this.buildChat();
        this.chat.hidden = true;
        this.buildLog();
        this.log.hidden = true;
        this.buildViews();
        this.buildTimer();
        this.buildPower();
        this.tooltip = el('div', 'souls3d-tooltip', this.root);
        this.tooltip.hidden = true;
        this.tooltip.setAttribute('role', 'tooltip');
    }

    setDifficulty(level) {
        this.difficulty = level;
        this.difficultyButtons.forEach((b, i) => {
            b.classList.toggle('active', i === level);
            b.setAttribute('aria-checked', String(i === level));
        });
        try { localStorage.setItem('souls.difficulty', String(level)); } catch (e) { /* ignore */ }
    }

    // ---- Turn timer ----------------------------------------------------------------------------------------------

    buildTimer() {
        this.timer = el('div', 'souls3d-timer', this.root);
        this.timer.hidden = true;
        this.timerBar = el('div', 'souls3d-timer-bar', this.timer);
        this.timerText = el('div', 'souls3d-timer-text', this.timer);
    }

    /** Shows the turn timer counting down to `endsAt` (performance.now() time). */
    setTimer(endsAt, total, mine) {
        this.timerEndsAt = endsAt;
        this.timerTotal = Math.max(1, total);
        this.timer.hidden = false;
        this.timer.classList.toggle('mine', !!mine);
    }

    hideTimer() {
        this.timer.hidden = true;
        this.timerEndsAt = null;
    }

    /** Every frame: the rope burns down; red and pulsing in the last 15 seconds. */
    updateTimer(now, x, y) {
        if (this.timerEndsAt === null || this.timerEndsAt === undefined) return;
        const left = Math.max(0, this.timerEndsAt - now);
        this.timerBar.style.width = `${(left / this.timerTotal) * 100}%`;
        const seconds = Math.ceil(left / 1000);
        if (this.timerText.textContent !== String(seconds)) this.timerText.textContent = String(seconds);
        this.timer.classList.toggle('urgent', left < 15000);
        if (x !== undefined) this.timer.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, 0)`;
    }

    // ---- Hero power ----------------------------------------------------------------------------------------------

    buildPower() {
        this.power = el('button', 'souls3d-power', this.root);
        this.power.type = 'button';
        this.power.hidden = true;
        this.powerCost = el('span', 'souls3d-power-cost', this.power, '2');
        this.powerName = el('span', 'souls3d-power-name', this.power);
        this.power.addEventListener('click', e => {
            e.stopPropagation();
            if (!this.power.disabled && this.onPower) this.onPower();
        });
        this.power.addEventListener('mouseenter', () => { if (this.powerInfo) this.showTooltip(this.powerInfo, this.power.getBoundingClientRect()); });
        this.power.addEventListener('mouseleave', () => this.hideTooltip());
    }

    /** {name, text, cost, canUse, used} or null to hide. */
    setPower(power) {
        if (!power) {
            this.power.hidden = true;
            return;
        }
        this.power.hidden = false;
        this.powerName.textContent = power.name;
        this.powerCost.textContent = String(power.cost);
        this.power.disabled = !power.canUse;
        this.power.classList.toggle('used', !!power.used);
        this.power.classList.toggle('ready', !!power.canUse);
        this.power.setAttribute('aria-label', `Hero power: ${power.name} (${power.cost} mana)`);
        this.powerInfo = { title: `${power.name} \u00b7 ${power.cost} mana`, lines: [power.text, power.used ? 'Already used this turn.' : 'Once per turn.'] };
    }

    placePower(x, y) {
        this.power.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    }

    setPowerArmed(on) {
        this.power.classList.toggle('armed', on);
    }

    // ---- Tooltips ------------------------------------------------------------------------------------------------

    /** {title, lines: [string]} next to a screen point or rectangle. Server text is always inserted as text. */
    showTooltip(info, at) {
        if (!info) {
            this.hideTooltip();
            return;
        }
        this.tooltip.replaceChildren();
        el('div', 'souls3d-tooltip-title', this.tooltip, info.title);
        for (const line of info.lines || []) {
            if (line) el('div', 'souls3d-tooltip-line', this.tooltip, line);
        }
        this.tooltip.hidden = false;
        const box = this.tooltip.getBoundingClientRect();
        const host = this.root.getBoundingClientRect();
        let x, y;
        if (at && at.width !== undefined) {
            x = at.right - host.left + 12;
            y = at.top - host.top;
        } else {
            x = (at ? at.x : 0) + 18;
            y = (at ? at.y : 0) + 18;
        }
        if (x + box.width > host.width - 8) x = Math.max(8, (at && at.width !== undefined ? at.left - host.left : x - 36) - box.width - 12);
        if (y + box.height > host.height - 8) y = Math.max(8, host.height - box.height - 8);
        this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    hideTooltip() {
        this.tooltip.hidden = true;
    }

    // ---- Battle log ----------------------------------------------------------------------------------------------

    buildLog() {
        const log = el('section', 'souls3d-log', this.root);
        log.setAttribute('aria-label', 'Battle log');
        const header = el('button', 'souls3d-log-header', log, 'Battle log');
        header.type = 'button';
        header.addEventListener('click', () => log.classList.toggle('collapsed'));
        this.logList = el('ol', 'souls3d-log-list', log);
        this.logList.setAttribute('aria-live', 'polite');
        if (window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 500px)').matches) log.classList.add('collapsed');
        this.log = log;
    }

    logLine(text) {
        el('li', '', this.logList, String(text));
        while (this.logList.childElementCount > 200) this.logList.firstElementChild.remove();
        this.logList.scrollTop = this.logList.scrollHeight;
    }

    logLines() {
        return [...this.logList.children].map(li => li.textContent);
    }

    // ---- Spectating and replays ----------------------------------------------------------------------------------

    /** The list of running games; resolves with the picked game id, or null to go back. */
    showLiveGames(games, onRefresh) {
        this.overlay.hidden = false;
        this.overlay.classList.remove('fading');
        this.menu.hidden = true;
        this.progress.hidden = true;
        this.status.textContent = '';
        if (this.live) this.live.remove();
        const panel = el('div', 'souls3d-live', this.overlay);
        this.live = panel;
        el('h2', '', panel, 'Live games');
        return new Promise(resolve => {
            const done = value => { panel.remove(); this.live = null; resolve(value); };
            if (games.length === 0) el('p', 'souls3d-live-empty', panel, 'Nobody is playing right now.');
            const list = el('ul', '', panel);
            for (const g of games) {
                const item = el('li', '', list);
                const [a, b] = g.players || [];
                const name = p => `${p.name}${p.rating ? ` (${p.rating})` : ''}`;
                el('span', 'souls3d-live-names', item, a && b ? `${name(a)} vs ${name(b)}` : `Game ${g.gameId}`);
                el('span', 'souls3d-live-meta', item, `${g.practice ? 'Practice' : 'Ranked'} \u00b7 turn ${(g.turn ?? 0) + 1} \u00b7 ${g.spectators ?? 0} watching`);
                const watch = el('button', '', item, 'Watch');
                watch.type = 'button';
                watch.addEventListener('click', () => done(g.gameId));
            }
            const actions = el('div', 'souls3d-live-actions', panel);
            const refresh = el('button', '', actions, 'Refresh');
            refresh.type = 'button';
            refresh.addEventListener('click', () => { done(undefined); onRefresh(); });
            const back = el('button', '', actions, 'Back');
            back.type = 'button';
            back.addEventListener('click', () => done(null));
        });
    }

    /** The banner while watching someone else's game. */
    showSpectating(text, onLeave) {
        if (!this.banner) {
            this.banner = el('div', 'souls3d-banner', this.root);
            this.bannerText = el('span', '', this.banner);
            this.bannerLeave = el('button', '', this.banner, 'Leave');
            this.bannerLeave.type = 'button';
        }
        this.bannerText.textContent = text;
        this.bannerLeave.onclick = onLeave;
        this.banner.hidden = false;
    }

    /** Play/pause, speed and restart for replays. */
    showReplay({ onToggle, onSpeed, onRestart }) {
        const bar = el('div', 'souls3d-replay', this.root);
        const toggle = el('button', '', bar, 'Pause');
        toggle.type = 'button';
        toggle.addEventListener('click', () => { toggle.textContent = onToggle() ? 'Pause' : 'Play'; });
        for (const speed of [1, 2, 4]) {
            const b = el('button', speed === 1 ? 'active' : '', bar, `${speed}x`);
            b.type = 'button';
            b.addEventListener('click', () => {
                onSpeed(speed);
                bar.querySelectorAll('.speed').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            });
            b.classList.add('speed');
        }
        const restart = el('button', '', bar, 'Restart');
        restart.type = 'button';
        restart.addEventListener('click', onRestart);
        this.replayProgress = el('div', 'souls3d-replay-progress', bar);
        this.replayBar = el('div', '', this.replayProgress);
    }

    setReplayProgress(fraction) {
        if (this.replayBar) this.replayBar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    }

    /** Camera view buttons (keys 1-4) and a hint for the free camera. */
    buildViews() {
        const bar = el('div', 'souls3d-views', this.root);
        bar.hidden = true;
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Camera');
        this.viewButtons = {};
        for (const [name, view] of Object.entries(VIEWS)) {
            if (!view.key) continue;
            const button = el('button', '', bar);
            button.type = 'button';
            el('kbd', '', button, view.key);
            button.append(` ${view.label}`);
            button.addEventListener('click', () => { if (this.onView) this.onView(name); });
            this.viewButtons[name] = button;
        }
        const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        el('span', 'souls3d-views-hint', bar, touch
            ? 'Pinch: zoom \u00b7 Drag the arena: rotate \u00b7 Hold a card: ability'
            : 'Wheel: zoom \u00b7 Right-drag: rotate');
        this.views = bar;
    }

    /** Shows the in-game controls (camera views, chat and battle log). */
    showViews(visible, { chat = true } = {}) {
        this.views.hidden = !visible;
        this.chat.hidden = !visible || !chat;
        this.log.hidden = !visible;
    }

    setView(name) {
        for (const [key, button] of Object.entries(this.viewButtons)) {
            button.classList.toggle('active', key === name);
            button.setAttribute('aria-pressed', String(key === name));
        }
    }

    menuButton(image, focus, label) {
        const button = el('button', 'souls3d-menu-button', this.menu);
        button.type = 'button';
        button.setAttribute('aria-label', label);
        const img = el('img', '', button);
        img.src = image;
        img.alt = label;
        button.addEventListener('mouseenter', () => { img.src = focus; });
        button.addEventListener('mouseleave', () => { img.src = image; });
        return button;
    }

    updateAudioButton() {
        this.audioImg.src = sound.muted ? Images.audioOff : Images.audioOn;
        this.audio.setAttribute('aria-label', sound.muted ? 'Unmute' : 'Mute');
        this.audio.title = sound.muted ? 'Sound off' : 'Sound on';
    }

    setProgress(p) {
        this.progressBar.style.width = `${Math.round(p * 100)}%`;
        this.status.textContent = `Loading... (${Math.round(p * 100)}%)`;
    }

    /** Resolves with {mode: 'practice' | 'normal' | 'watch', difficulty}. */
    showMenu() {
        this.progress.hidden = true;
        this.status.textContent = '';
        this.menu.hidden = false;
        return new Promise(resolve => {
            this.practiceButton.onclick = () => resolve({ mode: 'practice', difficulty: this.difficulty });
            this.normalButton.onclick = () => resolve({ mode: 'normal', difficulty: this.difficulty });
            this.watchButton.onclick = () => resolve({ mode: 'watch', difficulty: this.difficulty });
        });
    }

    showQueue(text) {
        this.menu.hidden = true;
        this.progress.hidden = true;
        this.overlay.hidden = false;
        this.overlay.classList.remove('fading');
        this.overlay.classList.add('queue');
        this.status.textContent = text;
    }

    setStatus(text) {
        this.status.textContent = text;
    }

    /** "Prepare!" then fade the overlay out (classic Queue.FadeOut). */
    hideQueue() {
        this.status.textContent = 'Prepare!';
        this.overlay.classList.add('fading');
        setTimeout(() => { this.overlay.hidden = true; }, 4600);
    }

    /** `label` replaces "Your turn" / "Opponent's turn" (spectators see names). */
    setTurn(yourTurn, label) {
        this.turn.hidden = false;
        this.turn.textContent = label || (yourTurn ? 'Your turn' : "Opponent's turn");
        this.turn.classList.toggle('mine', yourTurn);
    }

    /** Classic ScreenMessage: centred text that fades in and out, queued. */
    screenMessage(text) {
        this.messages.push(String(text));
        if (this.messages.length === 1) this.nextMessage();
    }

    nextMessage() {
        if (this.messages.length === 0) return;
        this.flash.textContent = this.messages[0];
        this.flash.classList.remove('show');
        void this.flash.offsetWidth; // restart the CSS animation
        this.flash.classList.add('show');
        setTimeout(() => { this.messages.shift(); this.flash.classList.remove('show'); this.nextMessage(); }, 2000);
    }

    /** The pre-fight splash: both heroes slide in, a flaming VS between them. */
    showVersus(player, opponent) {
        const splash = el('div', 'souls3d-versus', this.root);
        const side = (info, cls) => {
            const box = el('div', `souls3d-versus-side ${cls}`, splash);
            const img = el('img', '', box);
            img.src = Images.heroPortrait(Number(info.type) || 0);
            img.alt = '';
            img.onerror = () => { img.onerror = null; img.src = Images.heroPortrait(0); };
            el('div', 'souls3d-versus-name', box, String(info.name ?? ''));
            return box;
        };
        side(player, 'left');
        el('div', 'souls3d-versus-mark', splash, 'VS');
        side(opponent, 'right');
        setTimeout(() => splash.classList.add('leaving'), 3400);
        setTimeout(() => splash.remove(), 4100);
    }

    /**
     * The end screen: result, coins and rating earned, daily quest progress, and links to the statistics and the
     * replay. Players are taken to the statistics after a while (spectators stay).
     */
    showEnd(text, result = {}, { redirect = true, detail } = {}) {
        this.turn.hidden = true;
        this.hideTimer();
        this.setPower(null);
        this.end.hidden = false;
        this.endText.textContent = text;
        this.end.classList.add(/^Victory/.test(text) ? 'victory' : /^Draw/.test(text) ? 'draw' : 'defeat');
        const statisticsId = result.statistics;
        this.endHint.replaceChildren();
        if (detail) el('div', 'souls3d-end-detail', this.endHint, detail);
        const rewards = el('div', 'souls3d-rewards', this.endHint);
        if (typeof result.coins === 'number') el('div', 'souls3d-reward coins', rewards, `+${result.coins} soul coins`);
        if (typeof result.ratingChange === 'number') {
            const sign = result.ratingChange >= 0 ? '+' : '';
            el('div', `souls3d-reward rating ${result.ratingChange >= 0 ? 'up' : 'down'}`, rewards, `Rating ${result.rating} (${sign}${result.ratingChange})`);
        }
        if (Array.isArray(result.quests) && result.quests.length) {
            const quests = el('ul', 'souls3d-quests', this.endHint);
            for (const q of result.quests) {
                const item = el('li', q.done ? 'done' : '', quests);
                el('span', '', item, `${q.done ? '\u2714 ' : ''}${q.text}`);
                el('span', 'souls3d-quest-progress', item, `${q.progress}/${q.target} \u00b7 ${q.reward} coins`);
            }
        }
        if (statisticsId) {
            const links = el('div', 'souls3d-end-links', this.endHint);
            const stats = el('a', '', links, 'Statistics');
            stats.href = `/Game/Stats/${encodeURIComponent(statisticsId)}`;
            const replay = el('a', '', links, 'Watch replay');
            replay.href = `/Game/Replay/${encodeURIComponent(statisticsId)}`;
            const again = el('a', '', links, 'Play again');
            again.href = '/Game';
            if (redirect) setTimeout(() => window.location.replace(stats.href), 15000);
        } else if (!redirect) {
            const links = el('div', 'souls3d-end-links', this.endHint);
            const back = el('a', '', links, 'Back to the menu');
            back.href = '/Game';
        }
    }

    // ---- Chat --------------------------------------------------------------------------------------------------

    buildChat() {
        const chat = el('section', 'souls3d-chat collapsed', this.root);
        chat.setAttribute('aria-label', 'Chat');
        const header = el('button', 'souls3d-chat-header', chat, 'Chat');
        header.type = 'button';
        this.chatBadge = el('span', 'souls3d-chat-badge', header);
        header.addEventListener('click', () => {
            chat.classList.toggle('collapsed');
            this.chatBadge.textContent = '';
            if (!chat.classList.contains('collapsed')) this.chatInput.focus();
        });
        const body = el('div', 'souls3d-chat-body', chat);
        this.chatLog = el('div', 'souls3d-chat-log chat-messages', body);
        this.chatMembers = el('div', 'souls3d-chat-members chat-clients', body);
        this.chatInput = el('textarea', 'souls3d-chat-input chat-input form-control', chat);
        this.chatInput.placeholder = 'Write here...';
        this.chatInput.rows = 1;
        this.chatInput.maxLength = 500;
        this.chatInput.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                const text = this.chatInput.value.trim();
                if (text && this.onChat) this.onChat(text);
                this.chatInput.value = '';
            }
        });
        this.chat = chat;
    }

    /** Chat text comes from other players: always inserted as text, never as HTML. */
    chatLine(text) {
        el('div', '', this.chatLog, text);
        this.chatLog.scrollTop = this.chatLog.scrollHeight;
        if (this.chat.classList.contains('collapsed')) {
            this.chatBadge.textContent = String((Number(this.chatBadge.textContent) || 0) + 1);
        }
    }

    chatMembersList(names) {
        this.chatMembers.replaceChildren(...names.map(n => el('div', '', null, String(n))));
    }
}
