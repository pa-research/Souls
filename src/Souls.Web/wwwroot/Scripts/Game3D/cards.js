// Cards: a thin 3D card with the classic artwork painted on the front and the card back on the reverse.
import * as THREE from '/lib/three/three.module.js';
import { Images, loadImage, textureFrom } from './assets.js';
import { tweens, Ease } from './tween.js';

export const CARD_W = 150;
export const CARD_H = 210;
const THICKNESS = 3;
const FACE_SCALE = 2; // the face is painted at 2x the 330x450 card texture so it stays sharp when zoomed

function roundedRect(w, h, r) {
    const shape = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return shape;
}

function faceGeometry(w, h, r) {
    const geometry = new THREE.ShapeGeometry(roundedRect(w, h, r), 6);
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return geometry;
}

const shared = {};
function sharedGeometry() {
    if (!shared.face) {
        shared.face = faceGeometry(CARD_W, CARD_H, 9);
        shared.edge = new THREE.ExtrudeGeometry(roundedRect(CARD_W, CARD_H, 9), { depth: THICKNESS, bevelEnabled: false, curveSegments: 6 });
        shared.edge.translate(0, 0, -THICKNESS / 2);
        shared.glow = faceGeometry(CARD_W + 26, CARD_H + 26, 18);
        shared.edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.7 });
        shared.hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
    }
    return shared;
}

let backTexture = null;
async function cardBackTexture() {
    if (!backTexture) backTexture = textureFrom(await loadImage(Images.cardBack));
    return backTexture;
}

/** Draws text with the classic look (Arial, white with a black outline unless a fill is given). */
function drawText(g, text, x, y, { size = 45, fill = 'white', stroke = '#000', strokeWidth = 4, align = 'left', baseline = 'top', maxWidth } = {}) {
    g.font = `${size}px Arial, Helvetica, sans-serif`;
    g.textAlign = align;
    g.textBaseline = baseline;
    if (maxWidth) {
        let s = size;
        while (s > 14 && g.measureText(text).width > maxWidth) { s -= 2; g.font = `${s}px Arial, Helvetica, sans-serif`; }
    }
    if (stroke && strokeWidth) {
        g.lineJoin = 'round';
        g.lineWidth = strokeWidth * 2;
        g.strokeStyle = stroke;
        g.strokeText(text, x, y);
    }
    g.fillStyle = fill;
    g.fillText(text, x, y);
}

function wrapLines(g, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (line && g.measureText(test).width > maxWidth) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
}

/** Paints the card face exactly like the classic client lays it out on the 330x450 race texture. */
async function paintFace(canvas, data, portraits) {
    const g = canvas.getContext('2d');
    g.setTransform(FACE_SCALE, 0, 0, FACE_SCALE, 0, 0);
    g.clearRect(0, 0, 330, 450);

    const raceId = data.race && data.race.id;
    const texture = await loadImage(Images.raceTextures[raceId] || Images.cardError);
    const portrait = await loadImage(portraits[data.id]);
    if (texture) g.drawImage(texture, 0, 0, 330, 450);
    // The portrait sits on top of the frame in the classic client.
    if (portrait) g.drawImage(portrait, 47, 110, 236, 167);

    drawText(g, String(data.name ?? ''), 165, 58, { size: 40, fill: 'black', stroke: null, align: 'center', baseline: 'middle', maxWidth: 200 });
    drawText(g, String(data.cost ?? ''), 38, 44, { align: 'center', baseline: 'middle' });
    if (data.ability && data.ability.name) {
        g.font = '45px Arial, Helvetica, sans-serif';
        let size = 45;
        let lines = wrapLines(g, data.ability.name, 280);
        while (lines.length > 2 && size > 24) { size -= 4; g.font = `${size}px Arial, Helvetica, sans-serif`; lines = wrapLines(g, data.ability.name, 280); }
        const top = 330 - (lines.length - 1) * size * 0.55;
        lines.forEach((l, i) => drawText(g, l, 165, top + i * size * 1.05, { size, fill: 'black', stroke: null, align: 'center', baseline: 'middle', maxWidth: 280 }));
    }
    drawText(g, String(data.attack ?? ''), 40, 408, { align: 'center', baseline: 'middle' });
    drawText(g, String(data.health ?? ''), 298, 406, { align: 'center', baseline: 'middle' });
}

