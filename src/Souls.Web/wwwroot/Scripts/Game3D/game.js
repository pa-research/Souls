// Game controller of the 3D client. It speaks the same protocol as the classic client (so classic and 3D players
// can play each other, see docs/game-protocol.md). Server messages are played in order through a queue: each one
// finishes its animation before the next starts, and GameSync (the full state after every action) is the truth for
// all numbers. The same code plays live games, spectated games and recorded replays.
import * as THREE from '/lib/three/three.module.js';
import { Request, Response, Socket } from './net.js';
import { Images, loadImage, textureFrom, sound } from './assets.js';
import { Card3D, SlotMarker, FLAT_FACE_UP } from './cards.js';
import { Hero3D } from './heroes.js';
import { slotPosition } from './arena.js';
import { toWorld } from './scene.js';
import { tweens, Ease } from './tween.js';

// Classic layout (stage pixels).
const HAND_X = 165;
const HAND_SPACING = 60;
const PLAYER_HAND_Y = 980;
const OPPONENT_HAND_Y = 200;
const SLOT_COUNT = 7;

// How far screen-anchored objects float from the board towards the camera.
const HAND_LIFT = 0.2;
const HOVER_LIFT = 0.36;
const HERO_LIFT = 0.07;
const SIGN_LIFT = 0.14;
const PODIUM_Z = 585; // podiums stand near the arena wall, behind the board

const BOARD_HEIGHT = 2;
const FACE_DOWN_FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const TURN_AROUND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// Colours of abilities (by ability id) and hero powers (by class).
export const ABILITY_COLORS = { 1: 0x6dff7a, 2: 0xc77dff, 5: 0x7fb8ff, 7: 0xc0c8d0, 8: 0xff7a1a };
const POWER_COLORS = { 1: 0xff4d4d, 2: 0xd0104a, 3: 0xfff1a8, 4: 0x9aa5b1 };

// Messages that change the game: played in order through the queue.
const QUEUED = new Set([
    Response.GAME_CREATE, Response.RECOVER, Response.SPECTATE_START, Response.USECARD_OK, Response.OPPONENT_USECARD_OK,
    Response.NEWCARD, Response.OPPONENT_NEWCARD, Response.NEXT_TURN, Response.GAME_EVENTS, Response.GAME_SYNC,
    Response.VICTORY, Response.DEFEAT, Response.DRAW, Response.SPECTATE_END,
]);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Resolves with the promise, or after `ms` at the latest, so a stuck animation never blocks the game. */
const within = (promise, ms) => Promise.race([Promise.resolve(promise), wait(ms)]);

class Side {
    constructor(isPlayer) {
        this.isPlayer = isPlayer;
        this.hero = new Hero3D(isPlayer);
        this.hand = new Map(); // cid -> Card3D, in hand order
        this.board = new Map(); // cid -> Card3D
    }
}

/** The wooden "End Turn" sign (classic: 200x75 at 1610,550; flips 4 times when the turn changes). */
class EndTurnSign extends THREE.Group {
    constructor() {
        super();
        this.name = 'end-turn';
        this.body = new THREE.Group();
        this.add(this.body);
        this.front = new THREE.MeshStandardMaterial({ roughness: 0.7, transparent: true, alphaTest: 0.1 });
        const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
        this.board = new THREE.Mesh(new THREE.BoxGeometry(196, 70, 10), [wood, wood, wood, wood, this.front, this.front]);
        this.board.castShadow = true;
        this.board.userData.endTurn = true;
        this.body.add(this.board);
        this.active = false;
        Promise.all([loadImage(Images.endTurn), loadImage(Images.endTurnDisabled)]).then(([on, off]) => {
            this.textures = { on: on && textureFrom(on), off: off && textureFrom(off) };
            this.setActive(this.active);
        });
    }

    setActive(active) {
        this.active = active;
        if (!this.textures) return;
        this.front.map = active ? this.textures.on : this.textures.off;
        this.front.needsUpdate = true;
    }

    spin() {
        sound.play('END_TURN', 0.5);
        return tweens.run(800, t => { this.body.rotation.x = t * Math.PI * 4; }, Ease.linear);
    }
}

