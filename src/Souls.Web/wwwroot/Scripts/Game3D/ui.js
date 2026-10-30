// DOM interface of the 3D client, built from the shared in-game components (css/game-hud.css on css/theme.css):
// loading, main menu, matchmaking, mulligan, turn banners, toasts, status, hero power, turn fuse, battle log, tooltips,
// settings, chat, end screen, live games, spectator bar and replay transport. Server text is always inserted as text.
import { Images, sound } from './assets.js';
import { QUALITY_KEY, VIEWS } from './scene.js';

const SVG = 'http://www.w3.org/2000/svg';

const TIPS = [
    ['Armor', 'absorbs damage before health, on cards and heroes.'],
    ['Taunt', 'cards must be attacked before anything else.'],
    ['Charge', 'lets a card attack the turn it is played; the others arrive exhausted.'],
    ['Hero powers', 'cost 2 mana and can be used once per turn.'],
    ['Darkness', 'cards curse a random enemy for 2 when they die.'],
    ['Vampiric', 'cards heal your hero by the damage they deal.'],
    ['Haunt', 'brings a card back to your hand the first time it dies.'],
    ['Fatigue', 'hurts more with every draw once your deck is empty.'],
    ['The turn timer', 'ends your turn after 75 seconds. Three timeouts in a row lose the game.'],
    ['Ranked', 'games move your rating; practice games do not.'],
];

const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const DIVISIONS = ['III', 'II', 'I'];

/** Rank tier of a rating (same rules as Souls.Model.Ratings). */
export function tierOf(rating) {
    const rank = Math.max(1, 1 + Math.trunc((Number(rating) - 1000) / 50));
    const index = rank - 1;
    if (index >= TIER_NAMES.length * DIVISIONS.length) return { name: 'Champion', css: 'tier-champion' };
    const name = TIER_NAMES[Math.floor(index / 3)];
    return { name: `${name} ${DIVISIONS[index % 3]}`, css: `tier-${name.toLowerCase()}` };
}

const POWER_ICONS = { 1: 'flame', 2: 'droplet', 3: 'sparkles', 4: 'shield-plus', 5: 'skull', 6: 'heart-pulse', 7: 'shield', 8: 'castle' }; // by hero power id

function el(tag, className, parent, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
}

export function icon(name, className = 's-icon') {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', name === 'emblem' ? '/img/icons.svg#emblem' : `/img/icons.svg#i-${name}`);
    svg.appendChild(use);
    return svg;
}

function button(className, parent, label, iconName) {
    const b = el('button', className, parent);
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    if (label) b.append(label);
    return b;
}

function progress(parent, fraction, extra = '') {
    const bar = el('div', `s-progress ${extra}`.trim(), parent);
    bar.style.setProperty('--p', `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`);
    el('span', '', bar);
    return bar;
}

function rankBadge(parent, rating, { compact = false } = {}) {
    const tier = tierOf(rating);
    const badge = el('span', `s-rank ${tier.css}`, parent);
    badge.appendChild(icon('emblem', 's-emblem'));
    if (!compact) {
        const text = el('span', '', badge);
        el('span', 's-rank-name', text, tier.name);
        text.append(' ');
        el('span', 's-rank-rating s-num', text, String(rating));
    } else {
        badge.title = `${tier.name} · ${rating}`;
    }
    return badge;
}

const RARITIES = ['', 'common', 'rare', 'epic', 'legendary'];

/** A card face like the site's card tiles (.s-card in site.css, same layout as Views/Shared/_CardTile.cshtml). */
function cardFace(parent, d) {
    const card = el('div', `s-card card-container rarity-${RARITIES[Number(d.rarity)] || 'common'}`, parent);
    card.style.backgroundImage = `url(${JSON.stringify(String((d.race && d.race.cardUrl) || '/Content/Images/Card/Texture/card_error.png'))})`;
    el('div', 's-card-portrait card-portrait', card).style.backgroundImage = `url(${JSON.stringify(String(d.portrait ?? ''))})`;
    el('div', 's-card-cost', card, String(d.cost ?? ''));
    const name = String(d.name ?? '');
    el('div', `s-card-title${name.length > 14 ? ' xlong' : name.length > 10 ? ' long' : ''}`, card, name);
    if (Number(d.level) > 1) el('div', 's-card-stars', card, '★'.repeat(Number(d.level) - 1));
    el('span', 's-card-gem', card);
    if (d.ability) {
        el('div', 's-card-ability', card, String(d.ability.label || d.ability.name || ''));
        el('div', 's-card-rules', card, String(d.ability.text ?? ''));
    } else if (d.flavor) {
        el('div', 's-card-flavor', card, String(d.flavor));
    }
    if (d.kind === 'spell') {
        card.classList.add('spell');
        const plate = el('div', 's-card-spell', card);
        el('span', '', plate, 'Spell');
        el('span', '', plate, 'Spell');
    } else {
        el('div', 's-card-attack', card, String(d.attack ?? ''));
        el('div', 's-card-health', card, String(d.health ?? ''));
    }
    if (Number(d.armor) > 0) el('div', 's-card-armor', card, String(d.armor));
    return card;
}

