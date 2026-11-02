// Heroes: the classic portrait medallion as a 3D shield floating above the arena, with mana gems around it, and in the
// stadium views the hero itself: an animated figure of its class on its podium (Content/Models/Heroes, made with Tripo).
import * as THREE from '/lib/three/three.webgpu.js';
import { float, texture } from '/lib/three/three.tsl.js';
import { GLTFLoader } from '/lib/three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '/lib/three/addons/utils/SkeletonUtils.js';
import { Images, loadImage } from './assets.js';
import { tweens, Ease } from './tween.js';

const HERO_W = 300;
const HERO_H = 250;
const PX = 2; // canvas pixels per classic pixel

const MANA_COLOR = new THREE.Color(0x6e93b3);
const MANA_OK = new THREE.Color(0x4cd328);
const MANA_SHORT = new THREE.Color(0xfffe00);
const MANA_MISSING = new THREE.Color(0xe52a2a);

/** How tall a hero's figure stands on its podium (a board card is 210 long). */
export const FIGURE_HEIGHT = 300;

// The nameplate that stands in for the medallion over a figure: name, health bar, attack, health and armor.
const PLATE_W = 300;
const PLATE_H = 104;
const READY = new THREE.Color(0x2ecc71);

// One load per class; each hero plays a copy (both heroes may be the same class).
const figures = new Map();
function fetchFigure(type) {
    if (!figures.has(type)) figures.set(type, new GLTFLoader().loadAsync(`/Content/Models/Heroes/${type}.glb`).catch(() => null));
    return figures.get(type);
}

// The figures' animations (tools/heroes/prepare.py names them): idle loops, the others play once.
const LOOPS = new Set(['idle', 'victory']);

function ellipseShape(rx, ry) {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    return shape;
}

