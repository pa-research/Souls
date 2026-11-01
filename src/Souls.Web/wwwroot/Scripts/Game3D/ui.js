// DOM interface of the 3D client, built from the shared in-game components (css/game-hud.css on css/theme.css):
// loading, main menu, matchmaking, mulligan, turn banners, toasts, status, hero power, turn fuse, battle log, tooltips,
// settings, chat, end screen, live games, spectator bar and replay transport. Server text is always inserted as text.
import { Images, sound } from './assets.js';
import { QUALITY_KEY, VIEWS } from './scene.js';

const SVG = 'http://www.w3.org/2000/svg';
// Texts in the page's language (/js/l10n.js); serverText shows a text the server sent (its key and arguments).
const { t, text: serverText } = window.SoulsL10n;

const TIPS = [
    [t('g3d.loadingTip.armor'), t('g3d.loadingTip.armorText')],
    [t('g3d.loadingTip.taunt'), t('g3d.loadingTip.tauntText')],
    [t('g3d.loadingTip.charge'), t('g3d.loadingTip.chargeText')],
    [t('g3d.loadingTip.heroPowers'), t('g3d.loadingTip.heroPowersText')],
    [t('g3d.loadingTip.darkness'), t('g3d.loadingTip.darknessText')],
    [t('g3d.loadingTip.vampiric'), t('g3d.loadingTip.vampiricText')],
    [t('g3d.loadingTip.haunt'), t('g3d.loadingTip.hauntText')],
    [t('g3d.loadingTip.fatigue'), t('g3d.loadingTip.fatigueText')],
    [t('g3d.loadingTip.timer'), t('g3d.loadingTip.timerText')],
    [t('g3d.loadingTip.ranked'), t('g3d.loadingTip.rankedText')],
];

const DIFFICULTIES = [t('g3d.difficulty.easy'), t('g3d.difficulty.normal'), t('g3d.difficulty.hard')];
// Tooltip stat names (showTooltip has its own `t`, the tooltip element).
const STATS = { cost: t('g3d.stat.cost'), attack: t('g3d.stat.attack'), health: t('g3d.stat.health'), armor: t('g3d.stat.armor') };
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const DIVISIONS = ['III', 'II', 'I'];

/** Rank tier of a rating (same rules as Souls.Model.Ratings). */
export function tierOf(rating) {
    const rank = Math.max(1, 1 + Math.trunc((Number(rating) - 1000) / 50));
    const index = rank - 1;
    if (index >= TIERS.length * DIVISIONS.length) return { name: t('tier.champion'), css: 'tier-champion' };
    const tier = TIERS[Math.floor(index / 3)];
    return { name: t('tier.division', { tier: { key: `tier.${tier}` }, division: DIVISIONS[index % 3] }), css: `tier-${tier}` };
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

/** The rank emblem (theme.css); `tier` ({name, css}) when the server names it, else from the rating. */
function rankBadge(parent, rating, { compact = false, tier = tierOf(rating) } = {}) {
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
        el('div', 's-card-ability', card, serverText(d.ability, 'label') || serverText(d.ability, 'name'));
        el('div', 's-card-rules', card, serverText(d.ability));
    } else if (d.flavor) {
        el('div', 's-card-flavor', card, serverText(d, 'flavor'));
    }
    if (d.kind === 'spell') {
        card.classList.add('spell');
        const plate = el('div', 's-card-spell', card);
        el('span', '', plate, t('g3d.card.spell'));
        el('span', '', plate, t('g3d.card.spell'));
    } else {
        el('div', 's-card-attack', card, String(d.attack ?? ''));
        el('div', 's-card-health', card, String(d.health ?? ''));
    }
    if (Number(d.armor) > 0) el('div', 's-card-armor', card, String(d.armor));
    return card;
}

// The pointer the player uses: the last one pressed (touch or pen, or a mouse), before that the device's main one.
let lastPointer = null;
window.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);