function readNumber(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        const value = Number(raw);
        return raw !== null && Number.isFinite(value) ? value : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeValue(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
}

const clock = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Icon and class of a battle log line, from its wording. */
function classify(line) {
    if (/ wins against | play a draw/.test(line)) return ['trophy', 'end'];
    if (/ dies| has fallen/.test(line)) return ['skull', 'death'];
    if (/ attacks | burns |curse/.test(line)) return ['sword', 'attack'];
    if (/ heal| drains | blesses /.test(line)) return ['heart-pulse', 'heal'];
    if (/ gives the turn |ran out of time/.test(line)) return ['hourglass', 'turn'];
    if (/haunt/i.test(line)) return ['ghost', 'death'];
    if (/ plays | summons /.test(line)) return ['deck', ''];
    if (/ uses | paralyzes | hardens /.test(line)) return ['wand', ''];
    return ['flag', ''];
}

export class UI {
    constructor(root, config = {}) {
        this.config = config;
        this.root = el('div', 'sg-root souls3d-ui', root);
        this.difficulty = readNumber('souls.difficulty', 1);
        this.names = { me: null, foe: null };
        this.unread = 0;

        this.buildLoading();
        this.buildHud();
        this.buildChat();
        this.chat.hidden = true;
        this.buildLog();
        this.log.hidden = true;
        this.buildViews();
        this.buildSettings();
        this.buildEmotes();
        this.toasts = el('div', 'sg-toasts', this.root);
        this.toasts.setAttribute('aria-live', 'polite');
        this.tooltip = el('div', 'sg-tip s-tip', this.root);
        this.tooltip.hidden = true;
        this.tooltip.setAttribute('role', 'tooltip');
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (!this.settings.hidden) this.toggleSettings(false);
            if (!this.emotePanel.hidden) this.toggleEmotes(false);
        });
    }

    // ---- Loading, menu and matchmaking ---------------------------------------------------------------------------

    buildLoading() {
        this.overlay = el('div', 'sg-layer sg-shade souls3d-overlay', this.root);
        const box = el('div', 'sg-loading', this.overlay);
        const logo = el('img', 'sg-logo', box);
        logo.src = Images.logo;
        logo.alt = 'Souls';
        this.status = el('div', 'sg-loading-text', box, 'Loading');
        this.progress = progress(box, 0);
        this.tip = el('div', 'sg-loading-tip', box);
        this.nextTip();
        this.tipTimer = setInterval(() => this.nextTip(), 4500);
        this.loadingBox = box;
    }

    nextTip() {
        const [term, text] = TIPS[Math.floor(Math.random() * TIPS.length)];
        this.tip.replaceChildren();
        el('b', '', this.tip, term);
        this.tip.append(` ${text}`);
    }

    setProgress(p) {
        this.progress.style.setProperty('--p', `${Math.round(p * 100)}%`);
        this.status.textContent = `Loading · ${Math.round(p * 100)}%`;
    }

    menuButton(parent, iconName, title, subtitle, primary = false) {
        const b = el('button', `sg-menu-btn${primary ? ' primary' : ''}`, parent);
        b.type = 'button';
        el('span', 'sg-menu-icon', b).appendChild(icon(iconName));
        const label = el('span', 'sg-menu-label', b);
        el('b', '', label, title);
        el('small', '', label, subtitle);
        b.appendChild(icon('chevron-right'));
        return b;
    }

    questList(parent, quests, { animate = false } = {}) {
        const list = el('ul', 'sg-quest-list', parent);
        for (const q of quests || []) {
            const item = el('li', q.done ? 'done' : '', list);
            el('span', '', item, `${q.done ? '✔ ' : ''}${q.text}`);
            const chip = el('span', 's-chip s-chip-coin', item);
            chip.append(icon('coin'), String(q.reward));
            const fraction = q.target ? q.progress / q.target : 0;
            const bar = progress(item, animate ? 0 : fraction, q.done ? 's-progress-done' : '');
            if (animate) setTimeout(() => bar.style.setProperty('--p', `${Math.round(fraction * 100)}%`), 1300);
        }
        return list;
    }

    /** Resolves with {mode: 'practice' | 'normal' | 'friendly' | 'watch', difficulty}. */
    showMenu() {
        clearInterval(this.tipTimer);
        this.overlay.replaceChildren();
        const menu = el('div', 'sg-menu', this.overlay);
        const nav = el('nav', 'sg-menu-nav', menu);
        nav.setAttribute('aria-label', 'Game menu');
        const logo = el('img', 'sg-logo', nav);
        logo.src = Images.logo;
        logo.alt = 'Souls';
        const ranked = this.menuButton(nav, 'swords', 'Ranked', 'Fight a player of your rank', true);
        const practice = this.menuButton(nav, 'bot', 'Practice', 'Against the bot');
        const row = el('div', 'sg-menu-row', nav);
        el('span', 's-label', row, 'Bot');
        const seg = el('div', 's-seg', row);
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', 'Practice difficulty');
        this.difficultyButtons = ['Easy', 'Normal', 'Hard'].map((label, level) => {
            const b = button('', seg, label);
            b.setAttribute('role', 'radio');
            b.addEventListener('click', () => this.setDifficulty(level));
            return b;
        });
        this.setDifficulty(this.difficulty);
        const friendly = this.menuButton(nav, 'users', 'Friendly', 'Challenge a player by name, unranked');
        const watch = this.menuButton(nav, 'eye', 'Watch live', 'Take a seat in the stands');
        const small = el('div', 'sg-menu-small', nav);
        for (const [href, iconName, label] of [['/Deck', 'deck', 'Deck'], ['/Shop', 'shop', 'Shop'], ['/', 'home', 'Home']]) {
            const a = el('a', 's-btn s-btn-ghost s-btn-sm', small);
            a.href = href;
            a.append(icon(iconName), label);
        }

        const profile = this.config.profile;
        if (profile) {
            const side = el('aside', 'sg-menu-side', menu);
            const card = el('section', 's-panel', side);
            card.setAttribute('aria-label', 'Your champion');
            const p = el('div', 'sg-profile', card);
            const img = el('img', '', p);
            img.src = Images.heroPortrait(profile.type);
            img.alt = '';
            const who = el('div', '', p);
            el('h2', '', who, profile.name);
            rankBadge(who, profile.rating);
            const meta = el('div', 's-muted s-small', who);
            meta.append(`${profile.typeName} · `);
            const coins = el('span', 's-chip s-chip-coin', meta);
            coins.append(icon('coin'), String(profile.money));
            progress(p, profile.rankProgress ?? 0);
            if (profile.quests && profile.quests.length) {
                const quests = el('section', 's-panel', side);
                const head = el('div', 's-panel-head', quests);
                head.appendChild(icon('quest'));
                el('h3', '', head, 'Daily quests');
                this.questList(quests, profile.quests);
            }
        }

        this.overlay.hidden = false;
        ranked.focus({ preventScroll: true });
        return new Promise(resolve => {
            ranked.onclick = () => resolve({ mode: 'normal', difficulty: this.difficulty });
            practice.onclick = () => resolve({ mode: 'practice', difficulty: this.difficulty });
            friendly.onclick = () => resolve({ mode: 'friendly', difficulty: this.difficulty });
            watch.onclick = () => resolve({ mode: 'watch', difficulty: this.difficulty });
        });
    }

    setDifficulty(level) {
        this.difficulty = level;
        (this.difficultyButtons || []).forEach((b, i) => {
            b.classList.toggle('active', i === level);
            b.setAttribute('aria-checked', String(i === level));
        });
        writeValue('souls.difficulty', level);
    }

    /** The matchmaking / connecting screen. `mode` picks the icon and the subtitle. */
    showQueue(text, mode) {
        clearInterval(this.tipTimer);
        this.overlay.classList.remove('sg-fade-out');
        this.overlay.hidden = false;
        if (!this.queueBox) {
            this.overlay.replaceChildren();
            const box = el('div', 's-panel sg-queue', this.overlay);
            this.queueRings = el('div', 'sg-rings', box);
            this.queueTitle = el('h2', '', box);
            this.queueText = el('p', '', box);
            this.queueTime = el('div', 'sg-time', box, '0:00');
            this.queueChip = el('span', 's-chip', box);
            this.queueBack = button('s-btn s-btn-ghost s-btn-sm', box, 'Back to the menu', 'arrow-left');
            this.queueBack.addEventListener('click', () => { window.location.href = '/Game'; });
            this.queueBox = box;
            this.queueStarted = performance.now();
            this.queueTimer = setInterval(() => {
                this.queueTime.textContent = clock(performance.now() - this.queueStarted - 999);
            }, 500);
        }
        if (mode) {
            this.queueMode = mode;
            const iconName = { practice: 'bot', normal: 'swords', friendly: 'users' }[mode] || 'eye';
            this.queueRings.replaceChildren(icon(iconName));
            this.queueTitle.textContent = { normal: 'Finding an opponent', practice: 'Preparing the arena', friendly: 'Friendly challenge' }[mode] || 'Joining the stands';
            this.queueChip.replaceChildren();
            if (mode === 'normal' && this.config.profile) {
                this.queueChip.append(icon('crown'), `Ranked · ${tierOf(this.config.profile.rating).name} · ${this.config.profile.rating}`);
            } else if (mode === 'practice') {
                this.queueChip.append(icon('bot'), `Practice · ${['Easy', 'Normal', 'Hard'][this.difficulty] || 'Normal'}`);
            } else if (mode === 'friendly') {
                this.queueChip.append(icon('users'), 'Friendly · unranked');
            } else {
                this.queueChip.append(icon('eye'), 'Spectator');
            }
        }
        this.queueText.textContent = text;
    }

    setStatus(text) {
        if (this.queueText) this.queueText.textContent = text;
        else this.status.textContent = text;
    }

    /** "Prepare!" then fade the overlay out. */
    hideQueue() {
        clearInterval(this.queueTimer);
        if (this.queueTitle) this.queueTitle.textContent = 'Prepare!';
        this.overlay.classList.add('sg-fade-out');
        setTimeout(() => {
            this.overlay.hidden = true;
            this.overlay.classList.remove('sg-fade-out');
            this.overlay.replaceChildren();
            this.queueBox = null;
            this.challengeForm = null;
        }, 950);
    }

    // ---- Friendly challenges -------------------------------------------------------------------------------------

    /** Friendly mode in the queue box: challenge a player by name, or wait here to be challenged. */
    showFriendly({ onChallenge, onCancel }) {
        this.showQueue('', 'friendly');
        const form = el('form', 'sg-challenge', null);
        const input = el('input', 's-input', form);
        input.placeholder = 'Player name';
        input.maxLength = 64;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', 'Player to challenge');
        button('s-btn s-btn-primary s-btn-sm', form, 'Challenge', 'swords').type = 'submit';
        form.addEventListener('submit', e => {
            e.preventDefault();
            if (input.value.trim()) onChallenge(input.value.trim());
        });
        const withdraw = button('s-btn s-btn-ghost s-btn-sm', null, 'Withdraw challenge', 'close');
        withdraw.addEventListener('click', onCancel);
        this.queueBox.insertBefore(form, this.queueBack);
        this.queueBox.insertBefore(withdraw, this.queueBack);
        this.challengeForm = { form, input, withdraw };
        this.challengeIdle();
    }

    /** The challenge was sent: wait for the answer. */
    challengeWaiting(name) {
        if (!this.challengeForm) return;
        this.challengeForm.form.hidden = true;
        this.challengeForm.withdraw.hidden = false;
        this.queueText.textContent = `Waiting for ${name} to answer...`;
        this.queueStarted = performance.now();
    }

    /** Ready to challenge (again); `text` says what became of the last challenge. Outside friendly mode: a toast. */
    challengeIdle(text) {
        if (!this.challengeForm) {
            if (text) this.screenMessage(text);
            return;
        }
        this.challengeForm.form.hidden = false;
        this.challengeForm.withdraw.hidden = true;
        const name = this.config.profile ? this.config.profile.name : 'your name';
        this.queueText.textContent = text || `Challenge a player who has the game open, or wait here: others can challenge ${name}.`;
    }

    /** Someone challenges you: answer(true | false), or it expires. */
    showInvite(p, answer) {
        this.hideInvite();
        const card = el('section', 's-panel sg-invite', this.root);
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-label', 'Challenge');
        const head = el('div', 'sg-invite-head', card);
        const img = el('img', '', head);
        img.src = Images.heroPortrait(Number(p.type) || 0);
        img.alt = '';
        const who = el('div', '', head);
        el('b', '', who, `${p.name} challenges you!`);
        el('div', 's-muted s-small', who, `Friendly game · unranked${p.rating ? ` · ${p.rating}` : ''}`);
        const bar = progress(card, 1, 's-progress-ember');
        const actions = el('div', 'sg-invite-actions', card);
        const decline = button('s-btn s-btn-ghost s-btn-sm', actions, 'Decline', 'close');
        const accept = button('s-btn s-btn-primary s-btn-sm', actions, 'Accept', 'check');
        const total = Number(p.expiresIn) || 30000;
        const ends = performance.now() + total;
        const timer = setInterval(() => {
            const left = ends - performance.now();
            bar.style.setProperty('--p', `${Math.max(0, Math.round(left / total * 100))}%`);
            if (left <= 0) this.hideInvite();
        }, 250);
        const done = ok => {
            this.hideInvite();
            answer(ok);
        };
        accept.addEventListener('click', () => done(true));
        decline.addEventListener('click', () => done(false));
        this.invite = { card, timer };
        accept.focus({ preventScroll: true });
    }

    hideInvite() {
        if (!this.invite) return;
        clearInterval(this.invite.timer);
        this.invite.card.remove();
        this.invite = null;
    }

    // ---- HUD: status, power, fuse, banners, toasts ---------------------------------------------------------------

    buildHud() {
        this.playerStatus = el('div', 'sg-status souls3d-status', this.root);
        this.playerStatus.hidden = true;
        this.opponentStatus = el('div', 'sg-status souls3d-status', this.root);
        this.opponentStatus.hidden = true;

        this.power = el('button', 'sg-power', this.root);
        this.power.type = 'button';
        this.power.hidden = true;
        const orb = el('span', 'sg-power-orb', this.power);
        this.powerIcon = el('span', '', orb);
        this.powerCost = el('span', 'sg-power-cost', orb, '2');
        this.powerName = el('span', 'sg-power-name', this.power);
        this.power.addEventListener('click', e => {
            e.stopPropagation();
            if (!this.power.disabled && this.onPower) this.onPower();
        });
        this.power.addEventListener('mouseenter', () => { if (this.powerInfo) this.showTooltip(this.powerInfo, this.power.getBoundingClientRect()); });
        this.power.addEventListener('mouseleave', () => this.hideTooltip());

        this.timer = el('div', 'sg-fuse', this.root);
        this.timer.hidden = true;
        const track = el('div', 'sg-fuse-track', this.timer);
        this.timerBar = el('div', 'sg-fuse-fill', track);
        this.timerText = el('div', 'sg-fuse-text', this.timer);
        this.timerSeconds = '';
    }

    /** {mana, maxMana, deck, hand, fatigue} for one side; null hides it. */
    setStatus3d(side, info) {
        const box = side === 'player' ? this.playerStatus : this.opponentStatus;
        if (!info) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        const key = JSON.stringify(info);
        if (box.dataset.key === key) return;
        box.dataset.key = key;
        box.replaceChildren();
        if (side === 'player') {
            const mana = el('span', 'sg-mana', box);
            mana.title = 'Mana';
            const max = Math.max(0, Math.min(10, Number(info.maxMana) || 0));
            const now = Math.max(0, Math.min(max, Number(info.mana) || 0));
            for (let i = 0; i < Math.max(max, 1) && i < 10; i++) el('i', i < now ? 'full' : i < max ? 'spent' : '', mana);
            el('b', '', mana, `${now}/${max}`);
        }
        const deck = el('span', '', box);
        deck.title = 'Cards left in the deck';
        deck.append(icon('deck'), String(info.deck ?? 0));
        const hand = el('span', '', box);
        hand.title = 'Cards in hand';
        hand.append(icon('hand'), String(info.hand ?? 0));
        if (Number(info.fatigue) > 0 || Number(info.deck) === 0) {
            const fatigue = el('span', 'warn', box);
            fatigue.title = 'Fatigue: the deck is empty';
            fatigue.append(icon('skull'), `${(Number(info.fatigue) || 0) + 1}`);
        }
    }

    placeStatus(side, x, y) {
        const box = side === 'player' ? this.playerStatus : this.opponentStatus;
        box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    }

    /** {name, text, cost, canUse, used, type} or null to hide. */
    setPower(power) {
        if (!power) {
            this.power.hidden = true;
            return;
        }
        this.power.hidden = false;
        if (this.powerIcon.dataset.type !== String(power.type)) {
            this.powerIcon.dataset.type = String(power.type);
            this.powerIcon.replaceChildren(icon(POWER_ICONS[power.type] || 'zap'));
        }
        this.powerName.textContent = power.name;
        this.powerCost.textContent = String(power.cost);
        this.power.disabled = !power.canUse;
        this.power.classList.toggle('used', !!power.used);
        this.power.classList.toggle('ready', !!power.canUse);
        this.power.setAttribute('aria-label', `Hero power: ${power.name} (${power.cost} mana)`);
        this.powerInfo = {
            title: power.name,
            sub: `Hero power · ${power.cost} mana · once per turn`,
            blocks: [{ text: power.text }, power.used ? { kind: 'info', text: 'Already used this turn.' } : null],
        };
    }

    placePower(x, y) {
        this.power.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    }

    setPowerArmed(on) {
        this.power.classList.toggle('armed', on);
    }

    /** Shows the turn fuse counting down to `endsAt` (performance.now() time). */
    setTimer(endsAt, total, mine) {
        this.timerEndsAt = endsAt;
        this.timerTotal = Math.max(1, total);
        this.timerMine = !!mine;
        this.timer.hidden = false;
        this.timer.classList.toggle('enemy', !mine);
    }

    hideTimer() {
        this.timer.hidden = true;
        this.timerEndsAt = null;
    }

    /** Every frame: the fuse burns down; red and pulsing in the last 15 seconds. */
    updateTimer(now, x, y) {
        if (this.timerEndsAt === null || this.timerEndsAt === undefined) return;
        const left = Math.max(0, this.timerEndsAt - now);
        this.timerBar.style.width = `${(left / this.timerTotal) * 100}%`;
        const text = `${this.turnLabel || (this.timerMine ? 'Your turn' : 'Enemy turn')} · ${clock(left)}`;
        if (this.timerSeconds !== text) {
            this.timerSeconds = text;
            this.timerText.textContent = text;
        }
        this.timer.classList.toggle('urgent', left < 15000 && this.timerMine);
        if (x !== undefined) this.timer.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, 0)`;
    }

    /** The seconds left on the fuse (test hook). */
    get timerLeft() {
        return this.timerEndsAt ? Math.ceil(Math.max(0, this.timerEndsAt - performance.now()) / 1000) : null;
    }

    /** `label` names the player whose turn it is (spectators); otherwise "Your turn" / "Enemy turn". */
    setTurn(yourTurn, label) {
        this.turnLabel = label ? label : null;
        this.yourTurn = yourTurn;
    }

    /** The big centre banner when the turn changes. */
    banner(text, { enemy = false, sub = null } = {}) {
        if (this.currentBanner) this.currentBanner.remove();
        const b = el('div', `sg-banner${enemy ? ' enemy' : ''}`, this.root);
        b.setAttribute('aria-hidden', 'true');
        if (sub) el('small', '', b, sub);
        el('b', '', b, text);
        this.currentBanner = b;
        setTimeout(() => { if (b.isConnected) b.remove(); }, 2200);
    }

    /** A legendary card enters the arena: its name in gold across the screen. */
    legendary(name, enemy = null) {
        const b = el('div', `sg-legend${enemy ? ' enemy' : ''}`, this.root);
        b.setAttribute('aria-hidden', 'true');
        el('small', '', b, 'Legendary');
        el('b', '', b, name);
        setTimeout(() => { if (b.isConnected) b.remove(); }, 2600);
    }

    /** Short messages ("Not enough mana!"). */
    screenMessage(text, warn = true) {
        if (this.toasts.childElementCount >= 3) this.toasts.firstElementChild.remove();
        const toast = el('div', `sg-toast${warn ? ' warn' : ''}`, this.toasts);
        toast.append(icon(warn ? 'info' : 'sparkles'), String(text));
        setTimeout(() => toast.remove(), 2450);
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
            if (info.rating) {
                const meta = el('div', 'sg-versus-meta', box);
                rankBadge(meta, info.rating);
            }
            return box;
        };
        side(player, 'left');
        el('div', 'souls3d-versus-mark', splash, 'VS');
        side(opponent, 'right');
        setTimeout(() => splash.classList.add('leaving'), 3400);
        setTimeout(() => splash.remove(), 4100);
    }

    // ---- Mulligan ------------------------------------------------------------------------------------------------

    /** The starting hand as card faces: tap the ones to replace, then confirm (once) before the countdown ends. */
    showMulligan({ cards, endsAt, total, done, opponent, onConfirm }) {
        this.hideMulligan(false);
        const layer = el('div', 'sg-layer sg-shade sg-mulligan', this.root);
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', 'Mulligan');
        const box = el('div', 'sg-mulligan-box', layer);
        el('div', 's-eyebrow', box, 'Mulligan');
        el('h2', '', box, 'Your starting hand');
        el('p', '', box, 'Tap the cards you want to replace. You can do this once.');
        const row = el('div', 'sg-mulligan-cards', box);
        const timer = el('div', 'sg-mulligan-timer', box);
        const bar = progress(timer, 1, 's-progress-ember');
        const time = el('span', 'sg-time', timer);
        const confirm = button('s-btn s-btn-gold s-btn-lg sg-mulligan-confirm', box, 'Keep hand', 'check');
        const status = el('p', 'sg-mulligan-status s-muted', box);
        status.setAttribute('aria-live', 'polite');
        const m = this.mulligan = { layer, status, opponent, buttons: [], opponentDone: false };
        const lock = text => {
            m.locked = true;
            for (const b of m.buttons) b.disabled = true;
            confirm.disabled = true;
            status.textContent = text;
        };
        for (const card of cards) {
            const b = el('button', 'sg-mulligan-card', row);
            b.type = 'button';
            b.setAttribute('aria-pressed', 'false');
            cardFace(b, card);
            el('span', 'sg-mulligan-mark', b).append(icon('refresh'), 'Replace');
            b.addEventListener('click', () => {
                b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
                const n = m.buttons.filter(x => x.getAttribute('aria-pressed') === 'true').length;
                confirm.replaceChildren(icon(n ? 'refresh' : 'check'), n ? `Replace ${n} card${n > 1 ? 's' : ''}` : 'Keep hand');
            });
            b.cid = card.cid;
            m.buttons.push(b);
        }
        confirm.addEventListener('click', () => {
            lock(`Waiting for ${opponent}...`);
            onConfirm(m.buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.cid));
        });
        if (done) lock(`Waiting for ${opponent}...`);
        const tick = () => {
            const left = Math.max(0, endsAt - performance.now());
            bar.style.setProperty('--p', `${Math.round((left / Math.max(1, total)) * 100)}%`);
            time.textContent = clock(left);
            if (left > 0 || m.locked) return;
            for (const b of m.buttons) b.setAttribute('aria-pressed', 'false');
            lock('Time is up: you keep your hand.');
        };
        tick();
        m.timer = setInterval(tick, 250);
        if (!done) confirm.focus({ preventScroll: true });
    }

    /** A mulligan was made: ours shows the new cards in place of the replaced ones, the opponent's how many. */
    mulliganChosen(mine, hand, replaced) {
        const m = this.mulligan;
        if (!m) return;
        if (!mine) {
            m.opponentDone = true;
            m.status.textContent = replaced ? `${m.opponent} replaced ${replaced} card${replaced > 1 ? 's' : ''}.` : `${m.opponent} kept their hand.`;
            return;
        }
        hand.forEach((card, i) => {
            const b = m.buttons[i];
            if (!b) return;
            const isNew = replaced > 0 && b.getAttribute('aria-pressed') === 'true';
            b.disabled = true;
            b.setAttribute('aria-pressed', 'false');
            b.classList.toggle('new', isNew);
            b.replaceChildren();
            cardFace(b, card);
            el('span', 'sg-mulligan-mark', b).append(icon(isNew ? 'sparkles' : 'check'), isNew ? 'New' : 'Kept');
        });
        m.locked = true;
        m.status.textContent = m.opponentDone ? 'The battle begins!' : `Waiting for ${m.opponent}...`;
    }

    hideMulligan(fade = true) {
        const m = this.mulligan;
        if (!m) return;
        this.mulligan = null;
        clearInterval(m.timer);
        if (!fade) {
            m.layer.remove();
            return;
        }
        m.layer.classList.add('sg-fade-out');
        setTimeout(() => m.layer.remove(), 950);
    }

    // ---- Tooltips ------------------------------------------------------------------------------------------------

    /**
     * {title, sub, stats: {cost, attack, health, maxHealth, armor}, blocks: [{kind: ''|'race'|'warn'|'info', label, text}]}
     * next to a screen point or rectangle.
     */
    showTooltip(info, at) {
        if (!info) {
            this.hideTooltip();
            return;
        }
        const t = this.tooltip;
        t.replaceChildren();
        t.dataset.rarity = info.rarity || '';
        el('div', 's-tip-title', t, info.title);
        if (info.sub) el('div', 'sg-tip-sub', t, info.sub);
        if (info.stats) {
            const stats = el('div', 'sg-tip-stats', t);
            const add = (cls, iconName, value, label) => {
                if (value === undefined || value === null || value === '') return;
                const s = el('span', cls, stats);
                s.title = label;
                s.append(icon(iconName), String(value));
            };
            add('cost', 'gem', info.stats.cost, 'Cost');
            add('atk', 'sword', info.stats.attack, 'Attack');
            add('hp', 'heart', info.stats.maxHealth && Number(info.stats.health) < Number(info.stats.maxHealth) ? `${info.stats.health}/${info.stats.maxHealth}` : info.stats.health, 'Health');
            if (Number(info.stats.armor) > 0) add('arm', 'shield', info.stats.armor, 'Armor');
        }
        for (const block of info.blocks || []) {
            if (!block || !block.text) continue;
            const b = el('div', `sg-tip-block${block.kind ? ' ' + block.kind : ''}`, t);
            if (block.label) el('b', '', b, block.label);
            b.append(block.text);
        }
        for (const line of info.lines || []) {
            if (line) el('div', 'sg-tip-block', t, line);
        }
        t.hidden = false;
        const box = t.getBoundingClientRect();
        const host = this.root.getBoundingClientRect();
        let x, y;
        if (at && at.width !== undefined) {
            x = at.right - host.left + 12;
            y = at.top - host.top - box.height / 2 + at.height / 2;
        } else {
            x = (at ? at.x : 0) + 18;
            y = (at ? at.y : 0) + 18;
        }
        if (x + box.width > host.width - 8) x = Math.max(8, (at && at.width !== undefined ? at.left - host.left : x - 36) - box.width - 12);
        y = Math.max(8, Math.min(y, host.height - box.height - 8));
        t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    hideTooltip() {
        this.tooltip.hidden = true;
    }

    // ---- Battle log ----------------------------------------------------------------------------------------------

    buildLog() {
        const log = el('section', 'sg-log souls3d-log', this.root);
        log.setAttribute('aria-label', 'Battle log');
        const head = button('sg-log-head', log, 'Battle log', 'list');
        this.logBadge = el('span', 'sg-log-badge', head);
        head.appendChild(icon('chevron-down', 's-icon sg-chevron'));
        head.addEventListener('click', () => {
            log.classList.toggle('collapsed');
            this.unread = 0;
            this.logBadge.textContent = '';
            writeValue('souls.logCollapsed', log.classList.contains('collapsed') ? 1 : 0);
        });
        this.logList = el('ol', 'sg-log-list', log);
        this.logList.setAttribute('aria-live', 'polite');
        const small = window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 560px)').matches;
        if (readNumber('souls.logCollapsed', small ? 1 : 0)) log.classList.add('collapsed');
        this.log = log;
    }

    /** Names highlighted in the log: yours in blue, the opponent's in red. */
    setNames(me, foe) {
        this.names = { me, foe };
    }

    logLine(text) {
        const line = String(text);
        const [iconName, cls] = classify(line);
        const item = el('li', cls, this.logList);
        item.appendChild(icon(iconName));
        const span = el('span', '', item);
        const names = [[this.names.me, 'me'], [this.names.foe, 'foe']].filter(([n]) => n && n.length > 1);
        let rest = line;
        while (rest.length) {
            let best = null;
            for (const [name, css] of names) {
                const i = rest.indexOf(name);
                if (i >= 0 && (!best || i < best.i)) best = { i, name, css };
            }
            if (!best) {
                span.append(rest);
                break;
            }
            span.append(rest.slice(0, best.i));
            el('span', best.css, span, best.name);
            rest = rest.slice(best.i + best.name.length);
        }
        while (this.logList.childElementCount > 200) this.logList.firstElementChild.remove();
        this.logList.scrollTop = this.logList.scrollHeight;
        if (this.log.classList.contains('collapsed')) {
            this.unread++;
            this.logBadge.textContent = String(this.unread);
        }
    }

    logLines() {
        return [...this.logList.children].map(li => li.textContent);
    }

    // ---- Views and settings --------------------------------------------------------------------------------------

    /** Camera views (keys 1-4), the settings button and a hint. */
    buildViews() {
        const bar = el('div', 'sg-views souls3d-views', this.root);
        bar.hidden = true;
        this.settingsButton = button('sg-icon-btn', bar, null, 'settings');
        this.settingsButton.setAttribute('aria-label', 'Settings');
        this.settingsButton.setAttribute('aria-expanded', 'false');
        this.settingsButton.addEventListener('click', () => this.toggleSettings());
        const seg = el('div', 's-seg', bar);
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Camera');
        this.viewButtons = {};
        for (const [name, view] of Object.entries(VIEWS)) {
            if (!view.key) continue;
            const b = button('', seg);
            el('kbd', '', b, view.key);
            b.append(view.label);
            b.addEventListener('click', () => { if (this.onView) this.onView(name); });
            this.viewButtons[name] = b;
        }
        const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        el('span', 'souls3d-views-hint', bar, touch
            ? 'Pinch: zoom · Drag the arena: rotate · Hold a card: ability'
            : 'Wheel: zoom · Right-drag: rotate');
        this.views = bar;
    }

    buildSettings() {
        const panel = el('section', 's-panel sg-settings souls3d-settings', this.root);
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Settings');
        const head = el('div', 's-panel-head', panel);
        head.appendChild(icon('settings'));
        el('h3', '', head, 'Settings');
        const close = button('sg-icon-btn', head, null, 'close');
        close.setAttribute('aria-label', 'Close settings');
        close.style.width = close.style.height = '32px';
        close.addEventListener('click', () => this.toggleSettings(false));

        const row = (label) => {
            const r = el('div', 'sg-setting', panel);
            el('span', '', r, label);
            const seg = el('div', 's-seg', r);
            return seg;
        };

        const soundSeg = row('Sound');
        this.soundButtons = [['On', false], ['Off', true]].map(([label, muted]) => {
            const b = button('', soundSeg, label, muted ? 'mute' : 'volume');
            b.addEventListener('click', () => {
                if (sound.muted !== muted) sound.toggle();
                this.updateSound();
            });
            b.dataset.muted = String(muted);
            return b;
        });
        this.updateSound();

        const qualitySeg = row('Graphics');
        const current = new URLSearchParams(location.search).get('fx') || 'auto';
        for (const q of ['auto', 'low', 'medium', 'high']) {
            const b = button(current === q ? 'active' : '', qualitySeg, q[0].toUpperCase() + q.slice(1));
            b.setAttribute('aria-pressed', String(current === q));
            b.addEventListener('click', () => {
                const url = new URL(location.href);
                if (q === 'auto') {
                    url.searchParams.delete('fx');
                    // Let the frame-rate watch start from the detected level again.
                    try { localStorage.removeItem(QUALITY_KEY); } catch (e) { /* storage blocked */ }
                } else url.searchParams.set('fx', q);
                location.href = url.toString();
            });
        }

        this.leaveButton = button('s-btn s-btn-danger s-btn-sm', panel, 'Leave game', 'logout');
        this.leaveButton.addEventListener('click', () => {
            if (this.onLeave) this.onLeave();
            else window.location.href = '/Game';
        });
        this.settings = panel;
    }

    toggleSettings(open = this.settings.hidden) {
        this.settings.hidden = !open;
        this.settingsButton.setAttribute('aria-expanded', String(open));
        if (open) this.toggleEmotes(false);
    }

    // ---- Emotes --------------------------------------------------------------------------------------------------

    /** The emote button (next to the settings) opens the emotes and the switch that mutes the opponent's. */
    buildEmotes() {
        this.emoteButton = button('sg-icon-btn', null, null, 'smile');
        this.emoteButton.setAttribute('aria-label', 'Emotes');
        this.emoteButton.setAttribute('aria-expanded', 'false');
        this.emoteButton.addEventListener('click', () => this.toggleEmotes());
        this.settingsButton.after(this.emoteButton);
        const panel = el('section', 's-panel sg-emotes souls3d-emotes', this.root);
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Emotes');
        ((this.config.rules && this.config.rules.emotes) || []).forEach((text, i) => {
            button('s-btn s-btn-ghost s-btn-sm', panel, text).addEventListener('click', () => {
                this.toggleEmotes(false);
                if (this.onEmote) this.onEmote(i);
            });
        });
        this.muteButton = button('s-btn s-btn-ghost s-btn-sm', panel, 'Mute opponent', 'mute');
        this.muteButton.setAttribute('aria-pressed', 'false');
        this.muteButton.addEventListener('click', () => {
            const muted = this.muteButton.getAttribute('aria-pressed') !== 'true';
            this.muteButton.setAttribute('aria-pressed', String(muted));
            this.muteButton.replaceChildren(icon(muted ? 'volume' : 'mute'), muted ? 'Unmute opponent' : 'Mute opponent');
            if (this.onMuteEmotes) this.onMuteEmotes(muted);
        });
        this.emotePanel = panel;
        this.bubbles = {};
    }

    toggleEmotes(open = this.emotePanel.hidden) {
        this.emotePanel.hidden = !open;
        this.emoteButton.setAttribute('aria-expanded', String(open));
        if (open) this.toggleSettings(false);
    }

    /** A speech bubble by a hero ('player' or 'opponent') for a few seconds; placeEmote moves it every frame. */
    emote(side, text) {
        if (this.bubbles[side]) this.bubbles[side].remove();
        const bubble = el('div', `sg-bubble ${side === 'player' ? 'mine' : 'theirs'}`, this.root, text);
        bubble.setAttribute('role', 'status');
        this.bubbles[side] = bubble;
        setTimeout(() => {
            bubble.remove();
            if (this.bubbles[side] === bubble) delete this.bubbles[side];
        }, 2800);
    }

    /** The player's bubble stands above (x, y), the opponent's hangs below it. */
    placeEmote(side, x, y) {
        const bubble = this.bubbles[side];
        if (bubble) bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${side === 'player' ? '-100%' : '0'})`;
    }

    updateSound() {
        for (const b of this.soundButtons) {
            const active = String(sound.muted) === b.dataset.muted;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        }
    }

    /** Shows the in-game controls (camera views, chat and battle log; chat and emotes are for players). */
    showViews(visible, { chat = true } = {}) {
        this.views.hidden = !visible;
        this.chat.hidden = !visible || !chat;
        this.emoteButton.hidden = !chat;
        this.log.hidden = !visible;
    }

    setView(name) {
        for (const [key, b] of Object.entries(this.viewButtons)) {
            b.classList.toggle('active', key === name);
            b.setAttribute('aria-pressed', String(key === name));
        }
    }

    // ---- End of the game -----------------------------------------------------------------------------------------

    /**
     * The end screen: the result, coins and rating earned (counting up), daily quest progress, and links to the
     * statistics and the replay. Players are taken to the statistics after a while (spectators stay).
     */
    showEnd(text, result = {}, { redirect = true, detail, friendly = false } = {}) {
        this.hideTimer();
        this.setPower(null);
        this.setStatus3d('player', null);
        this.setStatus3d('opponent', null);
        this.toggleSettings(false);
        const kind = /^Victory/.test(text) ? 'victory' : /^Draw/.test(text) ? 'draw' : /wins!$/.test(text) ? 'victory' : 'defeat';
        const layer = el('div', 'sg-layer sg-shade souls3d-end', this.root);
        layer.style.animation = 's-fade-in 1.2s ease-out both';
        const end = el('div', `sg-end ${kind}`, layer);
        el('h1', 'sg-end-title', end, text.replace(/!$/, ''));
        if (result.text || detail) el('div', 'sg-end-sub', end, detail || result.text);

        const rewards = el('div', 'sg-rewards', end);
        if (typeof result.coins === 'number') {
            const r = el('div', 's-panel sg-reward', rewards);
            r.appendChild(icon('coin'));
            const value = el('b', '', r, '+0');
            el('span', '', r, 'Soul coins');
            this.countUp(value, result.coins, '+', 900);
        }
        if (typeof result.ratingChange === 'number') {
            const up = result.ratingChange >= 0;
            const r = el('div', `s-panel sg-reward ${up ? 'up' : 'down'}`, rewards);
            r.appendChild(icon('crown'));
            const value = el('b', '', r, up ? '+0' : '-0');
            el('span', '', r, `${tierOf(result.rating).name} · ${result.rating}`);
            const into = result.rating < 1000 ? 0 : ((result.rating - 1000) % 50) / 50;
            const bar = progress(r, 0);
            setTimeout(() => bar.style.setProperty('--p', `${Math.round(into * 100)}%`), 1100);
            this.countUp(value, Math.abs(result.ratingChange), up ? '+' : '-', 1000);
        } else if (typeof result.coins === 'number') {
            const r = el('div', 's-panel sg-reward', rewards);
            r.appendChild(icon(friendly ? 'users' : 'bot'));
            el('b', '', r, '–');
            el('span', '', r, friendly ? 'Friendly · unranked' : 'Practice · unrated');
        }
        if (!rewards.childElementCount) rewards.remove();

        if (Array.isArray(result.quests) && result.quests.length) {
            const quests = el('section', 's-panel sg-end-quests', end);
            const head = el('div', 's-panel-head', quests);
            head.appendChild(icon('quest'));
            el('h3', '', head, 'Daily quests');
            this.questList(quests, result.quests, { animate: true });
        }

        const actions = el('div', 'sg-end-actions', end);
        const statisticsId = result.statistics;
        if (statisticsId) {
            const stats = el('a', 's-btn s-btn-gold', actions);
            stats.href = `/Game/Stats/${encodeURIComponent(statisticsId)}`;
            stats.append(icon('list'), 'Statistics');
            const replay = el('a', 's-btn s-btn-ghost', actions);
            replay.href = `/Game/Replay/${encodeURIComponent(statisticsId)}`;
            replay.append(icon('play'), 'Watch replay');
        }
        const again = el('a', 's-btn s-btn-primary', actions);
        again.href = '/Game';
        again.append(icon(redirect ? 'swords' : 'arrow-left'), redirect ? 'Play again' : 'Back to the menu');

        if (statisticsId && redirect) {
            const note = el('div', 'sg-end-redirect', end);
            let left = 20;
            note.textContent = `Statistics in ${left} s`;
            const t = setInterval(() => {
                left--;
                note.textContent = `Statistics in ${left} s`;
                if (left <= 0) {
                    clearInterval(t);
                    window.location.replace(`/Game/Stats/${encodeURIComponent(statisticsId)}`);
                }
            }, 1000);
        }
        this.endLayer = layer;
    }

    countUp(element, target, prefix, delay) {
        const start = performance.now() + delay;
        const step = now => {
            const t = Math.min(1, Math.max(0, (now - start) / 900));
            element.textContent = `${prefix}${Math.round(target * (1 - Math.pow(1 - t, 3)))}`;
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        setTimeout(() => { element.textContent = `${prefix}${target}`; }, delay + 1200);
    }

    // ---- Spectating and replays ----------------------------------------------------------------------------------

    /** The list of running games; resolves with the picked game id, or null to go back. */
    showLiveGames(games, onRefresh) {
        clearInterval(this.queueTimer);
        this.queueBox = null;
        this.overlay.hidden = false;
        this.overlay.classList.remove('sg-fade-out');
        this.overlay.replaceChildren();
        const panel = el('section', 's-panel sg-games souls3d-live', this.overlay);
        const head = el('div', 's-panel-head', panel);
        head.appendChild(icon('eye'));
        el('h2', '', head, 'Live games');
        el('span', 'sg-live', head, 'LIVE');
        return new Promise(resolve => {
            const done = value => resolve(value);
            if (games.length === 0) {
                const empty = el('div', 'sg-empty', panel);
                empty.appendChild(icon('hourglass', 's-icon s-icon-lg'));
                el('p', '', empty, 'Nobody is playing right now. Check back in a moment.');
            }
            const list = el('ul', '', panel);
            for (const g of games) {
                const item = el('li', 'sg-game', list);
                const [a, b] = g.players || [];
                const portraits = el('span', 'sg-game-portraits', item);
                for (const p of [a, b]) {
                    if (!p) continue;
                    const img = el('img', '', portraits);
                    img.src = Images.heroPortrait(Number(p.type) || 0);
                    img.alt = '';
                }
                const text = el('span', '', item);
                const name = p => `${p.name}${p.rating ? ` (${p.rating})` : ''}`;
                el('div', 'sg-game-names', text, a && b ? `${name(a)} vs ${name(b)}` : `Game ${g.gameId}`);
                const kind = !g.practice ? 'Ranked' : (g.players || []).some(p => p.bot) ? 'Practice' : 'Friendly';
                el('div', 'sg-game-meta', text, `${kind} · turn ${(g.turn ?? 0) + 1} · ${g.spectators ?? 0} watching`);
                const watch = button('s-btn s-btn-primary s-btn-sm', item, 'Watch', 'eye');
                watch.addEventListener('click', () => done(g.gameId));
            }
            const actions = el('div', 'd-flex gap-2 justify-content-end mt-3', panel);
            const back = button('s-btn s-btn-ghost s-btn-sm', actions, 'Back', 'arrow-left');
            back.addEventListener('click', () => done(null));
            const refresh = button('s-btn s-btn-gold s-btn-sm', actions, 'Refresh', 'refresh');
            refresh.addEventListener('click', () => { done(undefined); onRefresh(); });
        });
    }

    /** The bar while watching someone else's game (or a replay). */
    showSpectating(text, onLeave, { replay = false } = {}) {
        if (!this.banner3d) {
            this.banner3d = el('div', 'sg-watching souls3d-banner', this.root);
            this.bannerBadge = el('span', 'sg-live', this.banner3d);
            this.bannerText = el('span', 'sg-watching-text', this.banner3d);
            this.bannerLeave = button('s-btn s-btn-ghost s-btn-sm', this.banner3d, 'Leave', 'logout');
        }
        this.bannerBadge.textContent = replay ? 'REPLAY' : 'LIVE';
        this.bannerBadge.classList.toggle('replay', replay);
        this.bannerText.textContent = text;
        this.bannerLeave.onclick = onLeave;
        this.banner3d.hidden = false;
        this.onLeave = onLeave;
        this.leaveButton.lastChild.textContent = replay ? 'Close replay' : 'Stop watching';
    }

    /** Play/pause, speed and restart for replays. */
    showReplay({ onToggle, onSpeed, onRestart }) {
        const bar = el('div', 's-panel sg-transport souls3d-replay', this.root);
        const toggle = button('sg-icon-btn', bar, null, 'pause');
        toggle.setAttribute('aria-label', 'Pause');
        toggle.addEventListener('click', () => {
            const playing = onToggle();
            toggle.replaceChildren(icon(playing ? 'pause' : 'play'));
            toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        });
        const seg = el('div', 's-seg', bar);
        seg.setAttribute('aria-label', 'Speed');
        for (const speed of [1, 2, 4]) {
            const b = button(speed === 1 ? 'active' : '', seg, `${speed}x`);
            b.addEventListener('click', () => {
                onSpeed(speed);
                seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            });
        }
        this.replayProgress = progress(bar, 0, 's-progress-ember');
        const restart = button('sg-icon-btn', bar, null, 'skip-back');
        restart.setAttribute('aria-label', 'Restart');
        restart.addEventListener('click', onRestart);
    }

    setReplayProgress(fraction) {
        if (this.replayProgress) this.replayProgress.style.setProperty('--p', `${Math.round(Math.min(1, fraction) * 100)}%`);
    }

    // ---- Chat ----------------------------------------------------------------------------------------------------

    buildChat() {
        const chat = el('section', 'souls3d-chat collapsed', this.root);
        chat.setAttribute('aria-label', 'Chat');
        const header = button('souls3d-chat-header', chat, 'Chat', 'chat');
        this.chatBadge = el('span', 'souls3d-chat-badge', header);
        header.addEventListener('click', () => {
            chat.classList.toggle('collapsed');
            this.chatBadge.textContent = '';
            if (!chat.classList.contains('collapsed')) this.chatInput.focus();
        });
        const body = el('div', 'souls3d-chat-body', chat);
        this.chatLog = el('div', 'souls3d-chat-log chat-messages', body);
        this.chatMembers = el('div', 'souls3d-chat-members chat-clients', body);
        this.chatInput = el('textarea', 'souls3d-chat-input chat-input', chat);
        this.chatInput.placeholder = 'Say something...';
        this.chatInput.rows = 1;
        this.chatInput.maxLength = 500;
        this.chatInput.setAttribute('aria-label', 'Chat message');
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