export class Game {
    /** mode: 'normal' | 'practice' (play), 'watch' (spectate a live game) or 'replay' (play back a recording). */
    constructor({ stage, ui, effects, arena, crowd, config, mode = 'practice', difficulty = 1 }) {
        this.stage = stage;
        this.ui = ui;
        this.effects = effects;
        this.arena = arena;
        this.crowd = crowd;
        this.config = config;
        this.mode = mode;
        this.difficulty = difficulty;
        this.normalGame = mode === 'normal';
        this.spectator = mode === 'watch' || mode === 'replay';
        this.rules = config.rules || { abilities: {}, races: {}, heroPowers: {}, heroTypes: {}, keywords: {} };
        this.tilt = 0;
        this.portraits = Object.fromEntries(config.cards.map(c => [c.id, c.portrait]));
        this.active = false; // a game is running
        this.ended = false;
        this.yourTurn = false;
        this.current = null; // ident of the player whose turn it is
        this.ident = 1; // spectators see the game from player one's side
        this.gameId = null;
        this.chatRoom = null;
        this.hovered = null;
        this.reconnects = 0;
        this.queue = Promise.resolve();
        this.dying = new Map(); // cid -> Card3D that left the board and is still animating
        this.lastSync = null;
        this.interaction = null;

        this.root = new THREE.Group();
        this.root.name = 'game';
        this.root.visible = false;
        stage.scene.add(this.root);

        this.player = new Side(true);
        this.opponent = new Side(false);
        for (const side of [this.player, this.opponent]) this.root.add(side.hero, side.hero.podium);

        // The End Turn sign and the hand cards are HUD: they stay put on screen in every camera view.
        this.sign = new EndTurnSign();
        this.sign.visible = !this.spectator;
        stage.hud.add(this.sign);

        this.slots = [];
        loadImage(Images.cardSlot).then(img => {
            const texture = img && textureFrom(img);
            for (let i = 0; i < SLOT_COUNT; i++) {
                const marker = new SlotMarker(texture, i);
                marker.position.copy(slotPosition(true, i)).setY(1.2);
                this.slots.push(marker);
                this.root.add(marker);
            }
        });

        stage.onResize(() => this.layout(false));
        this.layout(false);
        ui.onPower = () => this.onPowerButton();

        if (mode !== 'replay') {
            const wsBase = config.wsBase.startsWith('/')
                ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${config.wsBase}`
                : config.wsBase;
            this.gameSocket = new Socket(`${wsBase}/game`, m => this.onGameMessage(m), e => this.onGameClosed(e));
            this.chatSocket = new Socket(`${wsBase}/chat`, m => this.onChatMessage(m), () => { });
            ui.onChat = text => this.sendChat(text);
            // Keeps the sliding login cookie alive while playing (classic: /Player/KeepAlive every minute).
            setInterval(() => fetch('/Player/KeepAlive', { credentials: 'same-origin' }).catch(() => { }), 60000);
        }
    }

    start() {
        if (this.mode === 'replay') {
            this.playReplay();
            return;
        }
        this.ui.showQueue(this.mode === 'watch' ? 'Looking for games...' : 'Connecting...');
        this.gameSocket.connect();
        if (!this.spectator) this.chatSocket.connect();
        this.login();
    }

    login() {
        this.gameSocket.send(Request.LOGIN);
        if (this.mode === 'watch') {
            const id = this.watchId ?? this.config.watch;
            if (id) this.spectate(id);
            else this.gameSocket.send(Request.LIST_LIVE_GAMES);
            return;
        }
        if (this.normalGame) this.gameSocket.send(Request.QUEUE_NORMAL);
        else this.gameSocket.send(Request.QUEUE_PRACTICE, { difficulty: this.difficulty });
    }

    spectate(gameId) {
        this.watchId = gameId;
        this.ui.showQueue('Joining the game...');
        this.gameSocket.send(Request.SPECTATE, { gameId });
    }

    // ---- Layout -------------------------------------------------------------------------------------------------

    handPose(side, index, hovered = false, card = null) {
        const y = side.isPlayer ? PLAYER_HAND_Y : OPPONENT_HAND_Y;
        const x = HAND_X + HAND_SPACING * index;
        if (hovered) return this.stage.hudPose(x, y - 120, HOVER_LIFT, 2.2);
        const pose = this.stage.hudPose(x, y, HAND_LIFT + index * 0.004);
        // The opponent's cards, and player one's when spectating, show their backs.
        if (!side.isPlayer || (card && !card.revealed)) pose.quaternion.multiply(TURN_AROUND);
        return pose;
    }

    boardPose(side, card) {
        return { position: slotPosition(side.isPlayer, card.data.slotId).setY(BOARD_HEIGHT), quaternion: FLAT_FACE_UP.clone(), scale: 1 };
    }

    /** Re-positions everything that is anchored to the classic screen layout. */
    layout(animate = true) {
        for (const side of [this.player, this.opponent]) {
            // Heroes: where the classic client draws them (classic view), or on their podium (stadium views).
            side.hero.anchorPose = this.stage.anchor(960, side.isPlayer ? 955 : 125, HERO_LIFT);
            side.hero.podium.position.set(0, 0, side.isPlayer ? PODIUM_Z : -PODIUM_Z);
            this.layoutHand(side, animate);
        }
        const sign = this.stage.hudPose(1610, 550, SIGN_LIFT);
        this.sign.position.copy(sign.position);
        this.sign.quaternion.copy(sign.quaternion);
        this.sign.scale.setScalar(sign.scale);
    }

    layoutHand(side, animate = true) {
        let i = 0;
        for (const card of side.hand.values()) {
            const index = i++;
            if (card.dragging || card.pending || card.opponentDragging) continue;
            const pose = this.handPose(side, index, card === this.hovered, card);
            if (animate) card.moveTo(pose, card === this.hovered ? 220 : 450, card === this.hovered ? Ease.backOut : Ease.cubicOut);
            else card.setPose(pose);
        }
    }

    // ---- Cards --------------------------------------------------------------------------------------------------

    createCard(side, data, inHand = false) {
        const card = new Card3D(data, { owner: side.isPlayer ? 'player' : 'opponent', portraits: this.portraits });
        (inHand ? this.stage.hud : this.root).add(card);
        return card;
    }

    /** Takes a card out of the HUD hand into the world (keeping where it is on screen). */
    liftOut(card) {
        if (card.anim) card.anim.cancel();
        if (card.parent === this.stage.hud) this.stage.hudToWorld(card, this.root);
        card.castsShadow = true;
    }

    /** Puts a card back into the HUD hand (keeping where it is on screen); call layoutHand afterwards. */
    putBack(card) {
        if (card.anim) card.anim.cancel();
        if (card.parent !== this.stage.hud) this.stage.worldToHud(card);
        card.castsShadow = false;
        card.setTilt(0);
    }

    addHandCards(side, cards, { deal = true } = {}) {
        cards.forEach((data, k) => {
            if (side.hand.has(data.cid)) return;
            const card = this.createCard(side, data, true);
            card.castsShadow = false;
            side.hand.set(card.cid, card);
            // Deal from the right edge of the screen, flipping into place.
            const start = this.stage.hudPose(2080, side.isPlayer ? PLAYER_HAND_Y : OPPONENT_HAND_Y, HAND_LIFT);
            if (side.isPlayer && card.revealed) start.quaternion.multiply(TURN_AROUND);
            card.setPose(start);
            tweens.wait(deal ? k * 120 : 0).then(() => {
                if (side.hand.get(card.cid) !== card || card.dragging || card.pending || card.opponentDragging) return;
                card.moveTo(this.handPose(side, [...side.hand.keys()].indexOf(card.cid), card === this.hovered, card), 650, Ease.cubicOut);
            });
        });
    }

    addBoardCard(side, data) {
        const card = this.createCard(side, data);
        side.board.set(card.cid, card);
        card.setPose(this.boardPose(side, card));
        return card;
    }

    clearCards() {
        for (const side of [this.player, this.opponent]) {
            for (const card of [...side.hand.values(), ...side.board.values()]) card.dispose();
            side.hand.clear();
            side.board.clear();
        }
        for (const card of this.dying.values()) card.dispose();
        this.dying.clear();
        this.hovered = null;
    }

    freeSlot(slotId) {
        return ![...this.player.board.values()].some(c => c.data.slotId === slotId);
    }

    /** Hovering a hand card zooms it like the classic client and previews its mana cost. */
    setHovered(card) {
        if (this.hovered === card) return;
        const previous = this.hovered;
        this.hovered = card;
        const side = this.player;
        const cards = [...side.hand.values()];
        for (const c of [previous, card]) {
            if (!c || c.dragging || c.pending || !side.hand.has(c.cid)) continue;
            const pose = this.handPose(side, cards.indexOf(c), c === card, c);
            c.moveTo(pose, c === card ? 200 : 350, c === card ? Ease.backOut : Ease.cubicOut);
        }
        side.hero.previewCost(card ? Number(card.data.cost) : null);
    }

    showSlots(visible) {
        for (const slot of this.slots) slot.show(visible && this.freeSlot(slot.slotId));
    }

    highlightSlot(slotId) {
        for (const slot of this.slots) slot.highlight(slot.slotId === slotId);
    }

    sideByIdent(ident) {
        return Number(ident) === this.ident ? this.player : this.opponent;
    }

    heroOf(ident) {
        return this.sideByIdent(ident).hero;
    }

    sideOf(card) {
        return card.owner === 'player' ? this.player : this.opponent;
    }

    cardByCid(cid) {
        return this.player.board.get(cid) || this.opponent.board.get(cid) || this.dying.get(cid) || null;
    }

    /** An event target {k: 'card', cid} or {k: 'hero', id}. */
    resolve(ref) {
        if (!ref) return null;
        return ref.k === 'hero' ? this.heroOf(ref.id) : this.cardByCid(ref.cid);
    }

    targetPoint(obj) {
        return obj instanceof Hero3D ? obj.position.clone() : obj.center();
    }

    // ---- Rules text (tooltips) ------------------------------------------------------------------------------------

    /** Tooltip content for a card or hero: {title, lines}. */
    describe(obj) {
        const r = this.rules;
        if (obj instanceof Hero3D) {
            const info = obj.info;
            const type = r.heroTypes[info.type];
            const power = r.heroPowers[info.type];
            const health = info.maxHealth && Number(info.health) < Number(info.maxHealth) ? `${info.health}/${info.maxHealth}` : info.health;
            return {
                title: String(info.name ?? ''),
                lines: [
                    `${type ? type.name + ' · ' : ''}Attack ${info.attack} · Health ${health}${Number(info.armor) > 0 ? ` · Armor ${info.armor}` : ''}`,
                    power ? `Hero power, ${power.name} (${power.cost} mana): ${power.text}` : null,
                    type && type.mana ? `+${type.mana} mana every turn.` : null,
                    info.rating ? `Rating ${info.rating}` : null,
                    Number(info.armor) > 0 ? r.keywords.armor : null,
                ],
            };
        }
        if (!(obj instanceof Card3D) || !obj.revealed) return null;
        const d = obj.data;
        const level = Number(d.level) || 1;
        const ability = d.ability && r.abilities[d.ability.id];
        const race = d.race && r.races[d.race.id];
        const side = this.sideOf(obj);
        const onBoard = side.board.get(obj.cid) === obj;
        const health = d.maxHealth !== undefined && Number(d.health) < Number(d.maxHealth) ? `${d.health}/${d.maxHealth}` : d.health;
        const exhausted = onBoard && side.isPlayer && this.yourTurn && !obj.ready && !d.paralyzed;
        return {
            title: `${d.name}${level > 1 ? ' ' + '★'.repeat(level - 1) : ''}`,
            lines: [
                `Cost ${d.cost} · Attack ${d.attack} · Health ${health}${Number(d.armor) > 0 ? ` · Armor ${d.armor}` : ''}`,
                ability ? `${ability.name}: ${ability.text}` : null,
                race ? `${race.name}. ${race.text}` : null,
                d.paralyzed ? r.keywords.paralyzed : null,
                exhausted ? 'Exhausted: it already acted this turn, or arrived this turn.' : null,
                !onBoard && side.isPlayer && !ability?.activated && ability?.name !== 'Charge' ? r.keywords.summoningSick : null,
                d.token ? 'Token: summoned, not part of any deck.' : null,
                level > 1 ? `Level ${level}: +${level - 1} attack and health.` : null,
            ],
        };
    }

    inspect(obj, at) {
        this.ui.showTooltip(obj ? this.describe(obj) : null, at);
    }

    /** What an activated ability (or hero power) may target, as game objects. */
    candidates(targets, source = null) {
        const list = [];
        for (const t of targets || []) {
            if (t === 'friendlyCard') list.push(...[...this.player.board.values()].filter(c => c !== source));
            else if (t === 'ownHero') list.push(this.player.hero);
            else if (t === 'enemyCard') list.push(...this.opponent.board.values());
            else if (t === 'enemyHero') list.push(this.opponent.hero);
        }
        return list;
    }

    abilityOf(card) {
        const id = card && card.abilityId;
        const ability = id !== undefined ? this.rules.abilities[id] : null;
        return ability && ability.activated ? ability : null;
    }

    /** Attack targets: Taunt cards first. */
    attackCandidates() {
        const taunts = [...this.opponent.board.values()].filter(c => c.data.taunt);
        return taunts.length ? taunts : [...this.opponent.board.values(), this.opponent.hero];
    }

    // ---- Requests (called by the interaction layer) ---------------------------------------------------------------

    get canAct() {
        return this.active && !this.ended && !this.spectator;
    }

    pickUp(card) {
        this.setHovered(null);
        this.ui.hideTooltip();
        card.dragging = true;
        this.liftOut(card);
        sound.play('CARD_PICKUP', 0.5);
        this.showSlots(true);
        this.lastMove = 0;
    }

    /** Moves a dragged hand card; tells the opponent where it is every 200 ms (classic RequestMove). */
    drag(card, world, classic, now) {
        world.clampLength(0, 1100);
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.45, 0, 0));
        card.setPose({ position: world, quaternion: tilt, scale: 1.15 });
        if (now - this.lastMove > 200) {
            this.lastMove = now;
            this.gameSocket.send(Request.MOVE_CARD, { cid: card.cid, x: classic.x, y: 1080 - classic.y + 52.5, gameId: this.gameId });
        }
    }

    /** Drops a dragged hand card on a slot (USECARD) or releases it (RELEASE_CARD). The server answers both. */
    drop(card, slotId) {
        card.dragging = false;
        this.showSlots(false);
        this.highlightSlot(-1);
        card.pending = true;
        if (slotId !== null && slotId !== undefined) {
            card.moveTo({ position: slotPosition(true, slotId).setY(60), quaternion: FLAT_FACE_UP.clone(), scale: 1.05 }, 180, Ease.quadOut);
            this.gameSocket.send(Request.USECARD, { cid: card.cid, slotId });
        } else {
            this.gameSocket.send(Request.RELEASE_CARD, { cid: card.cid, gameId: this.gameId });
        }
        // Safety net: if the server never answers, put the card back.
        setTimeout(() => {
            if (card.pending && this.player.hand.get(card.cid) === card) { card.pending = false; this.putBack(card); this.layoutHand(this.player); }
        }, 8000);
    }

    attack(source, target) {
        const sourceIsHero = source instanceof Hero3D;
        const targetIsHero = target instanceof Hero3D;
        const type = sourceIsHero ? (targetIsHero ? 3 : 2) : (targetIsHero ? 1 : 0);
        this.gameSocket.send(Request.ATTACK, {
            source: sourceIsHero ? -1 : source.cid,
            target: targetIsHero ? -1 : target.cid,
            type,
        });
    }

    /** Target type of abilities and hero powers: 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card. */
    targetType(target) {
        if (target === this.player.hero) return 1;
        if (target === this.opponent.hero) return 2;
        return this.player.board.get(target.cid) === target ? 0 : 3;
    }

    useAbility(source, target) {
        const type = this.targetType(target);
        this.gameSocket.send(Request.USE_ABILITY, {
            source: source.cid,
            target: target instanceof Card3D ? target.cid : -1,
            type,
            abilityId: source.abilityId ?? -1337,
        });
    }

    get heroPower() {
        return this.rules.heroPowers[this.player.hero.info.type] || null;
    }

    /** The hero power button: fire it, or start targeting (see Interaction.beginPower). */
    onPowerButton() {
        const power = this.heroPower;
        if (!this.canAct || !this.yourTurn || !power) return;
        if (!power.targets || power.targets.length === 0) {
            this.gameSocket.send(Request.HERO_POWER, { target: -1, type: 1 });
            return;
        }
        if (this.interaction) this.interaction.beginPower(power);
    }

    usePower(target) {
        this.gameSocket.send(Request.HERO_POWER, { target: target instanceof Card3D ? target.cid : -1, type: this.targetType(target) });
    }

    endTurn() {
        if (!this.yourTurn || this.ended || this.spectator) return;
        this.yourTurn = false;
        this.sign.spin().then(() => this.sign.setActive(false));
        this.ui.setTurn(false);
        this.gameSocket.send(Request.NEXT_TURN);
    }

    // ---- Server messages ------------------------------------------------------------------------------------------

    onGameMessage(m) {
        if (QUEUED.has(m.Type)) {
            this.enqueue(m);
            return;
        }
        const p = m.Payload;
        switch (m.Type) {
            case Response.LOGIN_OK:
                this.reconnects = 0;
                if (!this.spectator) this.chatSocket.send(Request.LOGIN);
                if (!this.active && !this.spectator) this.ui.setStatus('Connection established!');
                break;
            case Response.LOGIN_NO_HASH:
            case Response.LOGIN_NOT_LOGGED_IN:
                this.ui.showQueue('You are not logged in!');
                break;
            case Response.LOGIN_WRONG_HASH:
                this.ui.showQueue('Authentication Failure!');
                break;
            case Response.LOGIN_BANNED:
                this.ui.showQueue('You are banned!');
                break;
            case Response.QUEUE_OK:
                this.ui.setStatus(this.normalGame ? 'Waiting for an opponent of your rank...' : 'Waiting for Match');
                break;
            case Response.QUEUE_ALREADY_IN:
                this.ui.setStatus('You are already in queue!');
                break;
            case Response.OPPONENT_MOVE:
                this.onOpponentMove(p);
                break;
            case Response.RELEASE:
            case Response.OPPONENT_RELEASE:
                this.onRelease(m.Type === Response.RELEASE ? this.player : this.opponent, p.cid);
                break;
            case Response.NOT_YOUR_TURN:
                this.ui.screenMessage('Not your turn!');
                break;
            case Response.SLOT_OCCUPIED:
                this.ui.screenMessage(p.message);
                break;
            case Response.USECARD_OOM:
                this.ui.screenMessage('Not enough mana!');
                break;
            case Response.GENERAL_MESSAGE:
                this.ui.screenMessage(p);
                break;
            case Response.LIVE_GAMES:
                this.onLiveGames(p);
                break;
            case Response.SPECTATE_ERROR:
                this.watchId = null;
                this.ui.showQueue(String(p));
                setTimeout(() => this.gameSocket.send(Request.LIST_LIVE_GAMES), 1500);
                break;
            case Response.ERROR:
                if (typeof p === 'string') this.ui.screenMessage(p);
                break;
            default:
                break;
        }
    }

    enqueue(m) {
        this.queue = this.queue
            .then(() => within(this.handle(m), 12000))
            .catch(err => console.error('[Souls3D]', err));
        return this.queue;
    }

    async handle(m) {
        const p = m.Payload;
        switch (m.Type) {
            case Response.GAME_CREATE:
            case Response.RECOVER:
            case Response.SPECTATE_START:
                return this.onCreate(p, m.Type === Response.SPECTATE_START);
            case Response.USECARD_OK:
            case Response.OPPONENT_USECARD_OK:
                return this.onUseCard(m.Type === Response.USECARD_OK ? this.player : this.opponent, p);
            case Response.NEWCARD:
                return this.onNewCards(this.player, p);
            case Response.OPPONENT_NEWCARD:
                return this.onNewCards(this.opponent, p);
            case Response.NEXT_TURN:
                return this.onNextTurn(p);
            case Response.GAME_EVENTS:
                return this.playEvents(p.events || []);
            case Response.GAME_SYNC:
                return this.applySync(p);
            case Response.VICTORY:
                return this.onEnd('Victory!', p);
            case Response.DEFEAT:
                return this.onEnd('Defeat!', p);
            case Response.DRAW:
                return this.onEnd('Draw!', p);
            case Response.SPECTATE_END:
                return this.onSpectateEnd(p);
            default:
                return undefined;
        }
    }

    onCreate(p, spectating) {
        this.clearCards();
        this.gameId = p.gameId;
        this.ident = spectating ? 1 : (p.ident || 1);
        this.ended = false;
        this.player.hero.setInfo(p.player.info);
        this.opponent.hero.setInfo(p.opponent.info);
        this.player.hero.previewCost(null);
        this.opponent.hero.previewCost(null);
        for (const data of Object.values(p.player.board || {})) this.addBoardCard(this.player, data);
        for (const data of Object.values(p.opponent.board || {})) this.addBoardCard(this.opponent, data);
        const playerHand = Array.isArray(p.player.hand) ? p.player.hand : Object.values(p.player.hand || {});
        this.addHandCards(this.player, playerHand, { deal: true });
        this.addHandCards(this.opponent, p.opponent.hand || [], { deal: true });

        if (spectating) {
            const names = `${p.player.info.name} vs ${p.opponent.info.name}`;
            this.ui.showSpectating(this.mode === 'replay' ? `Replay: ${names}` : `Watching ${names}`, () => this.leave());
        } else if (p.ident === 1 && p.create) {
            // The first player creates the game's chat room.
            this.chatSocket.send(Request.CHAT_NEWGAMEROOM);
        }
        if (p.create) this.kickOff();

        this.setTurn(!!p.yourTurn && !spectating);
        this.sign.setActive(this.yourTurn);
        this.root.visible = true;
        this.stage.leaveMenu();
        this.active = true;
        sound.stopMusic();
        sound.playMusic('GAME_MUSIC', 0.1);
        this.ui.hideQueue();
        this.ui.showViews(true, { chat: !this.spectator });
        if (!this.spectator) this.markInGame();
        return wait(p.create ? 600 : 100);
    }

    setTurn(yourTurn) {
        this.yourTurn = !!yourTurn && !this.spectator;
        if (this.spectator && this.current) {
            const name = this.heroOf(this.current).info.name;
            this.ui.setTurn(this.current === 1, `${name}'s turn`);
        } else {
            this.ui.setTurn(this.yourTurn);
        }
    }

