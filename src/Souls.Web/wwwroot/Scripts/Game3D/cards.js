// Cards: a thin 3D card with the classic artwork painted on the front and the card back on the reverse.
import * as THREE from '/lib/three/three.webgpu.js';
import { abs, clamp, color, dot, exp, mix, mod, normalView, positionGeometry, positionViewDirection, pow, select, sin, uniform, uv, vec3, vec4 } from '/lib/three/three.tsl.js';
import { Images, loadImage, textureFrom } from './assets.js';
import { tweens, Ease } from './tween.js';

export const CARD_W = 150;
export const CARD_H = 210;
const THICKNESS = 3;
const FACE_SCALE = 2; // the face is painted at 2x the 330x450 card texture so it stays sharp when zoomed

// Card JSON fields that change what the face looks like.
const PAINTED = ['id', 'name', 'kind', 'cost', 'attack', 'health', 'maxHealth', 'armor', 'level', 'ability', 'race', 'slotId', 'paralyzed', 'taunt', 'token', 'portrait', 'rarity', 'flavor', 'ward'];

// Colours of abilities (by ability id), for their effects and the spell gem.
export const ABILITY_COLORS = {
    1: 0xffe08a, 2: 0xc77dff, 3: 0x9aa5b1, 4: 0x9b59b6, 5: 0x7fb8ff, 6: 0xb39ddb, 7: 0xc0c8d0, 8: 0xff7a1a, 9: 0xffd34d,
    10: 0xffd36b, 11: 0xff5a3a, 12: 0x7dff4a, 13: 0xffc04d, 14: 0x7fd1ff, 15: 0xff6a1a, 16: 0x6dff7a, 17: 0xff8c3a, 18: 0xd0104a, 19: 0x9b59b6,
    20: 0xff9f43,
};

export const RARITY = { 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary' };
const GEM_COLORS = {
    1: ['#f4f1ea', '#a39e93', '#5b574f'],
    2: ['#bfe4ff', '#2f8de4', '#123b73'],
    3: ['#f1d4ff', '#a24ff0', '#45136e'],
    4: ['#fff3c4', '#ff9d1c', '#7a3a00'],
};

/** Time for the foil shimmer of epic and legendary cards (seconds); see updateFoil. */
const FOIL_TIME = uniform(0);
export function updateFoil(now) { FOIL_TIME.value = now / 1000; }

/** Epic (foil 1) and legendary (foil 2) cards: a band of light sweeps across the face now and then. */
function foilSheen(foil) {
    const phase = mod(FOIL_TIME.mul(0.32).add(foil.mul(0.37)), 2.6).sub(0.6);
    const d = uv().x.mul(0.75).add(uv().y.oneMinus().mul(0.55)).sub(phase.mul(1.3));
    const d2 = d.add(0.12);
    const sheen = exp(d.mul(d).mul(-55)).add(exp(d2.mul(d2).mul(-260)).mul(0.35));
    const legendary = foil.greaterThan(1.5);
    const tint = select(legendary,
        mix(vec3(1.0, 0.82, 0.38), vec3(1.0, 0.55, 0.85), sin(uv().y.mul(9).add(FOIL_TIME)).mul(0.5).add(0.5)),
        vec3(0.72, 0.52, 1.0));
    return select(foil.greaterThan(0), tint.mul(sheen).mul(select(legendary, 0.55, 0.4)), vec3(0));
}

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
        shared.taunt = faceGeometry(CARD_W + 30, CARD_H + 34, 20);
        shared.tauntMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa5b1, metalness: 0.75, roughness: 0.35, emissive: 0x1c2833 });
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