export class Hero3D extends THREE.Group {
    constructor(isPlayer) {
        super();
        this.isPlayer = isPlayer;
        this.info = { name: 'NA', attack: 'NA', health: 'NA', mana: 0, type: 0, armor: 0 };
        this.name = isPlayer ? 'hero-player' : 'hero-opponent';

        this.body = new THREE.Group();
        this.add(this.body);

        // Back plate: an elliptical shield behind the portrait.
        const plate = new THREE.Mesh(
            new THREE.ExtrudeGeometry(ellipseShape(HERO_W / 2.3, HERO_H / 2.25), { depth: 16, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, curveSegments: 48 }),
            new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.55, metalness: 0.25 }));
        plate.position.set(-4, 0, -22);
        plate.castShadow = true;
        this.body.add(plate);

        this.canvas = document.createElement('canvas');
        this.canvas.width = HERO_W * PX;
        this.canvas.height = HERO_H * PX;
        this.canvas.getContext('2d', { willReadFrequently: true }); // see Card3D: a memory canvas uploads everywhere
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.faceMaterial = new THREE.MeshStandardNodeMaterial({ map: this.texture, transparent: true, roughness: 0.5 });
        // The cut-out as nodes, not alphaTest: an alphaTest that differs between shadow casters makes three.js re-key
        // every caster of the shadow pass each frame. The mask keeps the cut-out shape in the shadow.
        this.faceMaterial.alphaTestNode = float(0.05);
        this.faceMaterial.maskShadowNode = texture(this.texture).a.greaterThan(0.05);
        this.face = new THREE.Mesh(new THREE.PlaneGeometry(HERO_W, HERO_H), this.faceMaterial);
        this.face.castShadow = true;
        this.face.userData.hero = this;
        plate.userData.hero = this;
        this.body.add(this.face);
        this.plate = plate;

        // Mana gems on an ellipse around the portrait (classic: radius 145 x 112.5, 20 degree steps).
        this.gems = [];
        const gemGeometry = new THREE.OctahedronGeometry(15, 0);
        gemGeometry.scale(1, 1.25, 0.8);
        const radiusX = (HERO_W - 10) / 2, radiusY = (HERO_H - 25) / 2;
        const start = isPlayer ? 9 : 0, yOffset = isPlayer ? 0 : 25;
        for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2) / 180 + (Math.PI / 180) * 20 * (i + start);
            const gem = new THREE.Mesh(gemGeometry, new THREE.MeshStandardMaterial({
                color: MANA_COLOR.clone(), emissive: 0x1d3f66, emissiveIntensity: 0.8, roughness: 0.15, metalness: 0.35, transparent: true,
            }));
            gem.position.set(radiusX * Math.cos(a) - 2, -(radiusY * Math.sin(a) - 15 + yOffset), 18);
            gem.scale.setScalar(0.001);
            gem.castShadow = true;
            gem.userData.phase = i * 0.6;
            this.gems.push(gem);
            this.body.add(gem);
        }

        // Podium in the arena (stadium views): stone drum, gold rim and a glow in the team colour.
        this.podium = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(118, 140, 44, 48), new THREE.MeshStandardMaterial({ color: 0x5d5a56, roughness: 0.8 }));
        base.position.y = 22;
        base.castShadow = base.receiveShadow = true;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(119, 5, 8, 48), new THREE.MeshStandardMaterial({ color: 0xd4a73c, metalness: 0.8, roughness: 0.3 }));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 44;
        const glow = new THREE.Mesh(new THREE.RingGeometry(140, 190, 48), new THREE.MeshBasicMaterial({
            color: isPlayer ? 0x3498db : 0xe74c3c, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 1;
        this.podium.add(base, rim, glow);
        this.rim = rim;
        this.ring = glow;

        // The figure stands on the podium (the game places and turns it); none until its model has loaded. Once it
        // stands there (figure mode, see setFigureMode) it is the hero: the medallion gives way to a nameplate, an
        // invisible capsule around the figure takes the pointer, and the mana gems circle the podium's rim.
        this.figureRoot = new THREE.Group();
        this.figureRoot.name = this.name + '-figure';
        this.figure = null;
        this.figureMaterials = [];
        this.actions = {};
        this.lunge = new THREE.Vector3();
        this.figureMode = false;
        this.collider = new THREE.Mesh(new THREE.CylinderGeometry(80, 80, FIGURE_HEIGHT, 12), new THREE.MeshBasicMaterial({ visible: false }));
        this.collider.position.y = FIGURE_HEIGHT / 2;
        this.collider.userData.hero = this;
        this.figureRoot.add(this.collider);

        this.plateCanvas = document.createElement('canvas');
        this.plateCanvas.width = PLATE_W * PX;
        this.plateCanvas.height = PLATE_H * PX;
        this.plateCanvas.getContext('2d', { willReadFrequently: true });
        this.plateTexture = new THREE.CanvasTexture(this.plateCanvas);
        this.plateTexture.colorSpace = THREE.SRGBColorSpace;
        this.plateTexture.anisotropy = 8;
        this.nameplate = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H),
            new THREE.MeshBasicMaterial({ map: this.plateTexture, transparent: true, depthWrite: false, toneMapped: false }));
        this.nameplate.renderOrder = 5;
        this.nameplate.visible = false;
        this.nameplate.userData.hero = this;
        this.add(this.nameplate);

        this.rimGems = this.gems.map((gem, i) => {
            const a = (i / this.gems.length) * Math.PI * 2;
            const rimGem = new THREE.Mesh(gemGeometry, gem.material);
            rimGem.position.set(Math.cos(a) * 130, 62, Math.sin(a) * 130);
            rimGem.castShadow = true;
            rimGem.visible = false;
            this.podium.add(rimGem);
            return rimGem;
        });
        this.repaint();
    }

    /** Figure mode on or off (the game turns it on in the stadium views, once the figure has loaded). */
    setFigureMode(on) {
        on = on && !!this.figure;
        if (on === this.figureMode) return;
        this.figureMode = on;
        this.body.visible = !on;
        this.nameplate.visible = on;
        this.repaintPlate();
    }

    get pickables() { return this.figureMode ? [this.collider, this.nameplate] : [this.face, this.plate]; }

    /** What the hero's box on the screen is measured from (tooltips, keep-clear areas): the figure or the medallion. */
    get screenTarget() { return this.figureMode ? this.collider : this.face; }

    /** Where blows, beams and spells aim: the figure's chest, or the medallion. */
    aimPoint() {
        if (!this.figureMode) return this.position.clone();
        return this.collider.getWorldPosition(new THREE.Vector3()).setY(this.figureRoot.position.y + FIGURE_HEIGHT * 0.6 * this.figureRoot.scale.y);
    }

    /** Pointer over the hero, or a valid target: the figure lights up, or the medallion grows. */
    setHighlight(on, color = 0xffe08a) {
        this._highlight = on ? new THREE.Color(color) : null;
        if (!this.figureMode) this.body.scale.setScalar(on ? 1.1 : 1);
        this.nameplate.scale.setScalar(on ? 1.08 : 1);
        this.tint(this._highlight, 0.35);
    }

    /** Lights the figure's materials in a colour (null: back to normal). */
    tint(color, intensity) {
        for (const m of this.figureMaterials) {
            if (!m.emissive) continue;
            if (color) {
                m.emissive.copy(color);
                m.emissiveIntensity = intensity;
            } else {
                m.emissive.set(0x000000);
                m.emissiveIntensity = 1;
            }
        }
    }

    /** Loads the figure of the hero's class (once it is known), which greets and then waits. */
    async loadFigure(type) {
        if (this._figureType === type) return;
        this._figureType = type;
        const gltf = await fetchFigure(type);
        if (this._figureType !== type) return;
        if (this.figure) this.figureRoot.remove(this.figure);
        this.setFigureMode(false);
        this.figure = null;
        this.mixer = null;
        this.actions = {};
        this.current = null;
        if (!gltf) return;
        const figure = cloneSkinned(gltf.scene);
        // Feet on the podium, FIGURE_HEIGHT tall, whatever units the model has.
        const box = new THREE.Box3().setFromObject(figure);
        const scale = FIGURE_HEIGHT / Math.max(1e-3, box.max.y - box.min.y);
        figure.scale.setScalar(scale);
        figure.position.y = -box.min.y * scale;
        this.figureMaterials = [];
        figure.traverse(o => {
            if (!o.isMesh) return;
            o.castShadow = o.receiveShadow = true;
            o.frustumCulled = false; // the bounds are the bind pose's; an animated arm may reach out of them
            // Its own materials: the other hero may be the same class, and each lights up on its own.
            o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
            this.figureMaterials.push(...[o.material].flat());
        });
        this.mixer = new THREE.AnimationMixer(figure);
        for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
        this.figureRoot.add(figure);
        this.figure = figure;
        if (!this.play('greet')) this.play('idle');
    }

    /**
     * Plays one of the figure's animations (idle, greet, attack, hit, cast, death, victory), blending from the one
     * before; a one-shot goes back to idle when it ends (death stays down). Returns its length in ms (0: no figure).
     */
    play(name) {
        const action = this.actions[name];
        if (!action || (this.dead && name !== 'death')) return 0;
        const once = !LOOPS.has(name);
        action.reset();
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = once;
        action.play();
        if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.25, false);
        this.current = action;
        const ms = action.getClip().duration * 1000;
        clearTimeout(this._backToIdle);
        if (once && name !== 'death') this._backToIdle = setTimeout(() => { if (this.current === action) this.play('idle'); }, Math.max(0, ms - 250));
        return ms;
    }

    get pickables() { return [this.face, this.plate]; }

    /** Applies the server's hero info (strings: health, attack, mana, name, type; numbers: armor, maxHealth, maxMana). */
    setInfo(info) {
        if (!info) return;
        for (const key of ['name', 'attack', 'health', 'type', 'power', 'armor', 'maxHealth', 'maxMana', 'ident', 'rating']) {
            if (info[key] !== undefined && info[key] !== null && info[key] !== '') this.info[key] = info[key];
        }
        if (info.mana !== undefined && info.mana !== null) this.info.mana = Number(info.mana) || 0;
        if (this.info.type && this.info.type !== 'NA') this.loadFigure(Number(this.info.type));
        this.repaint();
        this.previewCost(this._previewCost);
    }

    setStat(key, value) {
        this.info[key] = value;
        this.repaint();
    }

    /** A pulsing glow on the plate (or the podium's rim and the nameplate): the hero can attack now. */
    setReady(on) {
        if (this.ready !== on) {
            this.ready = on;
            this.repaintPlate();
        }
        if (!on) {
            this.plate.material.emissive.set(0x000000);
            this.plate.material.emissiveIntensity = 1;
            this.rim.material.emissive.set(0x000000);
            this.rim.material.emissiveIntensity = 1;
        }
    }

    repaint() {
        this.repaintPlate();
        const key = JSON.stringify(['name', 'attack', 'health', 'type', 'armor', 'maxHealth'].map(k => this.info[k]));
        if (key === this._painted) return;
        this._painted = key;
        const token = (this._paintToken = (this._paintToken || 0) + 1);
        Promise.all([
            loadImage(Images.heroPortrait(this.info.type)).then(img => img || loadImage(Images.heroPortrait(0))),
            loadImage(this.isPlayer ? Images.playerFrame : Images.opponentFrame),
        ]).then(([portrait, frame]) => {
            if (token !== this._paintToken) return;
            const g = this.canvas.getContext('2d');
            g.setTransform(PX, 0, 0, PX, 0, 0);
            g.clearRect(0, 0, HERO_W, HERO_H);
            g.save();
            g.beginPath();
            g.ellipse(HERO_W / 2 - 4, HERO_H / 2, HERO_W / 2.2, HERO_H / 2.1, 0, 0, Math.PI * 2);
            g.clip();
            if (portrait) g.drawImage(portrait, 0, 0, HERO_W, HERO_H);
            g.restore();
            if (frame) g.drawImage(frame, 0, 0, HERO_W, HERO_H);

            const text = (value, x, y, size, opts = {}) => {
                g.font = `${opts.bold ? 'bold ' : ''}${size}px ${opts.family || 'Arial, Helvetica, sans-serif'}`;
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                if (opts.stroke !== false) {
                    g.lineJoin = 'round';
                    g.lineWidth = 8;
                    g.strokeStyle = '#000';
                    g.strokeText(String(value), x, y);
                }
                g.fillStyle = 'white';
                g.fillText(String(value), x, y, opts.maxWidth);
            };
            // Orbs and planks measured from player_frame.png / opponent_frame.png.
            const statY = this.isPlayer ? 182 : 69;
            text(this.info.attack, 40, statY, 35);
            text(this.info.health, 261, statY - 4, 35);
            if (Number(this.info.armor) > 0) {
                // A steel shield over the health orb's inner edge.
                const x = 214, y = statY + (this.isPlayer ? -6 : 0);
                g.save();
                g.beginPath();
                g.moveTo(x, y - 22);
                g.quadraticCurveTo(x + 19, y - 19, x + 20, y - 14);
                g.quadraticCurveTo(x + 20, y + 9, x, y + 22);
                g.quadraticCurveTo(x - 20, y + 9, x - 20, y - 14);
                g.quadraticCurveTo(x - 19, y - 19, x, y - 22);
                g.closePath();
                const metal = g.createLinearGradient(x, y - 22, x, y + 22);
                metal.addColorStop(0, '#d9e2ec');
                metal.addColorStop(1, '#3e4c59');
                g.fillStyle = metal;
                g.fill();
                g.lineWidth = 3;
                g.strokeStyle = '#111';
                g.stroke();
                g.restore();
                text(this.info.armor, x, y + 1, 24);
            }
            text(this.info.name, HERO_W / 2, this.isPlayer ? 230 : 22, 26, { family: 'Helvetica, Arial, sans-serif', stroke: false, maxWidth: 220 });
            this.texture.needsUpdate = true;
        });
    }

    /** Colours the mana gems like the classic client while a hand card is hovered (null to reset). */
    previewCost(cost) {
        this._previewCost = cost;
        const mana = Number(this.info.mana) || 0;
        this.gems.forEach((gem, i) => {
            let color = MANA_COLOR, visible = i < mana, opacity = 1;
            if (cost !== null && cost !== undefined && i < cost) {
                if (i < mana) color = mana >= cost ? MANA_OK : MANA_SHORT;
                else { color = MANA_MISSING; visible = true; opacity = 0.5; }
            }
            gem.material.color.copy(color);
            gem.material.opacity = opacity;
            const target = visible ? 1 : 0.001;
            if (gem.userData.target !== target) {
                gem.userData.target = target;
                tweens.to(gem.scale, { x: target, y: target, z: target }, visible ? 450 : 250, visible ? Ease.backOut : Ease.quadIn, visible ? i * 40 : 0);
            }
        });
    }

    /** Red flash when hit (classic: tint the portrait red; a figure glows red). */
    flash(times = 3, color = 0xff3030) {
        const material = this.faceMaterial;
        const glow = new THREE.Color(color);
        let n = 0;
        const step = () => {
            if (n++ >= times * 2) {
                material.color.set(0xffffff);
                this.tint(this._highlight, 0.35);
                return;
            }
            material.color.set(n % 2 ? color : 0xffffff);
            this.tint(n % 2 ? glow : this._highlight, n % 2 ? 0.9 : 0.35);
            tweens.wait(110).then(step);
        };
        step();
    }

    /** The nameplate: name, health bar, attack orb, health heart, armor shield; green when ready, grey when fallen. */
    repaintPlate() {
        if (!this.plateCanvas) return;
        const key = JSON.stringify([this.info.name, this.info.attack, this.info.health, this.info.maxHealth, this.info.armor, this.ready, this.dead, this.figureMode]);
        if (key === this._plated) return;
        this._plated = key;
        const g = this.plateCanvas.getContext('2d');
        g.setTransform(PX, 0, 0, PX, 0, 0);
        g.clearRect(0, 0, PLATE_W, PLATE_H);
        g.save();
        if (this.dead) g.filter = 'grayscale(1) brightness(0.6)';

        // Panel: dark glass in a gold frame, glowing green while the hero can attack.
        const panel = (x, y, w, h, r) => {
            g.beginPath();
            g.moveTo(x + r, y);
            g.arcTo(x + w, y, x + w, y + h, r);
            g.arcTo(x + w, y + h, x, y + h, r);
            g.arcTo(x, y + h, x, y, r);
            g.arcTo(x, y, x + w, y, r);
            g.closePath();
        };
        if (this.ready && !this.dead) {
            g.shadowColor = 'rgba(46, 204, 113, 0.95)';
            g.shadowBlur = 16;
        }
        panel(40, 30, 220, 62, 14);
        const glass = g.createLinearGradient(0, 30, 0, 92);
        glass.addColorStop(0, 'rgba(38, 28, 20, 0.94)');
        glass.addColorStop(1, 'rgba(12, 9, 7, 0.94)');
        g.fillStyle = glass;
        g.fill();
        g.shadowBlur = 0;
        g.lineWidth = 3;
        const gold = g.createLinearGradient(0, 30, 0, 92);
        gold.addColorStop(0, '#f5d27a');
        gold.addColorStop(1, '#8a6420');
        g.strokeStyle = this.ready && !this.dead ? '#5cf08f' : gold;
        g.stroke();

        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 21px Georgia, "Times New Roman", serif';
        g.fillStyle = '#f3e3b5';
        g.fillText(String(this.info.name ?? ''), PLATE_W / 2, 52, 150);

        // Health bar under the name.
        const health = Math.max(0, Number(this.info.health) || 0);
        const max = Math.max(health, Number(this.info.maxHealth) || health || 1);
        panel(78, 68, 144, 12, 6);
        g.fillStyle = 'rgba(0, 0, 0, 0.7)';
        g.fill();
        if (health > 0) {
            panel(80, 70, 140 * health / max, 8, 4);
            const bar = g.createLinearGradient(80, 0, 220, 0);
            bar.addColorStop(0, '#ff5a4a');
            bar.addColorStop(1, '#b3121f');
            g.fillStyle = bar;
            g.fill();
        }

        const number = (value, x, y, size) => {
            g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
            g.lineJoin = 'round';
            g.lineWidth = 6;
            g.strokeStyle = '#000';
            g.strokeText(String(value), x, y + 1);
            g.fillStyle = '#fff';
            g.fillText(String(value), x, y + 1);
        };
        // Attack: a green orb on the left.
        const orb = g.createRadialGradient(36, 54, 4, 40, 60, 30);
        orb.addColorStop(0, '#a6f07a');
        orb.addColorStop(0.6, '#3c9a22');
        orb.addColorStop(1, '#174d0c');
        g.beginPath();
        g.arc(40, 61, 29, 0, Math.PI * 2);
        g.fillStyle = orb;
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = gold;
        g.stroke();
        number(this.info.attack, 40, 61, 28);

        // Health: a red heart on the right.
        const hx = 260, hy = 62;
        g.beginPath();
        g.moveTo(hx, hy + 26);
        g.bezierCurveTo(hx - 34, hy + 2, hx - 30, hy - 26, hx, hy - 12);
        g.bezierCurveTo(hx + 30, hy - 26, hx + 34, hy + 2, hx, hy + 26);
        g.closePath();
        const heart = g.createRadialGradient(hx - 8, hy - 10, 4, hx, hy, 32);
        heart.addColorStop(0, '#ff8f80');
        heart.addColorStop(0.6, '#d42032');
        heart.addColorStop(1, '#6e0a12');
        g.fillStyle = heart;
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = gold;
        g.stroke();
        number(this.info.health, hx, hy - 1, 26);

        // Armor: a steel shield over the heart's corner.
        if (Number(this.info.armor) > 0) {
            const x = 228, y = 34;
            g.beginPath();
            g.moveTo(x, y - 17);
            g.quadraticCurveTo(x + 15, y - 15, x + 16, y - 11);
            g.quadraticCurveTo(x + 16, y + 7, x, y + 18);
            g.quadraticCurveTo(x - 16, y + 7, x - 16, y - 11);
            g.quadraticCurveTo(x - 15, y - 15, x, y - 17);
            g.closePath();
            const steel = g.createLinearGradient(x, y - 17, x, y + 18);
            steel.addColorStop(0, '#e3ebf3');
            steel.addColorStop(1, '#46525e');
            g.fillStyle = steel;
            g.fill();
            g.lineWidth = 2;
            g.strokeStyle = '#111';
            g.stroke();
            number(this.info.armor, x, y, 19);
        }
        g.restore();
        this.plateTexture.needsUpdate = true;
    }

    /** Idle animation: gems bob and spin; a ready hero glows; the figure moves. */
    update(now) {
        if (this.mixer) this.mixer.update(Math.min(0.1, (now - (this._lastNow ?? now)) / 1000));
        this._lastNow = now;
        if (this.ready) {
            this.plate.material.emissive.set(0x2ecc71);
            this.plate.material.emissiveIntensity = 0.35 + 0.3 * Math.sin(now * 0.005);
            this.rim.material.emissive.copy(READY);
            this.rim.material.emissiveIntensity = 0.6 + 0.5 * Math.sin(now * 0.005);
        }
        // The ring of the hero whose turn it is glows brighter and breathes.
        this.ring.material.opacity = this.turnLit ? 0.65 + 0.2 * Math.sin(now * 0.004) : 0.3;
        // The mana gems circle the podium's rim in figure mode, growing and colouring with the medallion's.
        this.rimGems.forEach((rimGem, i) => {
            const gem = this.gems[i];
            rimGem.visible = this.figureMode && gem.scale.x > 0.002;
            rimGem.scale.copy(gem.scale).multiplyScalar(0.9);
            rimGem.rotation.y = now * 0.0015 + gem.userData.phase;
            rimGem.position.y = 62 + Math.sin(now * 0.003 + gem.userData.phase) * 4;
        });
        for (const gem of this.gems) {
            gem.visible = gem.scale.x > 0.002; // spent gems shrink to nothing: skip drawing them
            gem.rotation.y = now * 0.0015 + gem.userData.phase;
            gem.position.z = 18 + Math.sin(now * 0.003 + gem.userData.phase) * 3;
        }
    }
}
