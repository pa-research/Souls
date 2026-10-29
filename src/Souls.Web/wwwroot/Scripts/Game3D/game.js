// Game controller of the 3D client. It speaks the same protocol as the classic client (so classic and 3D players
// can play each other) and mirrors the classic GameService handlers, with 3D layout and animations.
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
    constructor({ stage, ui, effects, arena, crowd, config, normalGame }) {
        this.stage = stage;
        this.ui = ui;
        this.effects = effects;
        this.arena = arena;
        this.crowd = crowd;
        this.tilt = 0;
        this.normalGame = normalGame;
        this.portraits = Object.fromEntries(config.cards.map(c => [c.id, c.portrait]));
        this.active = false; // a game is running
        this.ended = false;
        this.yourTurn = false;
        this.gameId = null;
        this.chatRoom = null;
        this.hovered = null;
        this.reconnects = 0;

        this.root = new THREE.Group();
        this.root.name = 'game';
        this.root.visible = false;
        stage.scene.add(this.root);

        this.player = new Side(true);
        this.opponent = new Side(false);
        for (const side of [this.player, this.opponent]) this.root.add(side.hero, side.hero.podium);

        // The End Turn sign and the hand cards are HUD: they stay put on screen in every camera view.
        this.sign = new EndTurnSign();
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

        const wsBase = config.wsBase.startsWith('/')
            ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${config.wsBase}`
            : config.wsBase;
        this.gameSocket = new Socket(`${wsBase}/game`, m => this.onGameMessage(m), e => this.onGameClosed(e));
        this.chatSocket = new Socket(`${wsBase}/chat`, m => this.onChatMessage(m), () => { });
        ui.onChat = text => this.sendChat(text);

        // Keeps the sliding login cookie alive while playing (classic: /Player/KeepAlive every minute).
        setInterval(() => fetch('/Player/KeepAlive', { credentials: 'same-origin' }).catch(() => { }), 60000);
    }

    start() {
        this.ui.showQueue('Connecting...');
        this.gameSocket.connect();
        this.chatSocket.connect();
        this.login();
    }

    login() {
        this.gameSocket.send(Request.LOGIN);
        this.gameSocket.send(this.normalGame ? Request.QUEUE_NORMAL : Request.QUEUE_PRACTICE);
    }

    // ---- Layout -------------------------------------------------------------------------------------------------

    handPose(side, index, hovered = false) {
        const y = side.isPlayer ? PLAYER_HAND_Y : OPPONENT_HAND_Y;
        const x = HAND_X + HAND_SPACING * index;
        if (hovered) return this.stage.hudPose(x, y - 120, HOVER_LIFT, 2.2);
        const pose = this.stage.hudPose(x, y, HAND_LIFT + index * 0.004);
        if (!side.isPlayer) pose.quaternion.multiply(TURN_AROUND);
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
            const pose = this.handPose(side, index, card === this.hovered);
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
            const card = this.createCard(side, data, true);
            card.castsShadow = false;
            side.hand.set(card.cid, card);
            // Deal from the right edge of the screen, flipping into place.
            const start = this.stage.hudPose(2080, side.isPlayer ? PLAYER_HAND_Y : OPPONENT_HAND_Y, HAND_LIFT);
            if (side.isPlayer) start.quaternion.multiply(TURN_AROUND);
            card.setPose(start);
            tweens.wait(deal ? k * 120 : 0).then(() => {
                if (side.hand.get(card.cid) !== card || card.dragging || card.pending || card.opponentDragging) return;
                card.moveTo(this.handPose(side, [...side.hand.keys()].indexOf(card.cid), card === this.hovered), 650, Ease.cubicOut);
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
            const pose = this.handPose(side, cards.indexOf(c), c === card);
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

    // ---- Requests (called by the interaction layer) ---------------------------------------------------------------

    pickUp(card) {
        this.setHovered(null);
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
        }, 5000);
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

    useAbility(source, target) {
        let type = 0;
        if (target === this.player.hero) type = 1;
        else if (target === this.opponent.hero) type = 2;
        this.gameSocket.send(Request.USE_ABILITY, {
            source: source.cid,
            target: type === 0 ? target.cid : -1,
            type,
            abilityId: source.abilityId ?? -1337,
        });
    }

    endTurn() {
        if (!this.yourTurn || this.ended) return;
        this.yourTurn = false;
        this.sign.spin().then(() => this.sign.setActive(false));
        this.ui.setTurn(false);
        this.gameSocket.send(Request.NEXT_TURN);
    }

    // ---- Server messages ------------------------------------------------------------------------------------------

    onGameMessage(m) {
        const p = m.Payload;
        switch (m.Type) {
            case Response.LOGIN_OK:
                this.reconnects = 0;
                this.chatSocket.send(Request.LOGIN);
                if (!this.active) this.ui.setStatus('Connection established!');
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
                this.ui.setStatus('Waiting for Match');
                break;
            case Response.QUEUE_ALREADY_IN:
                this.ui.setStatus('You are already in queue!');
                break;
            case Response.GAME_CREATE:
            case Response.RECOVER:
                this.onCreate(p);
                break;
            case Response.OPPONENT_MOVE:
                this.onOpponentMove(p);
                break;
            case Response.RELEASE:
            case Response.OPPONENT_RELEASE:
                this.onRelease(m.Type === Response.RELEASE ? this.player : this.opponent, p.cid);
                break;
            case Response.USECARD_OK:
            case Response.OPPONENT_USECARD_OK:
                this.onUseCard(m.Type === Response.USECARD_OK ? this.player : this.opponent, p);
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
            case Response.ATTACK:
                this.onAttack(p);
                break;
            case Response.NEXT_TURN:
                this.onNextTurn(p);
                break;
            case Response.NEWCARD:
                this.addHandCards(this.player, p.card);
                break;
            case Response.OPPONENT_NEWCARD:
                this.addHandCards(this.opponent, p.card);
                break;
            case Response.VICTORY:
                this.onEnd('Victory!', p);
                break;
            case Response.DEFEAT:
                this.onEnd('Defeat!', p);
                break;
            case Response.DRAW:
                this.onEnd('Draw!', p);
                break;
            case Response.USE_ABILITY:
                this.onAbility(p);
                break;
            case Response.ERROR:
                if (typeof p === 'string') this.ui.screenMessage(p);
                break;
            default:
                break;
        }
    }

    onCreate(p) {
        this.clearCards();
        this.gameId = p.gameId;
        this.ident = p.ident;
        this.ended = false;
        this.player.hero.setInfo(p.player.info);
        this.opponent.hero.setInfo(p.opponent.info);
        this.player.hero.previewCost(null);
        this.opponent.hero.previewCost(null);
        for (const data of Object.values(p.player.board || {})) this.addBoardCard(this.player, data);
        for (const data of Object.values(p.opponent.board || {})) this.addBoardCard(this.opponent, data);
        this.addHandCards(this.player, Object.values(p.player.hand || {}), { deal: true });
        this.addHandCards(this.opponent, p.opponent.hand || [], { deal: true });

        // The first player creates the game's chat room.
        if (p.ident === 1 && p.create) this.chatSocket.send(Request.CHAT_NEWGAMEROOM);
        if (p.create) this.kickOff();

        this.setTurn(p.yourTurn);
        this.sign.setActive(p.yourTurn);
        this.root.visible = true;
        this.stage.leaveMenu();
        this.active = true;
        sound.stopMusic();
        sound.playMusic('GAME_MUSIC', 0.1);
        this.ui.hideQueue();
        this.markInGame();
    }

    setTurn(yourTurn) {
        this.yourTurn = !!yourTurn;
        this.ui.setTurn(this.yourTurn);
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
        card.moveTo(this.boardPose(side, card), side.isPlayer ? 380 : 750, Ease.cubicOut, { arc: side.isPlayer ? 40 : 220 }).then(() => {
            sound.play('CARD_MOUNT', 0.5);
            this.effects.burst(card.position.clone().setY(8), { color: 0xd9b26f, count: 26, speed: 160, size: 34, life: 600, gravity: -300, up: 0.3 });
            this.effects.shockwave(card.position, side.isPlayer ? 0x8fd3ff : 0xff9a8f, 220);
            this.effects.shake(5);
            this.cheer(0.2);
        });
    }

    onNextTurn(p) {
        this.opponent.hero.setInfo(p.opponentInfo);
        this.player.hero.setInfo(p.playerInfo);
        this.setTurn(p.yourTurn);
        if (p.yourTurn) {
            this.sign.spin().then(() => this.sign.setActive(true));
            this.ui.screenMessage('Your turn!');
        } else {
            this.sign.setActive(false);
        }
    }

    /** Resolves the actors of an attack like the classic GameService.Response_Attack. */
    onAttack(p) {
        const me = p.player, them = p.opponent;
        const iAttack = !!me.attacker;
        const playerCard = me.cid !== undefined ? this.player.board.get(me.cid) : null;
        const opponentCard = them.cid !== undefined ? this.opponent.board.get(them.cid) : null;
        let attacker, defender;
        switch (p.type) {
            case 0: attacker = iAttack ? playerCard : opponentCard; defender = iAttack ? opponentCard : playerCard; break;
            case 1: attacker = iAttack ? playerCard : opponentCard; defender = iAttack ? this.opponent.hero : this.player.hero; break;
            case 2: attacker = iAttack ? this.player.hero : this.opponent.hero; defender = iAttack ? opponentCard : playerCard; break;
            case 3: attacker = iAttack ? this.player.hero : this.opponent.hero; defender = iAttack ? this.opponent.hero : this.player.hero; break;
            default: return;
        }
        if (!attacker || !defender) return;
        const attackerInfo = iAttack ? me : them;
        const defenderInfo = iAttack ? them : me;
        // Dead cards leave the board at once so they can no longer be targeted; the animation finishes the job.
        for (const [obj, info] of [[attacker, attackerInfo], [defender, defenderInfo]]) {
            if (obj instanceof Card3D && info.isDead) {
                obj.isDead = true;
                (obj.owner === 'player' ? this.player : this.opponent).board.delete(obj.cid);
            }
        }
        if (attacker instanceof Hero3D) this.animateHeroAttack(attacker, defender, attackerInfo, defenderInfo);
        else this.animateCardAttack(attacker, defender, attackerInfo, defenderInfo);
    }

    targetPoint(obj) {
        return obj instanceof Hero3D ? obj.position.clone() : obj.center();
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

    sideOf(card) {
        return card.owner === 'player' ? this.player : this.opponent;
    }

    async animateCardAttack(attacker, defender, attackerInfo, defenderInfo) {
        sound.play('ATTACK', 0.5);
        const home = this.boardPose(this.sideOf(attacker), attacker);
        const target = this.targetPoint(defender);
        const dir = target.clone().sub(home.position);
        const windup = home.position.clone().addScaledVector(dir.clone().normalize(), -40).setY(150);
        const lean = FLAT_FACE_UP.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dir.z < 0 ? 0.5 : -0.5, 0, 0)));
        await attacker.moveTo({ position: windup, quaternion: lean, scale: 1.25 }, 420, Ease.quadOut);
        const hit = home.position.clone().lerp(target, 0.8).setY(defender instanceof Hero3D ? target.y : 40);
        await attacker.moveTo({ position: hit, quaternion: FLAT_FACE_UP.clone(), scale: 1.1 }, 200, Ease.quadIn);
        this.impact(attacker, attackerInfo, defender, defenderInfo, hit);
        await tweens.wait(200);
        if (attacker.isDead) this.killCard(attacker);
        else await attacker.moveTo(home, 320, Ease.cubicOut);
    }

    async animateHeroAttack(attacker, defender, attackerInfo, defenderInfo) {
        sound.play('ATTACK', 0.5);
        tweens.to(attacker.body.scale, { x: 1.12, y: 1.12, z: 1.12 }, 200, Ease.backOut);
        const target = this.targetPoint(defender);
        if (defender instanceof Hero3D) defender.flash(4);
        await this.effects.beam(attacker.position.clone(), target, 0xffd34d, 1500);
        tweens.to(attacker.body.scale, { x: 1, y: 1, z: 1 }, 250, Ease.quadOut);
        this.impact(attacker, attackerInfo, defender, defenderInfo, target);
        if (attacker instanceof Card3D && attacker.isDead) this.killCard(attacker);
    }

    /** Applies the attack result to both sides: numbers, health, flashes, deaths. */
    impact(attacker, attackerInfo, defender, defenderInfo, point) {
        sound.play('DEFEND', 0.5);
        this.effects.shake(defender instanceof Hero3D ? 22 : 14);
        this.cheer(defender instanceof Hero3D ? 0.55 : 0.35);
        if (defender instanceof Hero3D && defenderInfo.dmgTaken > 0) {
            this.arena.screenFlash(`-${defenderInfo.dmgTaken}`);
            this.stage.punch(4 + Math.min(6, defenderInfo.dmgTaken));
            this.effects.shockwave(defender.podium.position, 0xff6a3a, 380);
            if (defenderInfo.dmgTaken >= 5) this.flameJets(0.8, 2);
        } else {
            this.effects.shockwave(point.clone(), 0xffd27a, 200);
        }
        this.effects.burst(point, { color: 0xffa040, count: 36, speed: 320, size: 42, life: 650 });
        for (const [obj, info] of [[defender, defenderInfo], [attacker, attackerInfo]]) {
            if (info.dmgTaken > 0) this.effects.floatText(`-${info.dmgTaken}`, this.targetPoint(obj).setY(this.targetPoint(obj).y + 40));
            obj.setStat('health', String(info.health));
            if (obj instanceof Hero3D) {
                if (info.dmgTaken > 0) obj.flash(2);
            } else if (obj === defender && !obj.isDead) {
                this.shakeCard(obj);
            }
        }
        if (defender instanceof Card3D && defender.isDead) this.killCard(defender);
        if (defender instanceof Hero3D && defenderInfo.isDead) this.heroDeath(defender);
    }

    shakeCard(card) {
        card.setGlow(0xff3b30, 0.9);
        tweens.run(500, t => { card.body.position.x = Math.sin(t * Math.PI * 10) * 10 * (1 - t); }, Ease.linear)
            .then(() => { card.body.position.x = 0; card.setGlow(null, 0); });
    }

    killCard(card) {
        if (card.dying) return;
        card.dying = true;
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
            card.scale.setScalar(1 - t * 0.3);
        }, Ease.quadIn, 150).then(() => card.dispose());
    }

    heroDeath(hero) {
        tweens.run(1200, t => { hero.body.rotation.z = t * 0.35; hero.body.position.y = -t * 40; }, Ease.quadIn);
        this.effects.burst(hero.position.clone(), { color: 0xff5030, count: 120, speed: 380, size: 56, life: 1500 });
        this.effects.shake(30);
    }

    onAbility(p) {
        const side = p.wasOpponent ? this.opponent : this.player;
        const source = side.board.get(p.source);
        if (p.abilityId === 1) { // Heal
            sound.play('ABILITY_HEAL', 0.2);
            let target = null;
            if (p.type === 0) target = side.board.get(p.target);
            else if (p.type === 1) target = side.hero;
            else if (p.type === 2) { this.ui.screenMessage('You cannot heal enemy player!!'); return; }
            if (!target) return;
            const before = Number(target instanceof Hero3D ? target.info.health : target.data.health) || 0;
            const after = Number(p.parameter);
            if (source) this.effects.beam(source.position.clone().setY(20), this.targetPoint(target), 0x6dff7a, 700);
            tweens.wait(500).then(() => {
                target.setStat('health', String(p.parameter));
                this.effects.sparkle(this.targetPoint(target));
                if (after > before) this.effects.floatText(`+${after - before}`, this.targetPoint(target).setY(this.targetPoint(target).y + 40), '#4cd328');
            });
        } else if (p.abilityId === 2) { // Sacrifice
            sound.play('ABILITY_SACRIFICE', 0.2);
            let target = null;
            if (p.type === 1) target = side.board.get(p.target);
            else if (p.type === 2) target = side.hero;
            if (!target) return;
            const [health, attack] = String(p.parameter).split(':');
            if (source) {
                side.board.delete(source.cid);
                source.isDead = true;
                const to = this.targetPoint(target);
                source.moveTo({ position: to.clone().setY(to.y + 60), quaternion: FLAT_FACE_UP.clone(), scale: 0.4 }, 650, Ease.quadIn, { arc: 160 })
                    .then(() => this.killCard(source));
            }
            tweens.wait(650).then(() => {
                target.setStat('health', health);
                if (attack !== undefined) target.setStat('attack', attack);
                this.effects.sparkle(this.targetPoint(target), 0xc77dff, 50);
                if (target instanceof Card3D) this.pulse(target);
            });
        }
    }

    pulse(card) {
        card.setGlow(0xc77dff, 1);
        tweens.to(card.body.scale, { x: 1.2, y: 1.2, z: 1.2 }, 180, Ease.quadOut)
            .then(() => tweens.to(card.body.scale, { x: 1, y: 1, z: 1 }, 400, Ease.elasticOut))
            .then(() => card.setGlow(null, 0));
    }

    onEnd(text, p) {
        this.ended = true;
        this.active = false;
        this.clearInGame();
        this.effects.hideArrow();
        this.showSlots(false);
        this.sign.visible = false;
        for (const card of [...this.player.hand.values(), ...this.opponent.hand.values()]) {
            tweens.run(800, t => card.setOpacity(1 - t), Ease.quadIn);
        }
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
        this.ui.showEnd(text, p && p.statistics);
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
                this.chatSocket.connect();
                this.login();
            }, 1500 * this.reconnects);
        } else {
            this.ui.showQueue('Connection lost. Reload the page to continue.');
        }
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
        // Board cards stand up to face the camera in the low views.
        this.tilt += (this.stage.viewInfo.cardTilt - this.tilt) * Math.min(1, dt / 250);
        for (const side of [this.player, this.opponent]) {
            for (const card of side.board.values()) card.setTilt(this.tilt);
        }
    }
}