    onOpponentMove(p) {
        const card = this.opponent.hand.get(p.cid);
        if (!card) return;
        card.opponentDragging = true;
        this.liftOut(card);
        card.moveTo({ position: toWorld(p.x, p.y, 80), quaternion: FACE_DOWN_FLAT.clone(), scale: 1.1 }, 450, Ease.quadOut);
    }

    onRelease(side, cid) {
        const card = side.hand.get(cid);
        if (!card) return;
        card.pending = card.dragging = card.opponentDragging = false;
        this.putBack(card);
        this.layoutHand(side);
    }

    onUseCard(side, p) {
        const data = p.card;
        side.hero.setInfo(p.pInfo);
        const card = side.hand.get(data.cid) || this.createCard(side, data);
        side.hand.delete(data.cid);
        side.board.set(data.cid, card);
        card.pending = card.dragging = card.opponentDragging = false;
        this.liftOut(card);
        if (this.hovered === card) this.hovered = null;
        card.setData(data);
        this.layoutHand(side);
        if (side.isPlayer) this.player.hero.previewCost(null);
        return card.moveTo(this.boardPose(side, card), side.isPlayer ? 380 : 750, Ease.cubicOut, { arc: side.isPlayer ? 40 : 220 }).then(() => {
            sound.play('CARD_MOUNT', 0.5);
            this.effects.burst(card.position.clone().setY(8), { color: 0xd9b26f, count: 26, speed: 160, size: 34, life: 600, gravity: -300, up: 0.3 });
            this.effects.shockwave(card.position, side.isPlayer ? 0x8fd3ff : 0xff9a8f, 220);
            this.effects.shake(5);
            this.cheer(0.2);
        });
    }