/** A steel shield with the armor value (bottom centre, between attack and health). */
function drawArmor(g, x, y, value) {
    g.save();
    g.beginPath();
    g.moveTo(x, y - 34);
    g.quadraticCurveTo(x + 26, y - 30, x + 30, y - 24);
    g.quadraticCurveTo(x + 30, y + 14, x, y + 34);
    g.quadraticCurveTo(x - 30, y + 14, x - 30, y - 24);
    g.quadraticCurveTo(x - 26, y - 30, x, y - 34);
    g.closePath();
    const metal = g.createLinearGradient(x, y - 34, x, y + 34);
    metal.addColorStop(0, '#d9e2ec');
    metal.addColorStop(0.5, '#7b8794');
    metal.addColorStop(1, '#3e4c59');
    g.fillStyle = metal;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#1f2933';
    g.stroke();
    g.restore();
    drawText(g, String(value), x, y + 2, { size: 38, align: 'center', baseline: 'middle' });
}

function drawStar(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const radius = i % 2 ? r * 0.45 : r;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        g.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    g.closePath();
    g.fillStyle = '#ffd34d';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#5c3d00';
    g.stroke();
}

/** The rarity gem between the portrait and the text box. */
function drawGem(g, x, y, rarity) {
    const [light, mid, dark] = GEM_COLORS[rarity] || GEM_COLORS[1];
    g.save();
    if (rarity >= 3) {
        g.shadowColor = mid;
        g.shadowBlur = rarity === 4 ? 18 : 12;
    }
    g.beginPath();
    g.moveTo(x, y - 17);
    g.lineTo(x + 15, y - 4);
    g.lineTo(x + 9, y + 15);
    g.lineTo(x - 9, y + 15);
    g.lineTo(x - 15, y - 4);
    g.closePath();
    const fill = g.createLinearGradient(x - 15, y - 17, x + 15, y + 15);
    fill.addColorStop(0, light);
    fill.addColorStop(0.45, mid);
    fill.addColorStop(1, dark);
    g.fillStyle = fill;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 2.5;
    g.strokeStyle = '#1b130b';
    g.stroke();
    // Facets.
    g.beginPath();
    g.moveTo(x - 15, y - 4); g.lineTo(x - 6, y - 2); g.lineTo(x, y - 17);
    g.moveTo(x + 15, y - 4); g.lineTo(x + 6, y - 2); g.lineTo(x, y - 17);
    g.moveTo(x - 6, y - 2); g.lineTo(x + 6, y - 2); g.lineTo(x + 9, y + 15);
    g.moveTo(x - 6, y - 2); g.lineTo(x - 9, y + 15);
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    g.stroke();
    g.restore();
}

/**
 * Spells have no attack or health: a dark plate covers those gems, with the spell gem (a glowing orb in the ability's
 * colour) in the middle.
 */
