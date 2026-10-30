// Mouse / touch / keyboard input for the 3D client, following the classic controls:
//  - hover a hand card to zoom it (touch: tap or hold it), drag it onto a free slot to play it;
//  - drag from a spell to its target (an arrow aims from the hand), or a spell without a target anywhere over the
//    board; or click / tap the spell, then the target (or the board);
//  - drag from your card or hero to an enemy to attack;
//  - right-drag from your card (touch: hold it, then drag) to use its ability on a valid target;
//  - click / tap the hero power button, then click / tap a target;
//  - click / tap the End Turn sign;
//  - hover (touch: tap) a card or hero for its rules text.
// Camera: 1-4 pick a view; mouse wheel or pinch zooms; dragging the empty arena (right or middle mouse
// button, one finger) or two fingers orbit.
import { Card3D } from './cards.js';
import { Hero3D } from './heroes.js';
import { toClassic, VIEWS } from './scene.js';
import { ABILITY_COLORS } from './game.js';

const ATTACK_COLOR = 0xff3b30;
const POWER_COLOR = 0xffd34d;

const HAND_X = 165, HAND_SPACING = 60, HAND_TOP = 880;
const HOLD_MS = 320; // touch: hold a hand card to look at it
const ABILITY_HOLD_MS = 450; // hold a board card to switch to its ability
const DRAG_START = 10; // pixels before a press becomes a drag