    onNewCards(side, p) {
        const cards = p.card || [];
        if (p.returned) {
            // Haunt: the card comes back from the arena to the hand.
            for (const data of cards) {
                const at = this.stage.hudPose(960, side.isPlayer ? PLAYER_HAND_Y : OPPONENT_HAND_Y, HAND_LIFT);
                const card = this.createCard(side, data, true);
                card.castsShadow = false;
                if (!side.isPlayer || !card.revealed) at.quaternion.multiply(TURN_AROUND);
                card.setPose({ ...at, scale: 0.01 });
                card.setOpacity(0.6);
                side.hand.set(card.cid, card);
                card.moveTo({ ...at, scale: 1.3 }, 350, Ease.backOut).then(() => { card.setOpacity(1); this.layoutHand(side); });
            }
            return wait(450);
        }
        this.addHandCards(side, cards);
        return wait(150);
    }

    onNextTurn(p) {
        this.opponent.hero.setInfo(p.opponentInfo);
        this.player.hero.setInfo(p.playerInfo);
        if (this.spectator) {
            // Spectators get player one's messages: "yourTurn" means player one's turn.
            this.current = p.yourTurn ? 1 : 2;
            this.setTurn(false);
        } else {
            this.current = p.yourTurn ? this.ident : 3 - this.ident;
            this.setTurn(p.yourTurn);
        }
        if (p.turnEndsIn) this.ui.setTimer(performance.now() + p.turnEndsIn, p.turnEndsIn, this.yourTurn);
        if (this.yourTurn) {
            this.sign.spin().then(() => this.sign.setActive(true));
            this.ui.screenMessage('Your turn!');
        } else {
            this.sign.setActive(false);
        }
        return wait(200);
    }

