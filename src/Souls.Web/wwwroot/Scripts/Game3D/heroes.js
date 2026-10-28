// Heroes: the classic portrait medallion as a 3D shield floating above the arena, with mana gems around it.
import * as THREE from '/lib/three/three.module.js';
import { Images, loadImage } from './assets.js';
import { tweens, Ease } from './tween.js';

const HERO_W = 300;
const HERO_H = 250;
const PX = 2; // canvas pixels per classic pixel

const MANA_COLOR = new THREE.Color(0x6e93b3);
const MANA_OK = new THREE.Color(0x4cd328);
const MANA_SHORT = new THREE.Color(0xfffe00);
const MANA_MISSING = new THREE.Color(0xe52a2a);

function ellipseShape(rx, ry) {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    return shape;
}

export class Hero3D extends THREE.Group {
    constructor(isPlayer) {
        super();
        this.isPlayer = isPlayer;
        this.info = { name: 'NA', attack: 'NA', health: 'NA', mana: 0, type: 0 };
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
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.faceMaterial = new THREE.MeshStandardMaterial({ map: this.texture, transparent: true, alphaTest: 0.05, roughness: 0.5 });
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
        this.repaint();
    }

    get pickables() { return [this.face, this.plate]; }

    /** Applies the server's hero info (strings: health, attack, mana, name, type). Missing keys are kept. */
    setInfo(info) {
        if (!info) return;
        for (const key of ['name', 'attack', 'health', 'type']) {
            if (info[key] !== undefined && info[key] !== null && info[key] !== '') this.info[key] = info[key];
        }
        if (info.mana !== undefined && info.mana !== null) this.info.mana = Number(info.mana) || 0;
        this.repaint();
        this.previewCost(this._previewCost);
    }

    setStat(key, value) {
        this.info[key] = value;
        this.repaint();
    }

    repaint() {
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

    /** Red flash when hit (classic: tint the portrait red). */
    flash(times = 3, color = 0xff3030) {
        const material = this.faceMaterial;
        let n = 0;
        const step = () => {
            if (n++ >= times * 2) { material.color.set(0xffffff); return; }
            material.color.set(n % 2 ? color : 0xffffff);
            tweens.wait(110).then(step);
        };
        step();
    }

    /** Idle animation: gems bob and spin. */
    update(now) {
        for (const gem of this.gems) {
            gem.rotation.y = now * 0.0015 + gem.userData.phase;
            gem.position.z = 18 + Math.sin(now * 0.003 + gem.userData.phase) * 3;
        }
    }
}
