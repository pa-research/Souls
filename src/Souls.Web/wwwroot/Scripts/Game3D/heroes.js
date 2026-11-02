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

const READY = new THREE.Color(0x2ecc71);

// One load per class; each hero plays a copy (both heroes may be the same class).
const figures = new Map();
function fetchFigure(type) {
    // A failed load is forgotten, so the next hero info tries again.
    if (!figures.has(type)) figures.set(type, new GLTFLoader().loadAsync(`/Content/Models/Heroes/${type}.glb`).catch(() => { figures.delete(type); return null; }));
    return figures.get(type);
}

// The figures' animations (tools/heroes/prepare.py names them): idle loops, the others play once.
const LOOPS = new Set(['idle', 'victory']);
// The part of a one-shot the game plays, in seconds: Tripo's attack swings at 2.1 s (the game's blow lands 0.32 s after
// the attack starts) and the cast's hands peak at 1.2 s; the rest of each is a slow wind-down.
const CUTS = { attack: [1.75, 3.3], cast: [0.6, 2.8] };

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
        // stands there (figure mode, see setFigureMode) it is the hero: the medallion gives way to the figure (its name and
        // numbers go to a plaque in the HUD, ui.js), an invisible capsule around it takes the pointer, and the mana gems
        // circle the podium's rim.
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
    }

    get pickables() { return this.figureMode ? [this.collider] : [this.face, this.plate]; }

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
        this.body.scale.setScalar(on && !this.figureMode ? 1.1 : 1);
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
        if (!gltf) {
            this._figureType = null;
            return;
        }
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
            // The arena has no environment map: metal would only mirror black, so it keeps some of the lights' colour.
            for (const m of [o.material].flat()) if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.4);
            this.figureMaterials.push(...[o.material].flat());
        });
        this.mixer = new THREE.AnimationMixer(figure);
        for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
        this.figureRoot.add(figure);
        this.figure = figure;
        if (this.dead) {
            // It fell before its figure came: lying down already.
            const death = this.actions.death;
            if (death) {
                this.play('death');
                death.time = death.getClip().duration;
                this.mixer.update(0);
            }
        } else if (!this.play('greet')) this.play('idle');
    }

    /**
     * Plays one of the figure's animations (idle, greet, attack, hit, cast, death, victory), blending from the one
     * before; a one-shot goes back to idle when it ends (death stays down). Returns its length in ms (0: no figure).
     */
    play(name) {
        const action = this.actions[name];
        if (!action || (this.dead && name !== 'death')) return 0;
        const once = !LOOPS.has(name);
        const [from, to] = CUTS[name] ?? [0, action.getClip().duration];
        action.reset();
        action.time = from;
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = once;
        action.play();
        if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.25, false);
        this.current = action;
        const ms = (to - from) * 1000;
        clearTimeout(this._backToIdle);
        if (once && name !== 'death') this._backToIdle = setTimeout(() => { if (this.current === action) this.play('idle'); }, Math.max(0, ms - 250));
        return ms;
    }

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

    /** A glow on the plate (or the podium's rim; the HUD plaque shows it too): the hero can attack now. */
    setReady(on) {
        this.ready = on;
        if (!on) {
            this.plate.material.emissive.set(0x000000);
            this.plate.material.emissiveIntensity = 1;
            this.rim.material.emissive.set(0x000000);
            this.rim.material.emissiveIntensity = 1;
        }
    }

    repaint() {
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
            this.tint(n % 2 ? glow : this._highlight, n % 2 ? 0.2 : 0.35);
            tweens.wait(110).then(step);
        };
        step();
    }

    /** Every frame: gems bob and spin; a ready hero glows; the figure moves. */
    update(now) {
        if (this.mixer) this.mixer.update(Math.min(0.1, (now - (this._lastNow ?? now)) / 1000));
        this._lastNow = now;
        if (this.ready) {
            this.plate.material.emissive.set(0x2ecc71);
            this.plate.material.emissiveIntensity = 0.45;
            this.rim.material.emissive.copy(READY);
            this.rim.material.emissiveIntensity = 0.8;
        }
        // The ring of the hero whose turn it is is brighter.
        this.ring.material.opacity = this.turnLit ? 0.7 : 0.3;
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