    /** The full public state: numbers, statuses, who may act, and the turn timer. */
    applySync(s) {
        this.lastSync = s;
        this.current = s.current;
        this.setTurn(!this.spectator && s.current === this.ident);
        this.sign.setActive(this.yourTurn);
        for (const ident of [1, 2]) {
            const side = this.sideByIdent(ident);
            const info = s.heroes && s.heroes[ident];
            if (info) {
                side.hero.setInfo(info);
                const mine = side.isPlayer && !this.spectator;
                side.hero.setReady(!this.ended && !!info.canAttack && (mine || (this.spectator && s.current === ident)));
                if (mine) {
                    const power = this.heroPower;
                    this.ui.setPower(power && !this.ended ? {
                        ...power,
                        canUse: !!info.canUsePower && this.yourTurn,
                        used: !!info.heroPowerUsed,
                    } : null);
                }
            }
            this.reconcileBoard(side, (s.board && s.board[ident]) || [], ident);
        }
        if (typeof s.turnEndsIn === 'number' && !this.ended) {
            this.ui.setTimer(performance.now() + s.turnEndsIn, s.turnTime || 75000, this.yourTurn);
        }
    }

    reconcileBoard(side, cards, ident) {
        const seen = new Set();
        for (const data of cards) {
            seen.add(data.cid);
            let card = side.board.get(data.cid);
            if (!card) {
                if (this.dying.has(data.cid)) continue;
                const inHand = side.hand.get(data.cid);
                if (inHand) {
                    side.hand.delete(data.cid);
                    inHand.dispose();
                }
                card = this.addBoardCard(side, data);
            } else {
                card.setData(data);
            }
            const mine = side.isPlayer && !this.spectator;
            card.setReady(!this.ended && !!data.canAct && (mine ? this.yourTurn : this.spectator && this.current === ident));
        }
        for (const [cid, card] of side.board) {
            if (!seen.has(cid) && !card.dying && !card.pending) {
                side.board.delete(cid);
                card.dispose();
            }
        }
    }

    // ---- Events ---------------------------------------------------------------------------------------------------

    /** Plays the events of one action in order (see docs/game-protocol.md). */
    async playEvents(events) {
        let fight = null;
        for (const e of events) {
            switch (e.t) {
                case 'attack': fight = await this.fightStart(e); break;
                case 'damage': this.showDamage(e); await wait(fight ? 80 : 260); break;
                case 'heal': this.showHeal(e); await wait(220); break;
                case 'armor': this.showArmor(e); await wait(260); break;
                case 'buff': this.showBuff(e); await wait(260); break;
                case 'lifesteal': await this.showLifesteal(e); break;
                case 'blessing': this.showBlessing(e); await wait(220); break;
                case 'ability': await this.showAbility(e); break;
                case 'heroPower': await this.showHeroPower(e); break;
                case 'paralyze': this.showParalyze(e); await wait(260); break;
                case 'summon': await this.showSummon(e); break;
                case 'death': this.showDeath(e); await wait(260); break;
                case 'curse': await this.showCurse(e); break;
                case 'haunt': this.showHaunt(e); await wait(300); break;
                case 'burned': await this.showBurned(e); break;
                case 'fatigue': this.showFatigue(e); await wait(320); break;
                case 'timeout': this.ui.screenMessage(`${this.heroOf(e.id).info.name} ran out of time!`); break;
                case 'heroDeath': this.heroDeath(this.heroOf(e.id)); break;
                case 'log': this.ui.logLine(e.text); break;
                default: break;
            }
        }
        if (fight) await fight.finish();
    }