export class Interaction {
    constructor(stage, game, effects) {
        this.stage = stage;
        this.game = game;
        this.effects = effects;
        this.mode = null; // null | 'card' | 'handPress' | 'arrow' | 'power' | 'orbit' | 'gesture'
        game.interaction = this;
        this.ndc = null;
        this.pointers = new Map(); // active pointers (several for multi-touch)
        const canvas = stage.renderer.domElement;
        canvas.addEventListener('pointerdown', e => this.onDown(e));
        window.addEventListener('pointermove', e => this.onMove(e));
        window.addEventListener('pointerup', e => this.onUp(e));
        window.addEventListener('pointercancel', () => this.cancel());
        // Right click is used for abilities and orbiting (classic: the context menu is blocked).
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (!game.active && !game.ended) return;
            stage.zoomBy(Math.exp(e.deltaY * 0.0012));
        }, { passive: false });
        window.addEventListener('keydown', e => {
            if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
            if (e.key === 'Escape') { this.cancel(); game.ui.hideTooltip(); return; }
            const view = Object.keys(VIEWS).find(k => VIEWS[k].key === e.key);
            if (view && game.active) stage.setView(view);
        });
    }

    /** The classic stage point under the pointer on the real board (live camera). */
    classicAt(ndc) {
        const hit = this.stage.pointerOnPlane(ndc, 0);
        return hit ? toClassic(hit) : null;
    }

    /** Hand cards are HUD laid out like the classic client, so hit-test them the classic way (60px slices). */
    handCardAt(ndc) {
        const classic = this.stage.classicAtScreen(ndc);
        const cards = [...this.game.player.hand.values()];
        if (!classic || cards.length === 0 || classic.y < HAND_TOP) return null;
        const left = HAND_X - 75;
        const right = HAND_X + HAND_SPACING * (cards.length - 1) + 75;
        if (classic.x < left || classic.x > right) return null;
        const card = cards[Math.min(cards.length - 1, Math.max(0, Math.floor((classic.x - left) / HAND_SPACING)))];
        return card.pending || card.dragging ? null : card;
    }

    pick(ndc, objects) {
        const meshes = [];
        for (const o of objects) meshes.push(...o.pickables);
        this.stage.raycaster.setFromCamera(ndc, this.stage.camera);
        const hit = this.stage.raycaster.intersectObjects(meshes, false)[0];
        if (!hit) return null;
        return hit.object.userData.card || hit.object.userData.hero || null;
    }

    overSign(ndc) {
        return this.game.sign.visible && this.stage.pickHud(ndc, [this.game.sign]).length > 0;
    }

    moved(e) {
        return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    }

    clearTimer() {
        clearTimeout(this.timer);
        this.timer = null;
    }

    // ---- Pointer events -------------------------------------------------------------------------------------------

    onDown(e) {
        if (this.mode === 'power') {
            // Hero power or spell armed: this press picks the target (anything else cancels).
            this.ndc = this.stage.ndc(e);
            const spell = this.spell;
            const target = e.button === 0 ? this.pick(this.ndc, this.powerTargets) : null;
            const onBoard = e.button === 0 && spell && !this.game.spellTargets(spell) && this.overBoard(this.ndc);
            this.endPower();
            if (spell && (target || onBoard)) this.game.cast(spell, target);
            else if (target && !spell) this.game.usePower(target);
            e.preventDefault();
            return;
        }
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            // A second finger: whatever the first one was doing becomes a pinch / two-finger orbit.
            this.abort();
            this.mode = 'gesture';
            this.gesture = this.measure();
            return;
        }
        if (this.pointers.size > 2 || this.mode) return;

        const game = this.game;
        const ndc = this.stage.ndc(e);
        this.ndc = ndc;
        this.primary = e.pointerId;
        this.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        // Event timestamps tell a tap from a hold even when the page is too busy to run timers on time.
        this.downAt = { x: e.clientX, y: e.clientY, stamp: e.timeStamp };
        this.last = { x: e.clientX, y: e.clientY };
        const left = e.button === 0, right = e.button === 2, middle = e.button === 1;

        if (middle) {
            this.mode = 'orbit';
            e.preventDefault();
            return;
        }

        if (game.canAct && left && this.overSign(ndc)) {
            game.endTurn();
            return;
        }

        // Hand card: drag it (touch: a tap or a hold shows it bigger first).
        const handCard = game.canAct && left ? this.handCardAt(ndc) : null;
        if (handCard) {
            this.card = handCard;
            e.preventDefault();
            if (this.touch) {
                this.mode = 'handPress';
                this.wasPreviewed = game.hovered === handCard;
                this.timer = setTimeout(() => {
                    if (this.mode === 'handPress' && this.card === handCard) { this.held = true; game.setHovered(handCard); }
                }, HOLD_MS);
            } else {
                this.startCardDrag();
            }
            return;
        }

        // Own board card or hero: attack (left) or ability (right, or hold a card) arrow.
        const own = game.canAct ? this.pick(ndc, [...game.player.board.values(), game.player.hero]) : null;
        const ability = own instanceof Card3D ? game.abilityOf(own) : null;
        if (own && (left || (right && ability))) {
            this.mode = 'arrow';
            this.source = own;
            this.ability = right;
            this.target = null;
            this.arrowShown = false;
            this.tapTarget = own;
            if (!right && ability) {
                this.timer = setTimeout(() => this.switchToAbility(), ABILITY_HOLD_MS);
            }
            e.preventDefault();
            return;
        }
        // A tap on anything else may be a tap to read a card or hero.
        this.tapTarget = this.inspectable(ndc);

        // Anything else: drag the arena to orbit the camera (and a tap closes a card preview).
        if (this.touch) game.setHovered(null);
        if (left || right) {
            this.mode = 'orbit';
            e.preventDefault();
        }
    }

    onMove(e) {
        const game = this.game;
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.mode === 'gesture') {
            if (this.pointers.size < 2) return;
            const now = this.measure();
            this.stage.orbitBy(now.x - this.gesture.x, now.y - this.gesture.y);
            if (this.gesture.d > 20 && now.d > 20) this.stage.zoomBy(this.gesture.d / now.d);
            this.gesture = now;
            return;
        }
        if (this.mode && e.pointerId !== this.primary) return;

        const ndc = this.stage.ndc(e);
        this.ndc = ndc;
        if (this.mode === 'orbit') {
            const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
            this.last = { x: e.clientX, y: e.clientY };
            if (this.moved(e) > 4) this.stage.orbitBy(dx, dy);
            return;
        }
        if (this.mode === 'handPress') {
            if (this.moved(e) > DRAG_START) this.startCardDrag();
            return;
        }
        if (this.mode === 'power') {
            this.updatePowerArrow();
            return;
        }
        if (!game.active) return;
        if (this.mode === 'card') {
            this.dragCard(performance.now());
        } else if (this.mode === 'arrow') {
            this.updateArrow(e);
        } else if (e.pointerType === 'mouse' && !this.mode) {
            // Idle mouse: zoom the hovered hand card, lift a hovered board card, explain what is under the pointer.
            game.setHovered(game.canAct ? this.handCardAt(ndc) : null);
            const own = game.hovered || !game.canAct ? null : this.pick(ndc, [...game.player.board.values(), game.player.hero]);
            this.setBoardHover(own instanceof Card3D ? own : null);
            this.stage.renderer.domElement.style.cursor = (game.hovered || own || (game.canAct && this.overSign(ndc))) ? 'pointer' : 'default';
            const rect = this.stage.renderer.domElement.getBoundingClientRect();
            game.inspect(game.hovered || this.inspectable(ndc), { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
    }

    onUp(e) {
        this.pointers.delete(e.pointerId);
        if (this.mode === 'gesture') {
            if (this.pointers.size === 0) this.mode = null;
            return;
        }
        if (e.pointerId !== this.primary) return;
        const game = this.game;
        this.clearTimer();
        const rect = this.stage.renderer.domElement.getBoundingClientRect();
        const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const tap = this.downAt && this.moved(e) < 8 && e.timeStamp - this.downAt.stamp < 600;
        if (this.mode === 'orbit') {
            this.mode = null;
            if (tap && this.touch) game.inspect(this.tapTarget, at);
        } else if (this.mode === 'handPress') {
            // A tap toggles the big preview; releasing a hold closes it.
            const card = this.card;
            this.mode = null;
            this.card = null;
            this.held = false;
            const show = tap && !this.wasPreviewed;
            game.setHovered(show ? card : null);
            game.inspect(show ? card : null, at);
            if (show && card.spell) this.beginSpell(card);
        } else if (this.mode === 'card') {
            const card = this.card;
            this.mode = null;
            this.card = null;
            // A spell without a target is cast by dropping it over the board.
            if (game.player.hand.get(card.cid) !== card) {
                // Already answered.
            } else if (card.spell && this.overBoard(this.ndc)) {
                game.cast(card, null);
            } else {
                game.drop(card, card.spell ? null : this.slot);
            }
            if (!card.dying) card.setGlow(null, 0);
            this.slot = null;
        } else if (this.mode === 'power' && this.spell && this.downAt && this.moved(e) > DRAG_START) {
            // Released after dragging a spell's arrow: cast it on what it points at (anywhere else puts it back).
            const spell = this.spell;
            const target = this.target;
            this.endPower();
            if (target) game.cast(spell, target);
        } else if (this.mode === 'arrow') {
            this.mode = null;
            this.effects.hideArrow();
            const target = this.target;
            this.setTarget(null);
            if (this.source instanceof Card3D && !this.source.dying) this.source.setGlow(null, 0);
            if (target && game.canAct) {
                if (this.ability) game.useAbility(this.source, target);
                else game.attack(this.source, target);
            } else if (tap && !this.arrowShown && this.touch) {
                game.inspect(this.tapTarget, at);
            }
            this.source = null;
        }
    }

    /** A card (revealed) or hero under the pointer, for the rules tooltip. */
    inspectable(ndc) {
        const game = this.game;
        if (!game.active && !game.ended) return null;
        const hand = this.handCardAt(ndc);
        if (hand) return hand;
        return this.pick(ndc, [...game.player.board.values(), ...game.opponent.board.values(), game.player.hero, game.opponent.hero]);
    }

    // ---- Hero power -----------------------------------------------------------------------------------------------

    /** The hero power button was pressed: the next click / tap on a valid target uses it. */
    beginPower(power) {
        this.abort();
        this.mode = 'power';
        this.powerTargets = this.game.candidates(power.targets);
        this.game.ui.setPowerArmed(true);
        this.game.ui.screenMessage(`${power.name}: pick a target`, false);
        this.target = null;
        if (this.ndc) this.updatePowerArrow();
    }

    /**
     * A spell armed like the hero power (tapped, clicked, or a targeted spell being dragged): the next press, or the
     * release of the drag, casts it on a target (or, without a target, on the board).
     */
    beginSpell(card) {
        const targets = this.game.spellTargets(card);
        this.mode = 'power';
        this.spell = card;
        this.powerTargets = targets || [];
        this.game.ui.screenMessage(`${card.data.name}: ${targets ? 'pick a target' : 'tap the board to cast it'}`, false);
        this.target = null;
    }

    updatePowerArrow() {
        const game = this.game;
        if (!this.ndc || (this.spell && !game.spellTargets(this.spell))) return;
        const color = this.spell ? this.spellColor(this.spell) : POWER_COLOR;
        const target = this.pick(this.ndc, this.powerTargets);
        this.ability = true;
        this.setTarget(target, color);
        const from = (this.spell && game.handPoint(this.spell)) || game.targetPoint(game.player.hero);
        const to = target ? game.targetPoint(target) : this.stage.pointerOnPlane(this.ndc, 0);
        if (to) this.effects.showArrow(from, to.clampLength(0, 1400), color, !!target);
    }

    endPower() {
        this.effects.hideArrow();
        this.setTarget(null, POWER_COLOR);
        this.game.ui.setPowerArmed(false);
        if (this.spell) {
            this.game.setHovered(null);
            this.game.ui.hideTooltip();
        }
        this.mode = null;
        this.spell = null;
        this.powerTargets = [];
    }

    spellColor(card) {
        return ABILITY_COLORS[card.abilityId] ?? 0xb98cff;
    }

    /** Over the arena between the two heroes (where an untargeted spell is dropped). */
    overBoard(ndc) {
        const classic = this.classicAt(ndc);
        return !!classic && classic.x > 300 && classic.x < 1620 && classic.y > 260 && classic.y < 860;
    }

    /** Center and spread of the first two pointers (pinch / two-finger orbit). */
    measure() {
        const [a, b] = [...this.pointers.values()];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    }

    // ---- Actions --------------------------------------------------------------------------------------------------

    startCardDrag() {
        this.clearTimer();
        if (this.card.spell && this.game.spellTargets(this.card)) {
            // A spell with a target stays in the hand (shown big) and aims an arrow at its target instead.
            this.held = false;
            this.game.setHovered(this.card);
            this.beginSpell(this.card);
            this.card = null;
            this.updatePowerArrow();
            return;
        }
        if (this.held) this.game.setHovered(null);
        this.held = false;
        this.mode = 'card';
        this.game.pickUp(this.card);
        this.dragCard(performance.now());
    }

    /** Holding a card with an ability turns the attack into an ability (green arrow). */
    switchToAbility() {
        if (this.mode !== 'arrow' || this.arrowShown || !(this.source instanceof Card3D)) return;
        this.ability = true;
        this.arrowShown = true;
        const color = this.arrowColor();
        this.source.setGlow(color, 1);
        this.effects.sparkle(this.source.center(), color, 20);
        if (navigator.vibrate) navigator.vibrate(25);
    }

    setBoardHover(card) {
        if (this.boardHover === card) return;
        if (this.boardHover && !this.boardHover.dying) {
            this.boardHover.body.position.z = 0;
            this.boardHover.setGlow(null, 0);
        }
        this.boardHover = card;
        if (card) {
            card.body.position.z = 10;
            card.setGlow(0xfff3c4, 0.35);
        }
    }

    dragCard(now) {
        const game = this.game;
        const world = this.stage.pointerOnPlane(this.ndc, 70);
        const classic = this.classicAt(this.ndc);
        if (!world || !classic) return;
        game.drag(this.card, world, classic, now);
        if (this.card.spell) {
            // A spell without a target lights up over the board, where it is cast.
            this.card.setGlow(this.spellColor(this.card), this.overBoard(this.ndc) ? 0.9 : 0);
            this.slot = null;
            return;
        }
        // Hovering a slot (classic: card rectangle overlapping the slot).
        let slot = null;
        for (let i = 0; i < 7; i++) {
            const x = 520 + (1920 / 13) * i;
            if (Math.abs(classic.x - x) <= 74 && Math.abs(classic.y - 700) <= 140 && game.freeSlot(i)) slot = i;
        }
        this.slot = slot;
        game.highlightSlot(slot === null ? -1 : slot);
    }

    updateArrow(e) {
        const game = this.game;
        if (!this.arrowShown && this.moved(e) < 8) return;
        this.arrowShown = true;
        this.clearTimer();
        game.ui.hideTooltip();
        const ability = this.ability && this.source instanceof Card3D ? game.abilityOf(this.source) : null;
        const candidates = this.ability
            ? game.candidates(ability ? ability.targets : [], ability && ability.name === 'Sacrifice' ? this.source : null)
            : game.attackCandidates();
        const target = this.pick(this.ndc, candidates.filter(c => c !== this.source || (ability && ability.name === 'Heal')));
        const color = this.arrowColor();
        this.setTarget(target, color);
        const from = game.targetPoint(this.source);
        const to = target ? game.targetPoint(target) : this.stage.pointerOnPlane(this.ndc, 0);
        if (to) this.effects.showArrow(from, to.clampLength(0, 1400), color, !!target);
    }

    arrowColor() {
        if (!this.ability || !(this.source instanceof Card3D)) return ATTACK_COLOR;
        return ABILITY_COLORS[this.source.abilityId] ?? 0x3ddc84;
    }

    setTarget(target, color = ATTACK_COLOR) {
        if (this.target === target) return;
        if (this.target) this.highlight(this.target, false, color);
        this.target = target;
        if (target) this.highlight(target, true, color);
    }

    highlight(obj, on, color) {
        if (obj instanceof Card3D) {
            if (!obj.dying) obj.setGlow(color, on ? 0.9 : 0);
            obj.body.scale.setScalar(on ? 1.15 : 1);
        } else if (obj instanceof Hero3D) {
            obj.body.scale.setScalar(on ? 1.1 : 1);
        }
    }

    /** Drops whatever the primary pointer is doing (a second finger came down, or Escape). */
    abort() {
        this.clearTimer();
        if (this.mode === 'card') {
            const card = this.card;
            if (this.game.player.hand.get(card.cid) === card) this.game.drop(card, null);
        } else if (this.mode === 'arrow') {
            this.effects.hideArrow();
            this.setTarget(null);
            if (this.source instanceof Card3D && !this.source.dying) this.source.setGlow(null, 0);
        } else if (this.mode === 'power') {
            this.endPower();
        } else if (this.mode === 'handPress' && this.held) {
            this.game.setHovered(null);
        }
        this.mode = null;
        this.card = null;
        this.source = null;
        this.held = false;
    }

    cancel() {
        this.abort();
        this.pointers.clear();
    }
}