/** Whether hints should speak of taps (touch) rather than clicks (mouse). */
export function touchInput() {
    return lastPointer ? lastPointer !== 'mouse' : !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
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

// Icon and class of a battle log line by its text key (log.* in Souls.Model/Localization/game.*.json); other keys: a flag.
const LOG_KINDS = {
    'log.win': ['trophy', 'end'], 'log.draw': ['trophy', 'end'],
    'log.dies': ['skull', 'death'], 'log.heroFallen': ['skull', 'death'],
    'log.attack': ['sword', 'attack'], 'log.burn': ['sword', 'attack'], 'log.deathCurse': ['sword', 'attack'],
    'log.heal': ['heart-pulse', 'heal'], 'log.drain': ['heart-pulse', 'heal'], 'log.lifesteal': ['heart-pulse', 'heal'],
    'log.blessing': ['heart-pulse', 'heal'], 'log.regenerate': ['heart-pulse', 'heal'], 'log.sacrifice': ['heart-pulse', 'heal'],
    'log.turn': ['hourglass', 'turn'], 'log.timeout': ['hourglass', 'turn'],
    'log.haunt': ['ghost', 'death'],
    'log.plays': ['deck', ''], 'log.summon': ['deck', ''],
    'log.heroPower': ['wand', ''], 'log.paralyze': ['wand', ''], 'log.harden': ['wand', ''],
};

/** Icon and class of a battle log line: by its key, or from its (English) wording in replays recorded without keys. */
function classify(line, key) {
    if (key) return LOG_KINDS[key] || ['flag', ''];
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

/** How long the VS splash stays up (it fades out over its last 700 ms); the mulligan opens after it. */
export const VERSUS_MS = 4100;
/** A full-screen layer (queue, mulligan) fading out: .sg-fade-out in game-hud.css. Centre texts wait for it. */
const FADE_MS = 900;
/** How long the turn banner and the legendary name stay (their animations in game-hud.css), and a toast. */
const BANNER_MS = 2200;
const LEGEND_MS = 2600;
const TOAST_MS = 2450;

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
        // A click on any button of the interface.
        this.root.addEventListener('click', e => {
            if (e.target.closest && e.target.closest('button, a[href]')) sound.play('ui_click', 0.5);
        });
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
        this.status = el('div', 'sg-loading-text', box, t('g3d.loading'));
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
        this.status.textContent = t('g3d.loadingProgress', { percent: Math.round(p * 100) });
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
            el('span', '', item, `${q.done ? '✔ ' : ''}${serverText(q)}`);
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
        nav.setAttribute('aria-label', t('g3d.menu.label'));
        const logo = el('img', 'sg-logo', nav);
        logo.src = Images.logo;
        logo.alt = 'Souls';
        const ranked = this.menuButton(nav, 'swords', t('g3d.mode.ranked'), t('g3d.menu.rankedSub'), true);
        const practice = this.menuButton(nav, 'bot', t('g3d.mode.practice'), t('g3d.menu.practiceSub'));
        const row = el('div', 'sg-menu-row', nav);
        el('span', 's-label', row, t('g3d.menu.bot'));
        const seg = el('div', 's-seg', row);
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', t('g3d.menu.difficulty'));
        this.difficultyButtons = DIFFICULTIES.map((label, level) => {
            const b = button('', seg, label);
            b.setAttribute('role', 'radio');
            b.addEventListener('click', () => this.setDifficulty(level));
            return b;
        });
        this.setDifficulty(this.difficulty);
        const friendly = this.menuButton(nav, 'users', t('g3d.mode.friendly'), t('g3d.menu.friendlySub'));
        const watch = this.menuButton(nav, 'eye', t('g3d.menu.watch'), t('g3d.menu.watchSub'));
        const small = el('div', 'sg-menu-small', nav);
        for (const [href, iconName, label] of [['/Deck', 'deck', t('g3d.menu.deck')], ['/Shop', 'shop', t('g3d.menu.shop')], ['/', 'home', t('mode.home')]]) {
            const a = el('a', 's-btn s-btn-ghost s-btn-sm', small);
            a.href = href;
            a.append(icon(iconName), label);
        }

        const profile = this.config.profile;
        if (profile) {
            const side = el('aside', 'sg-menu-side', menu);
            const card = el('section', 's-panel', side);
            card.setAttribute('aria-label', t('g3d.menu.champion'));
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
                el('h3', '', head, t('g3d.dailyQuests'));
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
            this.queueBack = button('s-btn s-btn-ghost s-btn-sm', box, t('g3d.backToMenu'), 'arrow-left');
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
            this.queueTitle.textContent = { normal: t('g3d.queue.normal'), practice: t('g3d.queue.practice'), friendly: t('g3d.queue.friendly') }[mode] || t('g3d.queue.watch');
            this.queueChip.replaceChildren();
            if (mode === 'normal' && this.config.profile) {
                const rating = this.config.profile.rating;
                this.queueChip.append(icon('crown'), t('g3d.queue.rankedChip', { tier: tierOf(rating).name, rating }));
            } else if (mode === 'practice') {
                this.queueChip.append(icon('bot'), t('g3d.queue.practiceChip', { difficulty: DIFFICULTIES[this.difficulty] || DIFFICULTIES[1] }));
            } else if (mode === 'friendly') {
                this.queueChip.append(icon('users'), t('g3d.queue.friendlyChip'));
            } else {
                this.queueChip.append(icon('eye'), t('g3d.queue.spectatorChip'));
            }
        }
        this.queueText.textContent = text;
    }

    setStatus(text) {
        if (this.queueText) this.queueText.textContent = text;
        else this.status.textContent = text;
    }

    /** "Prepare!" then fade the overlay out (`fade` false: at once, when the VS splash takes its place). */
    hideQueue(fade = true) {
        clearInterval(this.queueTimer);
        if (this.queueTitle) this.queueTitle.textContent = t('g3d.queue.prepare');
        if (this.challengeForm) {
            // A challenge was accepted: no more challenging.
            this.challengeForm.form.hidden = this.challengeForm.withdraw.hidden = true;
            this.queueText.textContent = '';
        }
        const done = () => {
            this.overlay.hidden = true;
            this.overlay.classList.remove('sg-fade-out');
            this.overlay.replaceChildren();
            this.queueBox = null;
            this.challengeForm = null;
        };
        if (!fade) {
            done();
            return;
        }
        this.overlay.classList.add('sg-fade-out');
        this.fadingUntil = performance.now() + FADE_MS;
        setTimeout(done, FADE_MS);
    }

    // ---- Friendly challenges -------------------------------------------------------------------------------------

    /** Friendly mode in the queue box: challenge a player by name, or wait here to be challenged. */
    showFriendly({ onChallenge, onCancel }) {
        this.showQueue('', 'friendly');
        const form = el('form', 'sg-challenge', null);
        const input = el('input', 's-input', form);
        input.placeholder = t('g3d.challenge.placeholder');
        input.maxLength = 64;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', t('g3d.challenge.inputLabel'));
        button('s-btn s-btn-primary s-btn-sm', form, t('g3d.challenge.send'), 'swords').type = 'submit';
        form.addEventListener('submit', e => {
            e.preventDefault();
            if (input.value.trim()) onChallenge(input.value.trim());
        });
        const withdraw = button('s-btn s-btn-ghost s-btn-sm', null, t('g3d.challenge.withdraw'), 'close');
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
        this.queueText.textContent = t('g3d.challenge.waiting', { name });
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
        const name = this.config.profile ? this.config.profile.name : t('g3d.challenge.yourName');
        this.queueText.textContent = text || t('g3d.challenge.idle', { name });
    }

    /** Someone challenges you: answer(true | false), or it expires. */
    showInvite(p, answer) {
        this.hideInvite();
        const card = el('section', 's-panel sg-invite', this.root);
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-label', t('g3d.invite.label'));
        const head = el('div', 'sg-invite-head', card);
        const img = el('img', '', head);
        img.src = Images.heroPortrait(Number(p.type) || 0);
        img.alt = '';
        const who = el('div', '', head);
        el('b', '', who, t('g3d.invite.title', { name: p.name }));
        el('div', 's-muted s-small', who, `${t('g3d.invite.meta')}${p.rating ? ` · ${p.rating}` : ''}`);
        const bar = progress(card, 1, 's-progress-ember');
        const actions = el('div', 'sg-invite-actions', card);
        const decline = button('s-btn s-btn-ghost s-btn-sm', actions, t('g3d.invite.decline'), 'close');
        const accept = button('s-btn s-btn-primary s-btn-sm', actions, t('g3d.invite.accept'), 'check');
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
        this.playerStatus = el('div', 'sg-status souls3d-status mine', this.root);
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

        // Portrait: the number of cards in the opponent's hand, beside its fan of card backs (Game.update).
        this.handCount = el('span', 'souls3d-hand-count', this.root);
        this.handCount.hidden = true;
        this.handCount.setAttribute('aria-hidden', 'true');

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
            mana.title = t('g3d.status.mana');
            const max = Math.max(0, Math.min(10, Number(info.maxMana) || 0));
            const now = Math.max(0, Math.min(max, Number(info.mana) || 0));
            for (let i = 0; i < Math.max(max, 1) && i < 10; i++) el('i', i < now ? 'full' : i < max ? 'spent' : '', mana);
            el('b', '', mana, `${now}/${max}`);
        }
        const deck = el('span', '', box);
        deck.title = t('g3d.status.deck');
        deck.append(icon('deck'), String(info.deck ?? 0));
        const hand = el('span', '', box);
        hand.title = t('g3d.status.hand');
        hand.append(icon('hand'), String(info.hand ?? 0));
        if (Number(info.fatigue) > 0 || Number(info.deck) === 0) {
            const fatigue = el('span', 'warn', box);
            fatigue.title = t('g3d.status.fatigue');
            fatigue.append(icon('skull'), `${(Number(info.fatigue) || 0) + 1}`);
        }
    }

    placeStatus(side, x, y, ax = 0.5) {
        this.follow(side === 'player' ? this.playerStatus : this.opponentStatus, x, y, ax);
    }

    /** The opponent's hand count at (x, y), its left edge there; null hides it. */
    placeHandCount(count, x, y) {
        const box = this.handCount;
        box.hidden = count === null;
        if (box.hidden) return;
        if (box.textContent !== String(count)) box.textContent = String(count);
        this.follow(box, x, y, 0);
    }

    /**
     * Moves an element that follows the 3D scene so that its anchor point (`ax`, `ay`: fractions of its size) is at
     * (x, y), but never past the edges of the screen (narrow phones).
     */
    follow(box, x, y, ax = 0.5, ay = 0.5) {
        const w = box.offsetWidth, h = box.offsetHeight;
        const left = Math.max(8, Math.min(this.root.clientWidth - w - 8, x - w * ax));
        const top = Math.max(8, Math.min(this.root.clientHeight - h - 8, y - h * ay));
        box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
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
        this.power.setAttribute('aria-label', t('g3d.power.label', { name: power.name, cost: power.cost }));
        this.powerInfo = {
            title: power.name,
            sub: t('g3d.power.sub', { cost: power.cost }),
            blocks: [{ text: power.text }, power.used ? { kind: 'info', text: t('g3d.power.used') } : null],
        };
    }

    placePower(x, y) {
        this.follow(this.power, x, y);
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
    updateTimer(now, x, y, ax = 0.5) {
        if (this.timerEndsAt === null || this.timerEndsAt === undefined) return;
        const left = Math.max(0, this.timerEndsAt - now);
        this.timerBar.style.width = `${(left / this.timerTotal) * 100}%`;
        const text = `${this.turnLabel || (this.timerMine ? t('g3d.yourTurn') : t('g3d.enemyTurn'))} · ${clock(left)}`;
        if (this.timerSeconds !== text) {
            this.timerSeconds = text;
            this.timerText.textContent = text;
        }
        const urgent = left < 15000 && this.timerMine;
        // The fuse starts to hiss when it gets short.
        if (urgent && left > 0 && !this.timer.classList.contains('urgent')) sound.play('timer_warning', 0.7);
        this.timer.classList.toggle('urgent', urgent);
        if (x !== undefined) this.follow(this.timer, x, y, ax, 0);
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
        const b = el('div', `sg-banner${enemy ? ' enemy' : ''}`);
        if (sub) el('small', '', b, sub);
        el('b', '', b, text);
        this.centre(b, BANNER_MS);
    }

    /** A legendary card enters the arena: its name in gold across the screen. */
    legendary(name, enemy = null) {
        const b = el('div', `sg-legend${enemy ? ' enemy' : ''}`);
        el('small', '', b, t('rarity.legendary'));
        el('b', '', b, name);
        this.centre(b, LEGEND_MS);
    }

    /**
     * The turn banner and the legendary name share the centre of the screen: the newest replaces the one showing. They
     * wait for a full-screen layer that is fading out (the mulligan), and never show over the end screen.
     */
    centre(b, ms) {
        if (this.endLayer) return;
        const wait = (this.fadingUntil || 0) - performance.now();
        if (wait > 0) {
            setTimeout(() => this.centre(b, ms), wait);
            return;
        }
        if (this.currentBanner) this.currentBanner.remove();
        b.setAttribute('aria-hidden', 'true');
        this.root.appendChild(b);
        this.currentBanner = b;
        setTimeout(() => b.remove(), ms);
    }

    /** Short messages ("Not enough mana!"), at most three. */
    screenMessage(text, warn = true) {
        const toasts = this.toasts.querySelectorAll('.sg-toast:not(.sg-hint)');
        if (toasts.length >= 3) toasts[0].remove();
        const toast = el('div', `sg-toast${warn ? ' warn' : ''}`, this.toasts);
        toast.append(icon(warn ? 'info' : 'sparkles'), String(text));
        setTimeout(() => toast.remove(), TOAST_MS);
    }

    /** A hint that stays while it applies ("Rabid Bite: pick a target"); null takes it away. */
    hint(text) {
        if (this.hintToast) this.hintToast.remove();
        this.hintToast = null;
        if (!text) return;
        this.hintToast = el('div', 'sg-toast sg-hint', this.toasts);
        this.hintToast.append(icon('sparkles'), String(text));
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
        // The in-game controls come in as the splash leaves (game3d.css).
        this.root.classList.add('intro');
        setTimeout(() => {
            splash.classList.add('leaving');
            this.root.classList.remove('intro');
        }, VERSUS_MS - 700);
        setTimeout(() => splash.remove(), VERSUS_MS);
    }

    // ---- Mulligan ------------------------------------------------------------------------------------------------

    /** The starting hand as card faces: tap the ones to replace, then confirm (once) before the countdown ends. */
    showMulligan({ cards, endsAt, total, done, opponent, onConfirm }) {
        this.hideMulligan(false);
        const layer = el('div', 'sg-layer sg-shade sg-mulligan', this.root);
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', t('g3d.mulligan.label'));
        const box = el('div', 'sg-mulligan-box', layer);
        el('div', 's-eyebrow', box, t('g3d.mulligan.eyebrow'));
        el('h2', '', box, t('g3d.mulligan.title'));
        el('p', '', box, touchInput() ? t('g3d.mulligan.help') : t('g3d.mulligan.helpClick'));
        const row = el('div', 'sg-mulligan-cards', box);
        const timer = el('div', 'sg-mulligan-timer', box);
        const bar = progress(timer, 1, 's-progress-ember');
        const time = el('span', 'sg-time', timer);
        const confirm = button('s-btn s-btn-gold s-btn-lg sg-mulligan-confirm', box, t('g3d.mulligan.keep'), 'check');
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
            el('span', 'sg-mulligan-mark', b).append(icon('refresh'), t('g3d.mulligan.replace'));
            b.addEventListener('click', () => {
                b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
                const n = m.buttons.filter(x => x.getAttribute('aria-pressed') === 'true').length;
                confirm.replaceChildren(icon(n ? 'refresh' : 'check'), n ? t('g3d.mulligan.replaceCards', { n }) : t('g3d.mulligan.keep'));
            });
            b.cid = card.cid;
            m.buttons.push(b);
        }
        confirm.addEventListener('click', () => {
            lock(t('g3d.mulligan.waiting', { name: opponent }));
            onConfirm(m.buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.cid));
        });
        if (done) lock(t('g3d.mulligan.waiting', { name: opponent }));
        const tick = () => {
            const left = Math.max(0, endsAt - performance.now());
            bar.style.setProperty('--p', `${Math.round((left / Math.max(1, total)) * 100)}%`);
            time.textContent = clock(left);
            if (left > 0 || m.locked) return;
            for (const b of m.buttons) b.setAttribute('aria-pressed', 'false');
            lock(t('g3d.mulligan.timeUp'));
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
            m.status.textContent = replaced ? t('g3d.mulligan.replaced', { name: m.opponent, n: replaced }) : t('g3d.mulligan.kept', { name: m.opponent });
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
            el('span', 'sg-mulligan-mark', b).append(icon(isNew ? 'sparkles' : 'check'), isNew ? t('g3d.mulligan.new') : t('g3d.mulligan.keptCard'));
        });
        m.locked = true;
        m.status.textContent = m.opponentDone ? t('g3d.mulligan.begins') : t('g3d.mulligan.waiting', { name: m.opponent });
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
        this.fadingUntil = performance.now() + FADE_MS;
        setTimeout(() => m.layer.remove(), FADE_MS);
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
        t.classList.remove('compact');
        t.style.transform = '';
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
            add('cost', 'gem', info.stats.cost, STATS.cost);
            add('atk', 'sword', info.stats.attack, STATS.attack);
            add('hp', 'heart', info.stats.maxHealth && Number(info.stats.health) < Number(info.stats.maxHealth) ? `${info.stats.health}/${info.stats.maxHealth}` : info.stats.health, STATS.health);
            if (Number(info.stats.armor) > 0) add('arm', 'shield', info.stats.armor, STATS.armor);
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
        const host = this.root.getBoundingClientRect();
        // Between `at.top` and the point it goes above, or `at.floor` (portrait: below the buttons, above the player's
        // hero and hero power); a tooltip too tall for that drops its flavour text, then shrinks.
        // (A box `at`, beside which the tooltip goes, is no upper limit: its tooltip may reach up to the screen edge.)
        const top = (at && at.width === undefined && at.top) || 8;
        const fenced = !!at && (at.above || at.floor !== undefined);
        const floor = !fenced ? host.height - 8 : at.above ? at.y : at.floor;
        let box = t.getBoundingClientRect();
        if (fenced && box.height > floor - top) {
            t.classList.add('compact');
            box = t.getBoundingClientRect();
        }
        const scale = fenced ? Math.max(0.6, Math.min(1, (floor - top) / box.height)) : 1;
        const w = box.width * scale, h = box.height * scale;
        let x, y;
        if (at && at.width !== undefined) {
            x = at.right - host.left + 12;
            y = at.top - host.top - h / 2 + at.height / 2;
        } else if (at && at.above) {
            x = Math.max(8, Math.min(at.x - w / 2, host.width - w - 8));
            y = at.y - h;
        } else {
            x = (at ? at.x : 0) + 18;
            y = (at ? at.y : 0) + 18;
        }
        if (x + w > host.width - 8) x = Math.max(8, (at && at.width !== undefined ? at.left - host.left : x - 36) - w - 12);
        y = Math.max(top, Math.min(y, floor - h));
        t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)${scale < 1 ? ` scale(${scale.toFixed(3)})` : ''}`;
    }

    hideTooltip() {
        this.tooltip.hidden = true;
    }

    // ---- Battle log ----------------------------------------------------------------------------------------------

    buildLog() {
        const log = el('section', 'sg-log souls3d-log', this.root);
        log.setAttribute('aria-label', t('g3d.log'));
        const head = button('sg-log-head', log, t('g3d.log'), 'list');
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

    /** A battle log line; `key` (its text key) picks the icon. */
    logLine(text, key) {
        const line = String(text);
        const [iconName, cls] = classify(line, key);
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
        this.settingsButton.setAttribute('aria-label', t('g3d.settings'));
        this.settingsButton.setAttribute('aria-expanded', 'false');
        this.settingsButton.addEventListener('click', () => this.toggleSettings());
        const seg = el('div', 's-seg', bar);
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', t('g3d.camera'));
        this.viewButtons = {};
        const labels = { classic: t('g3d.view.classic'), arena: t('g3d.view.arena'), field: t('g3d.view.field'), cinematic: t('g3d.view.cinematic') };
        for (const [name, view] of Object.entries(VIEWS)) {
            if (!view.key) continue;
            const b = button('', seg);
            el('kbd', '', b, view.key);
            b.append(labels[name] || view.label);
            b.addEventListener('click', () => { if (this.onView) this.onView(name); });
            this.viewButtons[name] = b;
        }
        el('span', 'souls3d-views-hint', bar, touchInput() ? t('g3d.views.touchHint') : t('g3d.views.mouseHint'));
        this.views = bar;
    }

    buildSettings() {
        const panel = el('section', 's-panel sg-settings souls3d-settings', this.root);
        panel.hidden = true;
        panel.setAttribute('aria-label', t('g3d.settings'));
        const head = el('div', 's-panel-head', panel);
        head.appendChild(icon('settings'));
        el('h3', '', head, t('g3d.settings'));
        const close = button('sg-icon-btn', head, null, 'close');
        close.setAttribute('aria-label', t('g3d.settings.close'));
        close.style.width = close.style.height = '32px';
        close.addEventListener('click', () => this.toggleSettings(false));

        const row = (label) => {
            const r = el('div', 'sg-setting', panel);
            el('span', '', r, label);
            const seg = el('div', 's-seg', r);
            return seg;
        };

        const soundSeg = row(t('g3d.settings.sound'));
        this.soundButtons = [[t('g3d.settings.on'), false], [t('g3d.settings.off'), true]].map(([label, muted]) => {
            const b = button('', soundSeg, label, muted ? 'mute' : 'volume');
            b.addEventListener('click', () => {
                if (sound.muted !== muted) sound.toggle();
                this.updateSound();
            });
            b.dataset.muted = String(muted);
            return b;
        });
        this.updateSound();

        const qualitySeg = row(t('g3d.settings.graphics'));
        const current = new URLSearchParams(location.search).get('fx') || 'auto';
        const qualities = { auto: t('g3d.quality.auto'), low: t('g3d.quality.low'), medium: t('g3d.quality.medium'), high: t('g3d.quality.high') };
        for (const [q, label] of Object.entries(qualities)) {
            const b = button(current === q ? 'active' : '', qualitySeg, label);
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

        // The page reloads in the language picked; a running game goes on after it (SoulsGameMode.resume, main.js).
        const l10n = window.SoulsL10n;
        if (l10n.languages.length > 1) {
            const languageSeg = row(t('g3d.settings.language'));
            for (const { code, name } of l10n.languages) {
                const b = button(code === l10n.lang ? 'active' : '', languageSeg, name);
                b.lang = code;
                b.setAttribute('aria-pressed', String(code === l10n.lang));
                b.addEventListener('click', () => l10n.setLanguage(code));
            }
        }

        this.leaveButton = button('s-btn s-btn-danger s-btn-sm', panel, t('g3d.leaveGame'), 'logout');
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
        this.emoteButton.setAttribute('aria-label', t('g3d.emotes'));
        this.emoteButton.setAttribute('aria-expanded', 'false');
        this.emoteButton.addEventListener('click', () => this.toggleEmotes());
        this.settingsButton.after(this.emoteButton);
        const panel = el('section', 's-panel sg-emotes souls3d-emotes', this.root);
        panel.hidden = true;
        panel.setAttribute('aria-label', t('g3d.emotes'));
        ((this.config.rules && this.config.rules.emotes) || []).forEach((text, i) => {
            button('s-btn s-btn-ghost s-btn-sm', panel, text).addEventListener('click', () => {
                this.toggleEmotes(false);
                if (this.onEmote) this.onEmote(i);
            });
        });
        this.muteButton = button('s-btn s-btn-ghost s-btn-sm', panel, t('g3d.emotes.mute'), 'mute');
        this.muteButton.setAttribute('aria-pressed', 'false');
        this.muteButton.addEventListener('click', () => {
            const muted = this.muteButton.getAttribute('aria-pressed') !== 'true';
            this.muteButton.setAttribute('aria-pressed', String(muted));
            this.muteButton.replaceChildren(icon(muted ? 'volume' : 'mute'), muted ? t('g3d.emotes.unmute') : t('g3d.emotes.mute'));
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
        if (bubble) this.follow(bubble, x, y, 0.5, side === 'player' ? 1 : 0);
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
     * The end screen: the result, coins and rating earned (counting up), the season rank before and after a ranked
     * game, daily quest progress, and links to the statistics and the replay. A friendly game earns nothing. Players
     * are taken to the statistics after a while (spectators stay). `kind` ('victory' | 'defeat' | 'draw') sets the look;
     * without it, it comes from an English `text` ("Victory!", "<name> wins!").
     */
    showEnd(text, result = {}, { redirect = true, detail, friendly = false, kind } = {}) {
        friendly = friendly || result.friendly === true;
        this.hideTimer();
        this.setPower(null);
        this.setStatus3d('player', null);
        this.setStatus3d('opponent', null);
        this.toggleSettings(false);
        this.toggleEmotes(false);
        this.hint(null);
        if (this.currentBanner) this.currentBanner.remove();
        kind = kind || (/^Victory/.test(text) ? 'victory' : /^Draw/.test(text) ? 'draw' : /wins!$/.test(text) ? 'victory' : 'defeat');
        const layer = el('div', 'sg-layer sg-shade souls3d-end', this.root);
        layer.style.animation = 's-fade-in 1.2s ease-out both';
        const end = el('div', `sg-end ${kind}`, layer);
        const title = text.replace(/!$/, '');
        // Longer than "Victory" ("<name> wins" for spectators): smaller, so a long name fits a phone.
        el('h1', `sg-end-title${title.length > 7 ? ' long' : ''}`, end, title);
        if (result.text || detail) el('div', 'sg-end-sub', end, detail || serverText(result));

        const rewards = el('div', 'sg-rewards', end);
        if (typeof result.coins === 'number' && !friendly) {
            const r = el('div', 's-panel sg-reward', rewards);
            r.appendChild(icon('coin'));
            const value = el('b', '', r, '+0');
            el('span', '', r, t('g3d.end.coins'));
            this.countUp(value, result.coins, '+', 900);
            if (result.coins > 0) setTimeout(() => sound.play('coins', 0.7), 900);
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
            el('span', '', r, friendly ? t('g3d.end.friendly') : t('g3d.end.practice'));
        }
        if (!rewards.childElementCount) rewards.remove();
        if (result.season) this.seasonResult(end, result.season);

        if (Array.isArray(result.quests) && result.quests.length) {
            const quests = el('section', 's-panel sg-end-quests', end);
            const head = el('div', 's-panel-head', quests);
            head.appendChild(icon('quest'));
            el('h3', '', head, t('g3d.dailyQuests'));
            this.questList(quests, result.quests, { animate: true });
            // A quest this game completed (not done in the profile the page started with) gets a jingle.
            const before = (this.config.profile && this.config.profile.quests) || [];
            // The profile's texts are in the page language, like serverText of the server's.
            if (result.quests.some(q => q.done && !before.some(b => b.text === serverText(q) && b.done))) {
                setTimeout(() => sound.play('quest_complete', 0.8), 1500);
            }
        }

        const actions = el('div', 'sg-end-actions', end);
        const statisticsId = result.statistics;
        if (statisticsId) {
            const stats = el('a', 's-btn s-btn-gold', actions);
            stats.href = `/Game/Stats/${encodeURIComponent(statisticsId)}`;
            stats.append(icon('list'), t('g3d.end.statistics'));
            const replay = el('a', 's-btn s-btn-ghost', actions);
            replay.href = `/Game/Replay/${encodeURIComponent(statisticsId)}`;
            replay.append(icon('play'), t('g3d.end.replay'));
        }
        const again = el('a', 's-btn s-btn-primary', actions);
        again.href = '/Game';
        again.append(icon(redirect ? 'swords' : 'arrow-left'), redirect ? t('g3d.end.again') : t('g3d.backToMenu'));

        if (statisticsId && redirect) {
            const note = el('div', 'sg-end-redirect', end);
            let left = 20;
            note.textContent = t('g3d.end.redirect', { seconds: left });
            const timer = setInterval(() => {
                left--;
                note.textContent = t('g3d.end.redirect', { seconds: left });
                if (left <= 0) {
                    clearInterval(timer);
                    window.location.replace(`/Game/Stats/${encodeURIComponent(statisticsId)}`);
                }
            }, 1000);
        }
        this.endLayer = layer;
    }

    /** A ranked game's season: the rank emblem before and after, and a promotion or demotion. */
    seasonResult(parent, season) {
        const change = season.promoted ? 'promoted' : season.demoted ? 'demoted' : '';
        const panel = el('section', `s-panel sg-end-season ${change}`.trim(), parent);
        const head = el('div', 's-panel-head', panel);
        head.appendChild(icon('trophy'));
        el('h3', '', head, season.name === undefined || season.name === null ? t('g3d.end.season') : serverText(season, 'name'));
        if (change) {
            const label = el('span', 'sg-season-change', head);
            label.append(icon(season.promoted ? 'arrow-up' : 'chevron-down'), season.promoted ? t('g3d.end.promoted') : t('g3d.end.demoted'));
        }
        const ranks = el('div', 'sg-season-ranks', panel);
        const badge = r => rankBadge(ranks, Number(r.rating), { tier: { name: serverText(r, 'tier'), css: String(r.css ?? '') } });
        badge(season.before || {}).classList.add('before');
        ranks.appendChild(icon('chevron-right', 's-icon sg-season-arrow'));
        badge(season.after || {}).classList.add('after');
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
        el('h2', '', head, t('g3d.live.title'));
        el('span', 'sg-live', head, t('g3d.live.badge'));
        return new Promise(resolve => {
            const done = value => resolve(value);
            if (games.length === 0) {
                const empty = el('div', 'sg-empty', panel);
                empty.appendChild(icon('hourglass', 's-icon s-icon-lg'));
                el('p', '', empty, t('g3d.live.empty'));
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
                el('div', 'sg-game-names', text, a && b ? t('g3d.versus', { a: name(a), b: name(b) }) : t('g3d.live.game', { id: g.gameId }));
                const kind = !g.practice ? t('g3d.mode.ranked') : (g.players || []).some(p => p.bot) ? t('g3d.mode.practice') : t('g3d.mode.friendly');
                el('div', 'sg-game-meta', text, t('g3d.live.meta', { kind, turn: (g.turn ?? 0) + 1, watching: g.spectators ?? 0 }));
                const watch = button('s-btn s-btn-primary s-btn-sm', item, t('g3d.live.watch'), 'eye');
                watch.addEventListener('click', () => done(g.gameId));
            }
            const actions = el('div', 'd-flex gap-2 justify-content-end mt-3', panel);
            const back = button('s-btn s-btn-ghost s-btn-sm', actions, t('g3d.back'), 'arrow-left');
            back.addEventListener('click', () => done(null));
            const refresh = button('s-btn s-btn-gold s-btn-sm', actions, t('g3d.live.refresh'), 'refresh');
            refresh.addEventListener('click', () => { done(undefined); onRefresh(); });
        });
    }

    /** The bar while watching someone else's game (or a replay). */
    showSpectating(text, onLeave, { replay = false } = {}) {
        if (!this.banner3d) {
            this.banner3d = el('div', 'sg-watching souls3d-banner', this.root);
            this.bannerBadge = el('span', 'sg-live', this.banner3d);
            this.bannerText = el('span', 'sg-watching-text', this.banner3d);
            this.bannerLeave = button('s-btn s-btn-ghost s-btn-sm', this.banner3d, t('g3d.leave'), 'logout');
        }
        this.bannerBadge.textContent = replay ? t('g3d.replay.badge') : t('g3d.live.badge');
        this.bannerBadge.classList.toggle('replay', replay);
        this.bannerText.textContent = text;
        this.bannerLeave.onclick = onLeave;
        this.banner3d.hidden = false;
        this.onLeave = onLeave;
        this.leaveButton.lastChild.textContent = replay ? t('g3d.replay.close') : t('g3d.spectate.stop');
    }

    /** Play/pause, speed and restart for replays. */
    showReplay({ onToggle, onSpeed, onRestart }) {
        const bar = el('div', 's-panel sg-transport souls3d-replay', this.root);
        const toggle = button('sg-icon-btn', bar, null, 'pause');
        toggle.setAttribute('aria-label', t('g3d.replay.pause'));
        toggle.addEventListener('click', () => {
            const playing = onToggle();
            toggle.replaceChildren(icon(playing ? 'pause' : 'play'));
            toggle.setAttribute('aria-label', playing ? t('g3d.replay.pause') : t('g3d.replay.play'));
        });
        const seg = el('div', 's-seg', bar);
        seg.setAttribute('aria-label', t('g3d.replay.speed'));
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
        restart.setAttribute('aria-label', t('g3d.replay.restart'));
        restart.addEventListener('click', onRestart);
    }

    setReplayProgress(fraction) {
        if (this.replayProgress) this.replayProgress.style.setProperty('--p', `${Math.round(Math.min(1, fraction) * 100)}%`);
    }

    // ---- Chat ----------------------------------------------------------------------------------------------------

    buildChat() {
        const chat = el('section', 'souls3d-chat collapsed', this.root);
        chat.setAttribute('aria-label', t('g3d.chat'));
        const header = button('souls3d-chat-header', chat, t('g3d.chat'), 'chat');
        this.chatBadge = el('span', 'souls3d-chat-badge', header);
        header.addEventListener('click', () => {
            chat.classList.toggle('collapsed');
            this.chatBadge.textContent = '';
            if (!chat.classList.contains('collapsed')) this.chatInput.focus();
        });
        const body = el('div', 'souls3d-chat-body', chat);
        this.chatLog = el('div', 'souls3d-chat-log', body);
        this.chatMembers = el('div', 'souls3d-chat-members', body);
        this.chatInput = el('textarea', 'souls3d-chat-input', chat);
        this.chatInput.placeholder = t('g3d.chat.placeholder');
        this.chatInput.rows = 1;
        this.chatInput.maxLength = 500;
        this.chatInput.setAttribute('aria-label', t('g3d.chat.inputLabel'));
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