function drawSpellPlate(g, color) {
    const css = `#${color.toString(16).padStart(6, '0')}`;
    g.save();
    g.beginPath();
    g.roundRect(4, 370, 322, 74, 16);
    const plate = g.createLinearGradient(0, 370, 0, 444);
    plate.addColorStop(0, '#2b2140');
    plate.addColorStop(1, '#100b18');
    g.fillStyle = plate;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#c9a24a';
    g.stroke();
    g.shadowColor = css;
    g.shadowBlur = 22;
    g.beginPath();
    g.arc(165, 407, 27, 0, Math.PI * 2);
    const orb = g.createRadialGradient(158, 399, 3, 165, 407, 27);
    orb.addColorStop(0, '#ffffff');
    orb.addColorStop(0.45, css);
    orb.addColorStop(1, '#1b0f24');
    g.fillStyle = orb;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 2.5;
    g.strokeStyle = '#f3dc9a';
    g.stroke();
    // A four-pointed glint in the orb.
    g.beginPath();
    for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 4 : 15;
        const a = -Math.PI / 2 + i * Math.PI / 4;
        g.lineTo(165 + Math.cos(a) * r, 407 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    g.fill();
    g.restore();
    for (const x of [86, 244]) drawText(g, 'SPELL', x, 408, { size: 22, fill: '#f3dc9a', stroke: '#000', strokeWidth: 2, align: 'center', baseline: 'middle' });
}

/** Legendary cards wear a golden crown over the name banner and a gilded edge; epic cards a violet edge. */
function drawRarityFrame(g, rarity) {
    if (rarity < 3) return;
    g.save();
    const gold = rarity === 4;
    const edge = g.createLinearGradient(0, 0, 330, 450);
    edge.addColorStop(0, gold ? '#fff0b8' : '#e7c6ff');
    edge.addColorStop(0.5, gold ? '#d99a1e' : '#9b4de0');
    edge.addColorStop(1, gold ? '#fff0b8' : '#e7c6ff');
    g.strokeStyle = edge;
    g.lineWidth = gold ? 6 : 4;
    g.shadowColor = gold ? '#ffb02e' : '#b26bff';
    g.shadowBlur = 10;
    g.beginPath();
    g.roundRect(5, 5, 320, 440, 16);
    g.stroke();
    if (gold) {
        // Crown.
        g.shadowBlur = 8;
        g.beginPath();
        g.moveTo(140, 30); g.lineTo(136, 8); g.lineTo(150, 19); g.lineTo(165, 2); g.lineTo(180, 19); g.lineTo(194, 8); g.lineTo(190, 30);
        g.closePath();
        const crown = g.createLinearGradient(0, 2, 0, 30);
        crown.addColorStop(0, '#fff6cf');
        crown.addColorStop(1, '#c97d0b');
        g.fillStyle = crown;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#4a2a00';
        g.stroke();
        for (const [cx, cy] of [[136, 8], [165, 3], [194, 8]]) {
            g.beginPath();
            g.arc(cx, cy, 3.5, 0, Math.PI * 2);
            g.fillStyle = '#ff4d4d';
            g.fill();
        }
    }
    g.restore();
}

/** Paints the card face exactly like the classic client lays it out on the 330x450 race texture. */
async function paintFace(canvas, data, portraits) {
    const g = canvas.getContext('2d');
    g.setTransform(FACE_SCALE, 0, 0, FACE_SCALE, 0, 0);
    g.clearRect(0, 0, 330, 450);

    const raceId = data.race && data.race.id;
    const texture = await loadImage(Images.raceTextures[raceId] || (data.token ? Images.raceTextures[1] : Images.cardError));
    const portrait = await loadImage(portraits[data.id] || data.portrait || Images.cardUnknown);
    if (texture) g.drawImage(texture, 0, 0, 330, 450);
    // The portrait sits on top of the frame in the classic client.
    if (portrait) g.drawImage(portrait, 47, 110, 236, 167);
    if (data.paralyzed) {
        g.fillStyle = 'rgba(110, 170, 255, 0.5)';
        g.fillRect(47, 110, 236, 167);
        drawText(g, 'PARALYZED', 165, 194, { size: 34, fill: '#eaf4ff', stroke: '#0b2545', align: 'center', baseline: 'middle' });
    }
    const level = Number(data.level) || 1;
    for (let i = 0; i < level - 1; i++) drawStar(g, 165 + (i - (level - 2) / 2) * 34, 104, 15);

    // Clear of the race emblem in the top right corner.
    drawText(g, String(data.name ?? ''), 158, 58, { size: 40, fill: 'black', stroke: null, align: 'center', baseline: 'middle', maxWidth: 172 });
    drawText(g, String(data.cost ?? ''), 38, 44, { align: 'center', baseline: 'middle' });
    // Text box: the ability as printed ("Burn 3") and its rules text; vanilla cards show their flavor text.
    const ability = data.ability;
    const label = ability ? (ability.label || ability.name) : null;
    if (label) {
        drawText(g, label, 165, 312, { size: 30, fill: '#1b130b', stroke: null, align: 'center', baseline: 'middle', maxWidth: 236 });
        if (ability.text) {
            g.font = '15px Arial, Helvetica, sans-serif';
            const lines = wrapLines(g, ability.text, 238).slice(0, 2);
            lines.forEach((l, i) => drawText(g, l, 165, 336 + i * 17, { size: 15, fill: '#2b2118', stroke: null, align: 'center', baseline: 'middle', maxWidth: 240 }));
        }
    } else if (data.flavor) {
        g.font = 'italic 16px Georgia, serif';
        const lines = wrapLines(g, data.flavor, 236).slice(0, 3);
        const top = 327 - (lines.length - 1) * 9;
        g.fillStyle = '#3a2d20';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        lines.forEach((l, i) => g.fillText(l, 165, top + i * 18));
    }
    const rarity = Number(data.rarity) || 0;
    if (rarity && !data.token) drawGem(g, 165, 287, rarity);
    drawRarityFrame(g, rarity);
    if (data.kind === 'spell') {
        drawSpellPlate(g, ABILITY_COLORS[ability && ability.id] ?? 0xb98cff);
        return;
    }
    drawText(g, String(data.attack ?? ''), 40, 408, { align: 'center', baseline: 'middle' });
    const damaged = data.maxHealth !== undefined && Number(data.health) < Number(data.maxHealth);
    drawText(g, String(data.health ?? ''), 298, 406, { align: 'center', baseline: 'middle', fill: damaged ? '#ff7b7b' : 'white' });
    if (Number(data.armor) > 0) drawArmor(g, 165, 404, data.armor);
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
        // A context up front (hidden cards are never painted, and WebGPU cannot upload a canvas without one), kept in
        // memory: a GPU canvas copied into a WebGPU texture comes out blank where Chromium's canvas and WebGPU do not
        // share a device (Linux with ANGLE on GL).
        this.canvas.getContext('2d', { willReadFrequently: true });
        this.faceTexture = new THREE.CanvasTexture(this.canvas);
        this.faceTexture.colorSpace = THREE.SRGBColorSpace;
        this.faceTexture.anisotropy = 8;
        this.faceMaterial = new THREE.MeshStandardNodeMaterial({ map: this.faceTexture, roughness: 0.55, metalness: 0.05, transparent: true });
        this.foil = uniform(0);
        this.faceMaterial.emissiveNode = foilSheen(this.foil);
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
        this.glow.visible = false; // drawn only while it shows (see setGlow)
        this.glow.userData.card = this;

        this.body.add(this.glow, this.edge, this.front, this.back);
        if (data.name !== undefined) this.setData(data);
    }

    /** Updates the card's stats (any subset of the server's card JSON) and repaints the face if they changed. */
    setData(data) {
        if (data.name === undefined && !this.revealed) return;
        for (const key of PAINTED) {
            if (data[key] !== undefined && data[key] !== null) this.data[key] = data[key];
        }
        if (data.ability === null) this.data.ability = null;
        this.revealed = true;
        this.setTaunt(!!this.data.taunt);
        this.setWard(!!this.data.ward);
        this.setFrozen(!!this.data.paralyzed);
        const rarity = Number(this.data.rarity) || 0;
        this.foil.value = rarity === 4 ? 2 : rarity === 3 ? 1 : 0;
        this.faceMaterial.color.set(this.data.paralyzed ? 0xb8d4ff : 0xffffff);
        this.repaint();
    }

    get rarity() { return Number(this.data.rarity) || 0; }

    /** A golden bubble over the card: an unbroken ward. */
    setWard(on) {
        if (on && !this.wardBubble) {
            const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
            material.uniforms = { fade: uniform(0) };
            // Clamped: interpolated vectors can give |dot| a hair above 1, and pow() of a negative base is NaN, which
            // the bloom blur spreads over the whole frame.
            const rim = pow(clamp(abs(dot(normalView, positionViewDirection)), 0, 1).oneMinus(), 2.2);
            const p = positionGeometry;
            const hex = sin(p.x.mul(0.12).add(FOIL_TIME.mul(1.5))).mul(sin(p.y.mul(0.12).sub(FOIL_TIME.mul(1.1)))).mul(0.5).add(0.5);
            material.colorNode = vec4(color(0xffd36b).mul(rim.add(0.6)), rim.mul(0.75).add(hex.mul(0.06)).add(0.08).mul(material.uniforms.fade));
            this.wardBubble = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
            this.wardBubble.scale.set(CARD_W * 0.66, CARD_H * 0.62, 46);
            this.wardBubble.renderOrder = 8;
            this.body.add(this.wardBubble);
            tweens.to(material.uniforms.fade, { value: 1 }, 400, Ease.quadOut);
        }
        if (!on && this.wardBubble && !this.wardBreaking) this.removeWard();
    }

    /** The ward breaks: the bubble flares up and bursts. Resolves when it is gone. */
    breakWard() {
        this.data.ward = false;
        if (!this.wardBubble || this.wardBreaking) return Promise.resolve();
        this.wardBreaking = true;
        const bubble = this.wardBubble;
        const from = bubble.scale.clone();
        return tweens.run(380, t => {
            bubble.scale.copy(from).multiplyScalar(1 + t * 0.45);
            bubble.material.uniforms.fade.value = t < 0.25 ? 1 + t * 6 : (1 - t) * 2;
        }, Ease.quadOut).then(() => { this.wardBreaking = false; this.removeWard(); });
    }

    removeWard() {
        if (!this.wardBubble) return;
        this.wardBubble.removeFromParent();
        this.wardBubble.geometry.dispose();
        this.wardBubble.material.dispose();
        this.wardBubble = null;
    }

    /** Ice crystals around the card while it is paralyzed. */
    setFrozen(on) {
        if (on && !this.ice) {
            this.ice = new THREE.Group();
            const material = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x2a6fb0, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 });
            const spots = [[-62, -88, 0.9], [58, -92, 1.1], [-70, 20, 0.8], [66, 40, 1], [-40, 96, 0.7], [44, 100, 0.85], [0, -100, 0.75]];
            for (const [x, y, s] of spots) {
                const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), material);
                crystal.scale.set(10 * s, 30 * s, 10 * s);
                crystal.position.set(x, y, 12 + Math.random() * 8);
                crystal.rotation.set(Math.random() * 0.8 - 0.4, Math.random() * Math.PI, (x < 0 ? 0.5 : -0.5) + Math.random() * 0.3);
                this.ice.add(crystal);
            }
            this.ice.scale.setScalar(0.01);
            this.body.add(this.ice);
            tweens.to(this.ice.scale, { x: 1, y: 1, z: 1 }, 350, Ease.backOut);
        } else if (!on && this.ice) {
            const ice = this.ice;
            this.ice = null;
            tweens.to(ice.scale, { x: 0.01, y: 0.01, z: 0.01 }, 300, Ease.quadIn).then(() => {
                ice.removeFromParent();
                ice.children.forEach(c => c.geometry.dispose());
                ice.children[0]?.material.dispose();
            });
        }
    }

    /**
     * Breaks the card into pieces of its own face that fly apart and fade (death). The card itself is hidden at once;
     * resolves when the pieces are gone.
     */
    shatter(scene, { force = 1 } = {}) {
        const pieces = [];
        const cols = 4, rows = 5;
        const w = CARD_W / cols, h = CARD_H / rows;
        this.body.updateWorldMatrix(true, false);
        const world = this.body.matrixWorld;
        const material = new THREE.MeshStandardMaterial({ map: this.faceTexture, roughness: 0.6, transparent: true, side: THREE.DoubleSide });
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                // Two triangles per cell, each jittered a little so the cracks are not a grid.
                const x0 = -CARD_W / 2 + i * w, y0 = -CARD_H / 2 + j * h;
                for (const tri of [[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]]) {
                    const geometry = new THREE.BufferGeometry();
                    const pts = tri.map(([a, b]) => [x0 + a * w, y0 + b * h]);
                    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(([x, y]) => [x - cx, y - cy, 0]), 3));
                    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap(([x, y]) => [x / CARD_W + 0.5, y / CARD_H + 0.5]), 2));
                    geometry.computeVertexNormals();
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(cx, cy, THICKNESS / 2 + 0.1).applyMatrix4(world);
                    mesh.quaternion.setFromRotationMatrix(world);
                    mesh.scale.setScalar(this.scale.x);
                    const out = new THREE.Vector3(cx, cy, 30).normalize();
                    const velocity = out.applyQuaternion(mesh.quaternion).multiplyScalar((160 + Math.random() * 260) * force);
                    velocity.y += 120 + Math.random() * 200;
                    pieces.push({ mesh, velocity, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10) });
                    scene.add(mesh);
                }
            }
        }
        this.visible = false;
        let last = performance.now();
        return tweens.run(1100, t => {
            const now = performance.now();
            const s = Math.min(0.05, (now - last) / 1000);
            last = now;
            for (const p of pieces) {
                p.velocity.y -= 900 * s;
                p.mesh.position.addScaledVector(p.velocity, s);
                p.mesh.rotation.x += p.spin.x * s;
                p.mesh.rotation.y += p.spin.y * s;
                p.mesh.rotation.z += p.spin.z * s;
            }
            material.opacity = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
        }, Ease.linear).then(() => {
            for (const p of pieces) { p.mesh.removeFromParent(); p.mesh.geometry.dispose(); }
            material.dispose();
        });
    }

    setStat(key, value) {
        this.data[key] = value;
        this.repaint();
    }

    repaint() {
        if (!this.revealed) return;
        const key = JSON.stringify(PAINTED.map(k => this.data[k]));
        if (key === this._painted) return;
        this._painted = key;
        const token = (this._paintToken = (this._paintToken || 0) + 1);
        paintFace(this.canvas, this.data, this.portraits).then(() => {
            if (token === this._paintToken) this.faceTexture.needsUpdate = true;
        });
    }

    /** A steel plate behind the card: it has Taunt and must be attacked first. */
    setTaunt(on) {
        if (on && !this.tauntPlate) {
            this.tauntPlate = new THREE.Mesh(sharedGeometry().taunt, sharedGeometry().tauntMaterial);
            this.tauntPlate.position.z = -THICKNESS / 2 - 0.6;
            this.body.add(this.tauntPlate);
        }
        if (this.tauntPlate) this.tauntPlate.visible = on;
    }

    /** A pulsing green outline: the card can attack or use its ability now. */
    setReady(on) {
        if (on === this.ready) return;
        this.ready = on;
        if (on && !this.readyGlow) {
            this.readyMaterial = new THREE.MeshBasicMaterial({ color: 0x53ff7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
            this.readyGlow = new THREE.Mesh(sharedGeometry().glow, this.readyMaterial);
            this.readyGlow.position.z = -THICKNESS / 2 - 0.3;
            this.body.add(this.readyGlow);
        }
        if (this.readyGlow) this.readyGlow.visible = on;
    }

    /** Called every frame: the ready outline breathes. */
    pulse(now) {
        if (this.ready && this.readyMaterial) this.readyMaterial.opacity = 0.35 + 0.25 * Math.sin(now * 0.005 + this.cid);
    }

    get abilityId() { return this.data.ability ? this.data.ability.id : undefined; }

    /** Cast from the hand, never on the board. */
    get spell() { return this.data.kind === 'spell'; }

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
        this.glowTarget = opacity;
        if (opacity > 0) this.glow.visible = true;
        tweens.to(this.glowMaterial, { opacity }, 150, Ease.quadOut)
            .then(() => { this.glow.visible = this.glowTarget > 0 || this.glowMaterial.opacity > 0.001; });
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
        this.removeWard();
        if (this.ice) { this.ice.children.forEach(c => c.geometry.dispose()); this.ice.children[0]?.material.dispose(); this.ice = null; }
        this.faceTexture.dispose();
        this.faceMaterial.dispose();
        this.backMaterial.dispose();
        this.glowMaterial.dispose();
        if (this.readyMaterial) this.readyMaterial.dispose();
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
