// DOM overlay for the 3D client: loading, menu, queue status, screen messages, end screen, chat and audio.
import { Images, sound } from './assets.js';
import { VIEWS } from './scene.js';

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
        this.buildViews();
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
        el('span', 'souls3d-views-hint', bar, 'Wheel: zoom \u00b7 Right-drag: rotate');
        this.views = bar;
    }

    /** Shows the in-game controls (camera views and chat). */
    showViews(visible) {
        this.views.hidden = !visible;
        this.chat.hidden = !visible;
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

    showMenu() {
        this.progress.hidden = true;
        this.status.textContent = '';
        this.menu.hidden = false;
        return new Promise(resolve => {
            this.practiceButton.onclick = () => resolve(false);
            this.normalButton.onclick = () => resolve(true);
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

    setTurn(yourTurn) {
        this.turn.hidden = false;
        this.turn.textContent = yourTurn ? 'Your turn' : "Opponent's turn";
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

    showEnd(text, statisticsId) {
        this.turn.hidden = true;
        this.end.hidden = false;
        this.endText.textContent = text;
        this.end.classList.add(text.startsWith('Victory') ? 'victory' : text.startsWith('Draw') ? 'draw' : 'defeat');
        if (statisticsId !== undefined && statisticsId !== null) {
            setTimeout(() => window.location.replace(`/Game/Stats/${encodeURIComponent(statisticsId)}`), 8000);
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
