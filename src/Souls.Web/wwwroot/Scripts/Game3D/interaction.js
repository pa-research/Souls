// Mouse / touch / keyboard input for the 3D client, following the classic controls:
//  - hover a hand card to zoom it, drag it onto a free slot to play it;
//  - left-drag from your card or hero to an enemy to attack;
//  - right-drag from your card to use its ability (on a friendly card or hero);
//  - click the End Turn sign.
// Camera: 1-4 pick a view, the mouse wheel zooms, right- or middle-drag on the arena orbits.
import { Card3D } from './cards.js';
import { Hero3D } from './heroes.js';
import { toClassic, VIEWS } from './scene.js';

const HAND_X = 165, HAND_SPACING = 60, HAND_TOP = 880;

export class Interaction {
    constructor(stage, game, effects) {
        this.stage = stage;
        this.game = game;
        this.effects = effects;
        this.mode = null; // null | 'card' | 'arrow' | 'orbit'
        this.ndc = null;
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
            if (e.key === 'Escape') { this.cancel(); return; }
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

    onDown(e) {
        const game = this.game;
        if (this.mode) return;
        const ndc = this.stage.ndc(e);
        this.ndc = ndc;
        this.downAt = { x: e.clientX, y: e.clientY };
        this.last = { x: e.clientX, y: e.clientY };
        const left = e.button === 0, right = e.button === 2, middle = e.button === 1;

        if (middle) {
            this.mode = 'orbit';
            e.preventDefault();
            return;
        }
        if (!game.active) return;

        // End turn sign.
        if (left && this.overSign(ndc)) {
            game.endTurn();
            return;
        }

        // Hand card: pick up and drag.
        const handCard = left ? this.handCardAt(ndc) : null;
        if (handCard) {
            this.mode = 'card';
            this.card = handCard;
            game.pickUp(handCard);
            this.dragCard(performance.now());
            e.preventDefault();
            return;
        }

        // Own board card or hero: start an attack (left) or ability (right) arrow.
        const own = this.pick(ndc, [...game.player.board.values(), game.player.hero]);
        if (own && (left || (right && own instanceof Card3D))) {
            this.mode = 'arrow';
            this.source = own;
            this.ability = right;
            this.target = null;
            this.arrowShown = false;
            e.preventDefault();
            return;
        }

        // Right-drag on the arena orbits the camera.
        if (right) {
            this.mode = 'orbit';
            e.preventDefault();
        }
    }

    onMove(e) {
        const game = this.game;
        const ndc = this.stage.ndc(e);
        this.ndc = ndc;
        if (this.mode === 'orbit') {
            const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
            this.last = { x: e.clientX, y: e.clientY };
            if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) this.stage.orbitBy(dx, dy);
            return;
        }
        if (!game.active) return;
        if (this.mode === 'card') {
            this.dragCard(performance.now());
        } else if (this.mode === 'arrow') {
            this.updateArrow(e);
        } else {
            // Idle: zoom the hovered hand card, lift a hovered board card.
            game.setHovered(this.handCardAt(ndc));
            const own = game.hovered ? null : this.pick(ndc, [...game.player.board.values(), game.player.hero]);
            this.setBoardHover(own instanceof Card3D ? own : null);
            this.stage.renderer.domElement.style.cursor = (game.hovered || own || this.overSign(ndc)) ? 'pointer' : 'default';
        }
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
        if (!this.arrowShown && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 8) return;
        this.arrowShown = true;
        const candidates = this.ability
            ? [...game.player.board.values(), game.player.hero, game.opponent.hero]
            : [...game.opponent.board.values(), game.opponent.hero];
        const target = this.pick(this.ndc, candidates.filter(c => c !== this.source));
        this.setTarget(target);
        const from = game.targetPoint(this.source);
        const to = target ? game.targetPoint(target) : this.stage.pointerOnPlane(this.ndc, 0);
        if (to) this.effects.showArrow(from, to.clampLength(0, 1400), this.ability ? 0x3ddc84 : 0xff3b30, !!target);
    }

    setTarget(target) {
        if (this.target === target) return;
        const color = this.ability ? 0x3ddc84 : 0xff3b30;
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

    onUp() {
        const game = this.game;
        if (this.mode === 'orbit') {
            this.mode = null;
        } else if (this.mode === 'card') {
            const card = this.card;
            this.mode = null;
            this.card = null;
            if (game.player.hand.get(card.cid) === card) game.drop(card, this.slot);
            this.slot = null;
        } else if (this.mode === 'arrow') {
            this.mode = null;
            this.effects.hideArrow();
            const target = this.target;
            this.setTarget(null);
            if (target && game.active) {
                if (this.ability) game.useAbility(this.source, target);
                else game.attack(this.source, target);
            }
            this.source = null;
        }
    }

    cancel() {
        if (this.mode === 'card') {
            const card = this.card;
            this.mode = null;
            this.card = null;
            if (this.game.player.hand.get(card.cid) === card) this.game.drop(card, null);
        } else if (this.mode === 'arrow') {
            this.mode = null;
            this.effects.hideArrow();
            this.setTarget(null);
            this.source = null;
        } else {
            this.mode = null;
        }
    }
}