export class Card3D extends THREE.Group {
    constructor(data, { owner, portraits }) {
        super();
        const s = sharedGeometry();
        this.cid = data.cid;
        this.owner = owner; // 'player' | 'opponent'
        this.portraits = portraits;
        this.data = {};
        this.revealed = false;
        this.inSlot = null;
        this.isDead = false;
        this.pending = false;
        this.anim = null;
        this.name = `card-${data.cid}`;

        // Everything visual lives in `body` so the group pose (position in hand/board) and effects (shake, lift) stay
        // separate. `hinge` sits on the card's bottom edge: board cards tilt up around it in the low camera views.
        this.hinge = new THREE.Group();
        this.hinge.position.y = -CARD_H / 2;
        this.add(this.hinge);
        this.body = new THREE.Group();
        this.body.position.y = CARD_H / 2;
        this.hinge.add(this.body);

        this.canvas = document.createElement('canvas');
        this.canvas.width = 330 * FACE_SCALE;
        this.canvas.height = 450 * FACE_SCALE;
        this.faceTexture = new THREE.CanvasTexture(this.canvas);
        this.faceTexture.colorSpace = THREE.SRGBColorSpace;
        this.faceTexture.anisotropy = 8;
        this.faceMaterial = new THREE.MeshStandardMaterial({ map: this.faceTexture, roughness: 0.55, metalness: 0.05, transparent: true });
        this.backMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true });
        cardBackTexture().then(t => { this.backMaterial.map = t; this.backMaterial.needsUpdate = true; });

        this.front = new THREE.Mesh(s.face, this.faceMaterial);
        this.front.position.z = THICKNESS / 2 + 0.05;
        this.back = new THREE.Mesh(s.face, this.backMaterial);
        this.back.rotation.y = Math.PI;
        this.back.position.z = -THICKNESS / 2 - 0.05;
        this.edge = new THREE.Mesh(s.edge, [s.hiddenMaterial, s.edgeMaterial]);
        for (const m of [this.front, this.back, this.edge]) { m.castShadow = true; m.userData.card = this; }
        this.front.receiveShadow = this.back.receiveShadow = true;

        this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        this.glow = new THREE.Mesh(s.glow, this.glowMaterial);
        this.glow.position.z = -THICKNESS / 2 - 0.4;
        this.glow.userData.card = this;

        this.body.add(this.glow, this.edge, this.front, this.back);
        if (data.name !== undefined) this.setData(data);
    }

    /** Updates the card's stats (any subset of the server's card JSON) and repaints the face. */
    setData(data) {
        for (const key of ['id', 'name', 'cost', 'attack', 'health', 'ability', 'race', 'slotId']) {
            if (data[key] !== undefined && data[key] !== null) this.data[key] = data[key];
        }
        if (data.ability === null) this.data.ability = null;
        this.revealed = true;
        this.repaint();
    }

    setStat(key, value) {
        this.data[key] = value;
        this.repaint();
    }

    repaint() {
        if (!this.revealed) return;
        const token = (this._paintToken = (this._paintToken || 0) + 1);
        paintFace(this.canvas, this.data, this.portraits).then(() => {
            if (token === this._paintToken) this.faceTexture.needsUpdate = true;
        });
    }

    get abilityId() { return this.data.ability ? this.data.ability.id : undefined; }

    /** Tilts the card up around its bottom edge (radians). */
    setTilt(angle) {
        this.hinge.rotation.x = angle;
    }

    /** World position of the card's centre (moves with the tilt). */
    center() {
        return this.body.getWorldPosition(new THREE.Vector3());
    }

    /** Cards in hand float like UI and cast no shadow; on (or above) the board they do. */
    set castsShadow(on) {
        this.front.castShadow = this.back.castShadow = this.edge.castShadow = on;
    }

    /** Hit-test meshes for the raycaster. */
    get pickables() { return [this.front, this.back, this.edge]; }

    setGlow(color, opacity) {
        if (color !== null && color !== undefined) this.glowMaterial.color.set(color);
        tweens.to(this.glowMaterial, { opacity }, 150, Ease.quadOut);
    }

    setOpacity(opacity) {
        this.faceMaterial.opacity = this.backMaterial.opacity = opacity;
        this.edge.material[1] = opacity < 1 ? this.fadeEdge() : sharedGeometry().edgeMaterial;
    }

    fadeEdge() {
        if (!this._fadeEdge) this._fadeEdge = new THREE.MeshStandardMaterial({ color: 0x1a1410, transparent: true });
        this._fadeEdge.opacity = this.faceMaterial.opacity;
        return this._fadeEdge;
    }

    /** Animates the card group to a pose {position, quaternion, scale}. Cancels any running pose animation. */
    moveTo(pose, duration = 400, ease = Ease.cubicOut, { arc = 0 } = {}) {
        if (this.anim) this.anim.cancel();
        const fromPos = this.position.clone();
        const fromQuat = this.quaternion.clone();
        const fromScale = this.scale.x;
        const toScale = pose.scale ?? fromScale;
        this.anim = tweens.run(duration, t => {
            this.position.lerpVectors(fromPos, pose.position, t);
            if (arc) this.position.y += Math.sin(Math.PI * t) * arc;
            if (pose.quaternion) this.quaternion.slerpQuaternions(fromQuat, pose.quaternion, t);
            this.scale.setScalar(fromScale + (toScale - fromScale) * t);
        }, ease);
        return this.anim;
    }

    /** Places the card at a pose immediately. */
    setPose(pose) {
        if (this.anim) { this.anim.cancel(); this.anim = null; }
        this.position.copy(pose.position);
        if (pose.quaternion) this.quaternion.copy(pose.quaternion);
        if (pose.scale !== undefined) this.scale.setScalar(pose.scale);
    }

    dispose() {
        this.faceTexture.dispose();
        this.faceMaterial.dispose();
        this.backMaterial.dispose();
        this.glowMaterial.dispose();
        if (this._fadeEdge) this._fadeEdge.dispose();
        this.removeFromParent();
    }
}

/** Orientation of a card lying face up on the board (top of the card pointing away from the player). */
export const FLAT_FACE_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/** Slot markers (cardslot.png) shown while a card is dragged. */
export class SlotMarker extends THREE.Mesh {
    constructor(texture, slotId) {
        super(faceGeometry(CARD_W, CARD_H, 9), new THREE.MeshBasicMaterial({
            map: texture, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff,
        }));
        this.slotId = slotId;
        this.quaternion.copy(FLAT_FACE_UP);
        this.renderOrder = 1;
        this.card = null;
    }

    show(visible) {
        tweens.to(this.material, { opacity: visible ? 0.85 : 0 }, 200, Ease.quadOut);
    }

    highlight(on) {
        this.material.color.set(on ? 0x8cff6e : 0xffffff);
        tweens.to(this.scale, { x: on ? 1.12 : 1, y: on ? 1.12 : 1 }, 150, Ease.quadOut);
    }
}