    /** An attack: the attacker winds up and strikes; resolves at the moment of impact. */
    async fightStart(e) {
        const attacker = this.resolve(e.src);
        const defender = this.resolve(e.dst);
        if (!attacker || !defender) return null;
        sound.play('ATTACK', 0.5);
        const target = this.targetPoint(defender);
        if (attacker instanceof Hero3D) {
            tweens.to(attacker.body.scale, { x: 1.12, y: 1.12, z: 1.12 }, 200, Ease.backOut);
            if (defender instanceof Hero3D) defender.flash(4);
            this.effects.beam(attacker.position.clone(), target, 0xffd34d, 900);
            await wait(320);
            tweens.to(attacker.body.scale, { x: 1, y: 1, z: 1 }, 250, Ease.quadOut);
            this.impact(defender, target);
            return { finish: () => wait(300) };
        }
        const home = this.boardPose(this.sideOf(attacker), attacker);
        const dir = target.clone().sub(home.position);
        const windup = home.position.clone().addScaledVector(dir.clone().normalize(), -40).setY(150);
        const lean = FLAT_FACE_UP.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dir.z < 0 ? 0.5 : -0.5, 0, 0)));
        await attacker.moveTo({ position: windup, quaternion: lean, scale: 1.25 }, 380, Ease.quadOut);
        const hit = home.position.clone().lerp(target, 0.8).setY(defender instanceof Hero3D ? target.y : 40);
        await attacker.moveTo({ position: hit, quaternion: FLAT_FACE_UP.clone(), scale: 1.1 }, 190, Ease.quadIn);
        this.impact(defender, hit);
        return {
            finish: async () => {
                await wait(180);
                if (!attacker.dying && this.sideOf(attacker).board.get(attacker.cid) === attacker) await attacker.moveTo(home, 320, Ease.cubicOut);
            },
        };
    }

    impact(defender, point) {
        sound.play('DEFEND', 0.5);
        this.effects.shake(defender instanceof Hero3D ? 22 : 14);
        this.cheer(defender instanceof Hero3D ? 0.55 : 0.35);
        this.effects.shockwave(defender instanceof Hero3D ? defender.podium.position : point.clone(), defender instanceof Hero3D ? 0xff6a3a : 0xffd27a, defender instanceof Hero3D ? 380 : 200);
        this.effects.burst(point, { color: 0xffa040, count: 36, speed: 320, size: 42, life: 650 });
    }

    textAbove(obj, text, color, size = 90) {
        const point = this.targetPoint(obj);
        this.effects.floatText(text, point.setY(point.y + 40), color, size);
    }

    showDamage(e) {
        const target = this.resolve(e.to);
        if (!target) return;
        if (target instanceof Hero3D) {
            target.setInfo({ health: String(e.health), armor: e.armor });
            if (e.amount > 0) {
                target.flash(2);
                this.arena.screenFlash(`-${e.amount}`);
                this.stage.punch(4 + Math.min(6, e.amount));
                if (e.amount >= 5) this.flameJets(0.8, 2);
            }
        } else {
            target.setData({ health: e.health, armor: e.armor });
            if (!target.dying) this.shakeCard(target);
        }
        if (e.amount > 0) this.textAbove(target, `-${e.amount}`, '#ff4136');
        if (e.armorLost > 0) {
            const point = this.targetPoint(target);
            this.effects.floatText(`◆-${e.armorLost}`, point.setY(point.y + 140), '#9fc3ff', 60);
            this.effects.burst(this.targetPoint(target), { color: 0xc8d6e5, count: 14, speed: 220, size: 26, life: 450 });
        }
    }

    showHeal(e) {
        const target = this.resolve(e.to);
        if (!target || !(e.amount > 0)) return;
        if (target instanceof Hero3D) target.setInfo({ health: String(e.health) });
        else target.setData({ health: e.health });
        sound.play('ABILITY_HEAL', 0.2);
        this.effects.sparkle(this.targetPoint(target));
        this.textAbove(target, `+${e.amount}`, '#4cd328');
    }

    showArmor(e) {
        const target = this.resolve(e.to);
        if (!target) return;
        if (target instanceof Hero3D) target.setInfo({ armor: e.armor });
        else target.setData({ armor: e.armor });
        this.effects.shockwave(target instanceof Hero3D ? target.podium.position : target.position, 0xc0c8d0, 200);
        this.effects.sparkle(this.targetPoint(target), 0xd9e2ec, 24);
        this.textAbove(target, `+${e.amount}◆`, '#9fc3ff', 70);
    }

    showBuff(e) {
        const target = this.resolve(e.to);
        if (!target) return;
        if (target instanceof Hero3D) {
            target.setInfo({ attack: String(e.attack), health: String(e.health), maxHealth: e.maxHealth, armor: e.armor });
            target.flash(2, 0xc77dff);
        } else {
            target.setData({ attack: e.attack, health: e.health, maxHealth: e.maxHealth, armor: e.armor });
            this.pulse(target);
        }
        this.effects.sparkle(this.targetPoint(target), 0xc77dff, 50);
    }

    async showLifesteal(e) {
        const source = this.resolve(e.src);
        const hero = this.resolve(e.to);
        if (!hero) return;
        if (source) await this.effects.projectile(this.targetPoint(source), this.targetPoint(hero), 0xd0104a, 380, 34);
        hero.setInfo({ health: String(e.health) });
        this.textAbove(hero, `+${e.amount}`, '#4cd328', 70);
    }

    showBlessing(e) {
        const card = this.cardByCid(e.cid);
        if (card) this.effects.lightPillar(card.position, 0xfff1a8, 1400);
        const hero = this.resolve(e.to);
        if (hero) this.effects.sparkle(this.targetPoint(hero), 0xfff1a8, 30);
    }

    async showAbility(e) {
        const source = this.resolve(e.src);
        const target = this.resolve(e.dst);
        const ability = this.rules.abilities[e.abilityId];
        const color = ABILITY_COLORS[e.abilityId] ?? 0xffffff;
        if (source && ability) this.textAbove(source, ability.name, '#ffd98a', 55);
        if (!source || !target) return;
        const from = this.targetPoint(source);
        const to = this.targetPoint(target);
        switch (e.abilityId) {
            case 2: { // Sacrifice: the card flies into its target
                sound.play('ABILITY_SACRIFICE', 0.3);
                source.dying = true;
                await source.moveTo({ position: to.clone().setY(to.y + 60), quaternion: FLAT_FACE_UP.clone(), scale: 0.4 }, 650, Ease.quadIn, { arc: 160 });
                return;
            }
            case 8: // Burn: a fireball
                await this.effects.projectile(from, to, color, 480, 54);
                this.flameJets(0.5, 1);
                return;
            case 5: // Paralyze: an ice bolt
                await this.effects.projectile(from, to, color, 420, 40);
                return;
            default:
                if (e.abilityId === 1) sound.play('ABILITY_HEAL', 0.2);
                this.effects.beam(from, to, color, 700);
                await wait(260);
        }
    }

    async showHeroPower(e) {
        const hero = this.heroOf(e.id);
        const target = this.resolve(e.dst);
        const color = POWER_COLORS[e.power] ?? 0xffd34d;
        this.textAbove(hero, e.name || 'Hero power', '#ffd98a', 60);
        tweens.to(hero.body.scale, { x: 1.12, y: 1.12, z: 1.12 }, 180, Ease.backOut).then(() => tweens.to(hero.body.scale, { x: 1, y: 1, z: 1 }, 250, Ease.quadOut));
        if (!target || target === hero) {
            this.effects.shockwave(hero.podium.position, color, 260);
            this.effects.sparkle(this.targetPoint(hero), color, 40);
            await wait(300);
            return;
        }
        await this.effects.projectile(this.targetPoint(hero), this.targetPoint(target), color, 450, 44);
    }

    showParalyze(e) {
        const card = this.cardByCid(e.cid);
        if (!card) return;
        card.setData({ paralyzed: !!e.on });
        this.effects.burst(card.center(), { color: 0xbfe0ff, count: 40, speed: 200, size: 34, life: 800, gravity: 200 });
    }

    async showSummon(e) {
        const side = this.sideByIdent(e.owner);
        if (side.board.has(e.card.cid)) return;
        const card = this.addBoardCard(side, e.card);
        const pose = this.boardPose(side, card);
        card.setPose({ ...pose, scale: 0.01 });
        this.effects.lightPillar(card.position, 0x9b59b6, 1200);
        this.effects.burst(card.position.clone().setY(20), { color: 0x9b59b6, count: 30, speed: 180, size: 36, life: 700 });
        await card.moveTo(pose, 420, Ease.backOut);
    }

    showDeath(e) {
        const side = this.sideByIdent(e.owner);
        const card = side.board.get(e.cid) || this.cardByCid(e.cid);
        if (!card) return;
        side.board.delete(e.cid);
        this.dying.set(e.cid, card);
        this.killCard(card);
    }

    async showCurse(e) {
        const source = this.cardByCid(e.src);
        const target = this.resolve(e.dst);
        if (!target) return;
        const from = source ? source.center() : this.heroOf(e.owner).position.clone();
        await this.effects.projectile(from, this.targetPoint(target), 0x8e44ad, 520, 48);
    }

    showHaunt(e) {
        const card = this.cardByCid(e.cid);
        if (!card) return;
        this.effects.sparkle(card.center(), 0xb39ddb, 40);
        this.textAbove(card, 'Haunt!', '#d1c4e9', 60);
    }

    /** A drawn card with a full hand: shown big, then it burns. */
    async showBurned(e) {
        const side = this.sideByIdent(e.owner);
        const card = this.createCard(side, e.card, true);
        card.castsShadow = false;
        card.setPose({ ...this.stage.hudPose(960, 520, HOVER_LIFT, 2.2) });
        this.ui.screenMessage(`${e.card.name} burns, the hand is full!`);
        await wait(900);
        card.setGlow(0xff5a1a, 1);
        await tweens.run(600, t => { card.setOpacity(1 - t); card.body.rotation.z = t * 0.4; }, Ease.quadIn);
        card.dispose();
    }

    showFatigue(e) {
        const hero = this.heroOf(e.id);
        hero.flash(3, 0x8e44ad);
        this.textAbove(hero, `Fatigue ${e.amount}`, '#c39bd3', 60);
    }

    /** Start of a new match: VS splash, heroes enter in columns of light, fireworks and a wave. */
    kickOff() {
        this.ui.showVersus(this.player.hero.info, this.opponent.hero.info);
        this.cheer(1);
        this.arena.wave();
        tweens.wait(700).then(() => {
            for (const side of [this.player, this.opponent]) {
                this.effects.lightPillar(side.hero.podium.position, side.isPlayer ? 0x8fd3ff : 0xff9a8f);
            }
            this.flameJets(1);
            this.celebrate(6);
        });
    }

    /** Fire from the torches on the gate towers (all of them, or `count` at random). */
    flameJets(strength = 1, count = 4) {
        const all = this.arena.torches;
        const first = Math.floor(Math.random() * all.length);
        const torches = [...all.slice(first), ...all.slice(0, first)].slice(0, count);
        torches.forEach((t, i) => tweens.wait(i * 90).then(() => this.effects.flameJet(t, strength)));
        this.crowd.boom(0.5 * strength);
    }

    /** Fireworks over the stadium with a boom for each. */
    celebrate(count, colors) {
        this.effects.fireworks(count, colors, () => this.crowd.boom(0.6));
    }

    /** The crowd reacts (0..1): jumping spectators and a roar. */
    cheer(strength) {
        this.arena.cheer(strength);
        this.crowd.cheer(strength);
    }

    shakeCard(card) {
        card.setGlow(0xff3b30, 0.9);
        tweens.run(500, t => { card.body.position.x = Math.sin(t * Math.PI * 10) * 10 * (1 - t); }, Ease.linear)
            .then(() => { card.body.position.x = 0; if (!card.dying) card.setGlow(null, 0); });
    }

    killCard(card) {
        if (card.killed) return;
        card.killed = card.dying = true;
        card.setReady(false);
        card.setGlow(0xff2020, 1);
        this.cheer(0.6);
        this.arena.screenFlash('KO!');
        this.flameJets(0.7, 2);
        this.effects.burst(card.center(), { color: 0x9b59b6, count: 60, speed: 220, size: 46, life: 1100, gravity: 120 });
        const start = card.position.clone();
        tweens.run(900, t => {
            card.position.y = start.y + t * 60;
            card.body.rotation.z = t * 0.6;
            card.setOpacity(1 - t);
            card.scale.setScalar(Math.max(0.01, card.scale.x * 0.98));
        }, Ease.quadIn, 150).then(() => {
            if (this.dying.get(card.cid) === card) this.dying.delete(card.cid);
            card.dispose();
        });
    }

    heroDeath(hero) {
        if (hero.dead) return;
        hero.dead = true;
        tweens.run(1200, t => { hero.body.rotation.z = t * 0.35; hero.body.position.y = -t * 40; }, Ease.quadIn);
        this.effects.burst(hero.position.clone(), { color: 0xff5030, count: 120, speed: 380, size: 56, life: 1500 });
        this.effects.shake(30);
    }

    pulse(card) {
        card.setGlow(0xc77dff, 1);
        tweens.to(card.body.scale, { x: 1.2, y: 1.2, z: 1.2 }, 180, Ease.quadOut)
            .then(() => tweens.to(card.body.scale, { x: 1, y: 1, z: 1 }, 400, Ease.elasticOut))
            .then(() => card.setGlow(null, 0));
    }

    // ---- End of the game ------------------------------------------------------------------------------------------

    stopPlaying() {
        this.ended = true;
        this.active = false;
        this.effects.hideArrow();
        this.showSlots(false);
        this.sign.visible = false;
        this.ui.hideTimer();
        this.ui.setPower(null);
        this.ui.hideTooltip();
        for (const side of [this.player, this.opponent]) {
            side.hero.setReady(false);
            for (const card of side.board.values()) card.setReady(false);
        }
        for (const card of [...this.player.hand.values(), ...this.opponent.hand.values()]) {
            tweens.run(800, t => card.setOpacity(1 - t), Ease.quadIn);
        }
    }

    onEnd(text, p) {
        this.stopPlaying();
        this.clearInGame();
        this.cheer(1);
        this.arena.screenFlash(text.replace('!', '').toUpperCase());
        this.arena.wave();
        if (text === 'Victory!') {
            this.flameJets(1.4);
            this.celebrate(14);
            this.effects.burst(this.opponent.hero.position.clone(), { color: 0xffd700, count: 200, speed: 500, size: 60, life: 2000 });
        } else {
            this.celebrate(text === 'Draw!' ? 6 : 3, text === 'Draw!' ? undefined : [0xff4d4d, 0x9b59b6]);
        }
        this.ui.showEnd(text, p || {});
    }

    onSpectateEnd(p) {
        this.stopPlaying();
        this.cheer(1);
        this.arena.wave();
        this.celebrate(10);
        const winner = p.winner ? this.heroOf(p.winner).info.name : null;
        const text = winner ? `${winner} wins!` : 'Draw!';
        this.arena.screenFlash(winner ? 'WINNER' : 'DRAW');
        this.ui.showEnd(text, { statistics: p.statistics }, { redirect: false, detail: this.mode === 'replay' ? 'End of the replay' : null });
    }

    leave() {
        if (this.gameSocket && this.mode === 'watch') this.gameSocket.send(Request.STOP_SPECTATING);
        window.location.href = '/Game';
    }

    onGameClosed(e) {
        if (this.ended) return;
        const reason = (e && e.reason) || '';
        if (/another window/i.test(reason)) {
            this.ui.showQueue('You opened the game in another window.');
            return;
        }
        if (this.reconnects++ < 5) {
            this.ui.screenMessage('Connection lost, reconnecting...');
            setTimeout(() => {
                this.gameSocket.connect();
                if (!this.spectator) this.chatSocket.connect();
                this.login();
            }, 1500 * this.reconnects);
        } else {
            this.ui.showQueue('Connection lost. Reload the page to continue.');
        }
    }

    // ---- Spectating and replays -----------------------------------------------------------------------------------

    async onLiveGames(p) {
        const games = (p && p.games) || [];
        const picked = await this.ui.showLiveGames(games, () => this.gameSocket.send(Request.LIST_LIVE_GAMES));
        if (picked === null) window.location.href = '/Game';
        else if (picked !== undefined) this.spectate(picked);
    }

    /** Plays a recorded game: the spectator messages with their original timing (long pauses shortened). */
    async playReplay() {
        this.ui.showQueue('Loading the replay...');
        let records;
        try {
            const response = await fetch(this.config.replayUrl, { credentials: 'same-origin' });
            records = await response.json();
        } catch (err) {
            this.ui.showQueue('The replay could not be loaded.');
            return;
        }
        const state = { playing: true, speed: 1 };
        this.replay = state;
        this.ui.showReplay({
            onToggle: () => (state.playing = !state.playing),
            onSpeed: speed => { state.speed = speed; },
            onRestart: () => window.location.reload(),
        });
        const total = records.length ? Math.max(1, records[records.length - 1].t) : 1;
        let clock = 0;
        for (const record of records) {
            let gap = Math.min(2500, Math.max(0, record.t - clock));
            clock = record.t;
            while (gap > 0 || !state.playing) {
                await wait(50);
                if (state.playing) gap -= 50 * state.speed;
            }
            await this.enqueue(record.m);
            this.ui.setReplayProgress(record.t / total);
        }
    }

    // ---- Hero power targeting -------------------------------------------------------------------------------------

    /** Screen position for the hero power button: beside the player's hero. */
    powerAnchor() {
        const hero = this.player.hero;
        const center = this.stage.toScreen(hero.position);
        const edge = this.stage.toScreen(hero.position.clone().addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.stage.camera.quaternion), 170 * hero.scale.x));
        return { x: edge.x + 70, y: center.y };
    }

    // ---- Chat -----------------------------------------------------------------------------------------------------

    onChatMessage(m) {
        const p = m.Payload;
        switch (m.Type) {
            case Response.CHAT_ROOM_MADE:
                this.ui.chatLine(`[${p.name}]: ${p.message}`);
                this.chatRoom = p.chRoomId;
                break;
            case Response.CHAT_MESSAGE:
                this.ui.chatLine(`[${p.name}]: ${p.message}`);
                sound.play('CHAT_MESSAGE', 0.5);
                break;
            case Response.CHAT_CLIENT_DISCONNECT:
                this.ui.chatLine(`[SERVER]: ${p}`);
                break;
            case Response.CHAT_CLIENT_CONNECT:
                this.ui.chatLine(`[SERVER]: Player ${p.name} connected!`);
                this.chatRoom = p.room;
                this.chatSocket.send(Request.CHAT_LIST, { room: p.room });
                break;
            case Response.CHAT_LIST_MEMBERS:
                this.ui.chatMembersList(Object.values(p || {}));
                break;
            default:
                break;
        }
    }

    sendChat(text) {
        if (this.chatRoom === null || this.chatRoom === undefined) {
            this.ui.chatLine('[SERVER]: The chat opens when the game starts.');
            return;
        }
        this.chatSocket.send(Request.CHAT_MESSAGE, { room: this.chatRoom, message: text });
        this.chatSocket.send(Request.CHAT_LIST, { room: this.chatRoom });
    }

    // ---- Resume after switching between the classic and the 3D client (see /js/game-mode.js) ---------------------

    markInGame() {
        if (window.SoulsGameMode) window.SoulsGameMode.markInGame(this.normalGame);
    }

    clearInGame() {
        if (window.SoulsGameMode) window.SoulsGameMode.clearInGame();
    }

    update(now, dt) {
        this.arena.scoreboard = this.active || this.ended
            ? { player: this.player.hero.info, opponent: this.opponent.hero.info }
            : null;
        // Heroes move between their classic spot and their podium as the stadium rises, always facing the camera.
        const rise = this.arena.rise;
        const blend = rise * rise * (3 - 2 * rise);
        for (const side of [this.player, this.opponent]) {
            const hero = side.hero;
            const a = hero.anchorPose;
            // The medallion stands on the podium (44 high); 125 is half its height at scale 1.
            const onPodium = hero.podium.position.clone().setY(56 + 125 * (hero.viewScale ?? 0.85));
            hero.position.lerpVectors(a.position, onPodium, blend);
            const viewScale = side.isPlayer ? (this.stage.viewInfo.playerHero ?? 0.85) : 0.85;
            hero.viewScale = (hero.viewScale ?? viewScale) + (viewScale - (hero.viewScale ?? viewScale)) * Math.min(1, dt / 300);
            hero.scale.setScalar(a.scale + (hero.viewScale - a.scale) * blend);
            hero.quaternion.copy(this.stage.camera.quaternion);
            hero.podium.scale.y = Math.max(0.001, blend);
            hero.podium.visible = blend > 0.001;
            hero.update(now);
        }
        // Board cards stand up to face the camera in the low views; ready cards breathe.
        this.tilt += (this.stage.viewInfo.cardTilt - this.tilt) * Math.min(1, dt / 250);
        for (const side of [this.player, this.opponent]) {
            for (const card of side.board.values()) {
                card.setTilt(this.tilt);
                card.pulse(now);
            }
        }
        // HTML overlays that follow the 3D scene: the turn timer under the End Turn sign, the hero power button.
        const sign = this.stage.classicToScreen(1610, this.spectator ? 520 : 600);
        this.ui.updateTimer(now, sign.x, sign.y);
        if (this.active && !this.spectator) {
            const anchor = this.powerAnchor();
            this.ui.placePower(anchor.x, anchor.y);
        }
    }
}
