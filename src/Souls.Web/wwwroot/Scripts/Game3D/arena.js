// The arena. In the classic (top-down) view it is the classic background picture, exactly as in the classic
// client. In the other views a fantasy stadium rises out of the ground around the sand (stadium.js: the building,
// surfaces.js: its materials, spectators.js: the crowd): an arena wall with banners and torches, three rings of
// terraces packed with a cheering crowd, round gate towers with braziers, two gatehouses with the "Souls" screens
// and their soul spires, a colonnaded gallery, an arcaded façade, beacon spires and a night sky with a moon.
//
// Lighting has two parts. The board (cards, heroes, sand) keeps its bright rig in the scene: ambient, hemisphere and
// a shadow-casting key light, plus the gate towers' fires on high quality. The stadium has its own darker rig (a
// cool moon and the night sky, `stadiumLights`) and warm fire light baked into its vertices, so it frames the board
// without competing with it.
import * as THREE from '/lib/three/three.webgpu.js';
import { attribute, length, lights, positionView, screenDPR, smoothstep, uniformArray, uv, vec4 } from '/lib/three/three.tsl.js';
import { Images, loadImage, textureFrom } from './assets.js';
import { toWorld, spriteGeometry, STAGE_W, STAGE_H } from './scene.js';
import { buildStadium, WALL_R, SCREEN_W, SCREEN_H, STANDS_OUT } from './stadium.js';
import { CONTACTS, MOON, fireSprites, groundMaterial, hillsGeometry, sandMaterial, skyMaterial, stadiumMaterials, stadiumUniforms, rise } from './surfaces.js';
import { Crowd } from './spectators.js';

// The screen is drawn in 1024x576 units onto a half-size canvas: it is never shown larger than that on screen, and a
// WebGPU canvas upload (ten a second) costs CPU time in proportion to its pixels.
const SCREEN_SCALE = 0.5;
/** Words the stadium screens show by themselves (the rest comes from the game). */
const SCREEN_TEXT = { title: 'SOULS', versus: 'VS' };

/** The stadium's light (not the board's): a cool moon, the night sky and the warm ground bounce. */
const MOON_COLOR = new THREE.Color(0xc4ceff);
const MOON_INTENSITY = 4.5;
const SKY_COLOR = new THREE.Color(0x4a5680);
const GROUND_COLOR = new THREE.Color(0x5a4535);
const SKY_INTENSITY = 3.0;


// ---- The classic picture ----------------------------------------------------------------------------------------

function pictureGeometry() {
    // The picture continues past its edges (mirrored and darkened) so other window shapes have no empty bars.
    const width = STAGE_W * 3.5, height = STAGE_H * 5, step = 120;
    const geometry = new THREE.PlaneGeometry(width, height, Math.round(width / step), Math.round(height / (step * 0.9)));
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        uv.setXY(i, (x + STAGE_W / 2) / STAGE_W, 1 - (z + STAGE_H / 2) / STAGE_H);
        const outside = Math.hypot(Math.max(0, Math.abs(x) - STAGE_W / 2), Math.max(0, Math.abs(z) - STAGE_H / 2));
        const shade = outside === 0 ? 1 : 0.45 * Math.exp(-outside / 160);
        colors.set([shade, shade, shade], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
}

/** UVs that map world x/z onto the classic picture. */
function pictureUvs(geometry) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, (pos.getX(i) + STAGE_W / 2) / STAGE_W, 1 - (pos.getZ(i) + STAGE_H / 2) / STAGE_H);
    }
    return geometry;
}

/** Camera flashes popping in the stands. */
function buildFlashes(places, count) {
    const picks = [];
    for (let i = 0; i < count && places.length; i++) picks.push(places[Math.floor(Math.random() * places.length)]);
    const geometry = spriteGeometry({
        point: new THREE.InstancedBufferAttribute(new Float32Array(picks.flatMap(p => [p.x, p.y + 44, p.z])), 3),
        flash: new THREE.InstancedBufferAttribute(new Float32Array(picks.length), 1).setUsage(THREE.DynamicDrawUsage),
    }, picks.length);
    const material = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
    const flash = attribute('flash', 'float');
    material.positionNode = attribute('point', 'vec3');
    material.sizeNode = flash.mul(9000).div(positionView.z.negate()).div(screenDPR); // device pixels
    material.colorNode = vec4(1.0, 0.98, 0.9, flash.mul(smoothstep(0, 0.5, length(uv().sub(0.5))).oneMinus()));
    const points = new THREE.Mesh(geometry, material);
    points.frustumCulled = false;
    return points;
}

/**
 * The big stadium screen on the two pillars: the SOULS logo glowing on an LED wall, a ticker with both players'
 * health during a match, and a flash for big moments ("KO!", "VICTORY!"). Redrawn about ten times a second.
 */
class StadiumScreen {
    /** `memory`: draw in memory (see Card3D) for WebGPU. WebGL uploads a GPU canvas far cheaper, ten times a second. */
    constructor(memory) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024 * SCREEN_SCALE;
        this.canvas.height = 576 * SCREEN_SCALE;
        this.canvas.getContext('2d', { willReadFrequently: memory });
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.scoreboard = null;
        this.flashText = null;
        this.flashUntil = 0;
        this.lastDraw = -Infinity;
        loadImage(Images.logo).then(img => { this.logo = img; });
        // LED grid, drawn once and laid over every frame.
        this.grid = document.createElement('canvas');
        this.grid.width = 1024;
        this.grid.height = 576;
        const g = this.grid.getContext('2d', { willReadFrequently: memory }); // drawn into the screen: the same kind
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 576);
        for (let y = 0; y < 576; y += 4) g.fillRect(0, y, 1024, 1);
    }

    flash(text) {
        this.flashText = text;
        this.flashUntil = performance.now() + 1800;
        this.lastDraw = -Infinity;
    }

    update(now) {
        if (now - this.lastDraw < 100) return;
        this.lastDraw = now;
        const g = this.canvas.getContext('2d');
        g.setTransform(SCREEN_SCALE, 0, 0, SCREEN_SCALE, 0, 0); // shadowBlur is in canvas pixels, so it is scaled below
        const W = 1024, H = 576;
        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#050914');
        bg.addColorStop(1, '#0d1f3c');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        // Sweeping light behind the logo.
        const sweep = (now * 0.0004) % 1.6 - 0.3;
        const glow = g.createLinearGradient(W * sweep - 200, 0, W * sweep + 200, H);
        glow.addColorStop(0, 'rgba(120,255,60,0)');
        glow.addColorStop(0.5, 'rgba(120,255,60,0.18)');
        glow.addColorStop(1, 'rgba(120,255,60,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);

        const flashing = this.flashText && now < this.flashUntil;
        if (flashing) {
            const t = 1 - (this.flashUntil - now) / 1800;
            g.save();
            g.translate(W / 2, H / 2);
            g.scale(1 + 0.15 * Math.sin(t * Math.PI * 6), 1 + 0.15 * Math.sin(t * Math.PI * 6));
            g.font = 'italic bold 190px Arial Black, Arial, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.shadowColor = '#ff3b30';
            g.shadowBlur = 40 * SCREEN_SCALE;
            g.fillStyle = Math.floor(t * 12) % 2 ? '#ffd400' : '#ffffff';
            g.fillText(this.flashText, 0, 0, W - 80);
            g.restore();
        } else {
            const pulse = 0.75 + 0.25 * Math.sin(now * 0.003);
            g.save();
            g.shadowColor = `rgba(150,255,80,${pulse})`;
            g.shadowBlur = 50 * SCREEN_SCALE;
            if (this.logo) {
                const w = 760, h = w * this.logo.height / this.logo.width;
                g.drawImage(this.logo, (W - w) / 2, this.scoreboard ? 40 : (H - h) / 2, w, h);
            } else {
                g.font = 'italic bold 200px Georgia, serif';
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillStyle = '#f4f4f4';
                g.fillText(SCREEN_TEXT.title, W / 2, H / 2);
            }
            g.restore();
            if (this.scoreboard) {
                const { player, opponent } = this.scoreboard;
                g.fillStyle = 'rgba(0,0,0,0.55)';
                g.fillRect(0, H - 150, W, 150);
                g.font = 'bold 50px Arial, sans-serif';
                g.textBaseline = 'middle';
                g.fillStyle = '#5dade2';
                g.textAlign = 'left';
                g.fillText(`${player.name}  \u2665${player.health}`, 30, H - 75, W / 2 - 90);
                g.fillStyle = '#ec7063';
                g.textAlign = 'right';
                g.fillText(`\u2665${opponent.health}  ${opponent.name}`, W - 30, H - 75, W / 2 - 90);
                g.fillStyle = '#f1c40f';
                g.textAlign = 'center';
                g.fillText(SCREEN_TEXT.versus, W / 2, H - 75);
            }
        }
        g.drawImage(this.grid, 0, 0);
        this.texture.needsUpdate = true;
    }
}


/** Faint shafts of light from the beacon spires down to the sand (one mesh). */
function lightShafts(heads, u) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    material.colorNode = vec4(1.0, 0.93, 0.78, uv().y.mul(uv().y).mul(0.05).mul(u.uRise.sub(0.35).div(0.65).clamp(0, 1)));
    const cones = heads.map(h => {
        const length = Math.hypot(h.x, h.y, h.z) * 0.85;
        const cone = new THREE.ConeGeometry(560, length, 32, 1, true);
        const dir = h.clone().negate().normalize();
        const m = new THREE.Matrix4().compose(h.clone().addScaledVector(dir, length / 2),
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir), new THREE.Vector3(1, 1, 1));
        return cone.applyMatrix4(m);
    });
    const geometry = new THREE.BufferGeometry();
    const parts = cones.map(c => c.toNonIndexed());
    const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    let o = 0;
    for (const g of parts) {
        pos.set(g.attributes.position.array, o * 3);
        uvs.set(g.attributes.uv.array, o * 2);
        o += g.attributes.position.count;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return new THREE.Mesh(geometry, material);
}

/** Stars: small points over the upper sky that twinkle a little. */
function stars(count) {
    const pts = [];
    let s = 3;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2, e = Math.asin(0.12 + rnd() * 0.88);
        pts.push(Math.cos(a) * Math.cos(e) * 28000, Math.sin(e) * 28000, Math.sin(a) * Math.cos(e) * 28000, rnd());
    }
    const geometry = spriteGeometry({ star: new THREE.InstancedBufferAttribute(new Float32Array(pts), 4) }, count);
    const material = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false });
    const star = attribute('star', 'vec4');
    material.positionNode = star.xyz;
    material.sizeNode = star.w.mul(star.w).mul(2.6).add(1.1);
    const glow = smoothstep(0, 0.5, length(uv().sub(0.5))).oneMinus();
    const bright = star.w.mul(0.8).add(0.25).mul(smoothstep(1500, 9000, star.y));
    material.colorNode = vec4(0.85, 0.9, 1.0, glow.mul(bright));
    const points = new THREE.Mesh(geometry, material);
    points.frustumCulled = false;
    return points;
}

// ---- The arena ----------------------------------------------------------------------------------------------------

export class Arena {
    /** `backend`: 'webgpu' or 'webgl2' (Stage.backend); `camera`: the live camera (picks the crowd's detail). */
    constructor(scene, quality, backend, camera) {
        this.scene = scene;
        this.quality = quality;
        this.backend = backend;
        this.camera = camera;
        this.lowPower = quality !== 'high';
        this.rise = 0; // 0 = classic picture, 1 = stadium
        this.target = 0;
        this.excite = 0.1;
        this.uniforms = stadiumUniforms();
        this.contacts = uniformArray(new Array(CONTACTS).fill(0).map(() => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
        this.waveUntil = 0;
        this.nextWave = 20000;
    }

    async build() {
        const scene = this.scene;
        const u = this.uniforms;
        const picture = textureFrom(await loadImage(Images.arena));
        picture.wrapS = picture.wrapT = THREE.MirroredRepeatWrapping;

        // Classic view: the picture, unlit, with a shadow layer for the 3D pieces.
        const geometry = pictureGeometry();
        this.pictureMaterial = new THREE.MeshBasicMaterial({ map: picture, vertexColors: true, toneMapped: false, transparent: true, fog: false });
        this.picture = new THREE.Mesh(geometry, this.pictureMaterial);
        this.picture.position.y = 0.3;
        this.picture.renderOrder = -2;
        this.shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.38 });
        this.shadows = new THREE.Mesh(geometry, this.shadowMaterial);
        this.shadows.position.y = 0.6;
        this.shadows.receiveShadow = true;
        scene.add(this.picture, this.shadows);

        // The sand inside the arena wall, lit like the board.
        const sand = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 2, 96).rotateX(-Math.PI / 2), sandMaterial(u, this.contacts, this.quality));
        sand.receiveShadow = true;
        scene.add(sand);

        // The stadium's own light (see the top of this file). Not in the scene: only the stadium's materials use it.
        const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INTENSITY);
        moon.position.copy(MOON).multiplyScalar(5000);
        const sky = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, SKY_INTENSITY);
        sky.position.set(0, 1, 0);
        for (const l of [moon, moon.target, sky]) l.updateMatrixWorld(true);

        // Fire light on the board from the gate towers' braziers (high quality), flickering with the flames.
        const plan = buildStadium(this.quality);
        this.towerLights = this.quality === 'high' ? plan.torches.map(t => {
            const light = new THREE.PointLight(0xff9a3c, 60000, 1100, 2);
            light.position.copy(t).setY(250);
            light.userData.flicker = t.x * 0.01 + t.z * 0.003;
            scene.add(light);
            return light;
        }) : [];
        const stadiumLights = lights([moon, sky]);

        // The stadium (hidden in the classic view, rises out of the ground when leaving it).
        this.stadium = new THREE.Group();
        this.stadium.name = 'stadium';
        const materials = stadiumMaterials(u, stadiumLights, this.quality);
        for (const [slot, g] of Object.entries(plan.geometries)) {
            const mesh = new THREE.Mesh(g, materials[slot]);
            mesh.name = `stadium-${slot}`;
            mesh.castShadow = slot === 'stone' && this.quality === 'high';
            mesh.frustumCulled = false; // it surrounds the camera; its bounding sphere is in view anyway
            this.stadium.add(mesh);
        }
        this.torchPoints = plan.torches;
        this.fires = fireSprites(plan.fires, u);
        this.stadium.add(this.fires);

        this.screen = new StadiumScreen(this.backend === 'webgpu');
        const display = new THREE.MeshBasicNodeMaterial({ map: this.screen.texture, toneMapped: false });
        display.positionNode = rise(u, 0.15);
        for (const s of plan.screens) {
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H).rotateY(s.rotation).translate(s.position.x, s.position.y, s.position.z), display);
            this.stadium.add(mesh);
        }

        this.crowd = new Crowd(u, this.quality, {
            moon: MOON, moonColor: MOON_COLOR.clone().multiplyScalar(MOON_INTENSITY),
            sky: SKY_COLOR.clone().multiplyScalar(SKY_INTENSITY), ground: GROUND_COLOR.clone().multiplyScalar(SKY_INTENSITY),
        }, plan.lights);
        this.stadium.add(this.crowd.group);
        this.flashes = buildFlashes(this.crowd.places, this.quality === 'high' ? 220 : 80);
        this.stadium.add(this.flashes);
        this.stadium.add(lightShafts(plan.beaconHeads, u));

        // Sky, stars, hills on the horizon and the ground around the stadium.
        // Drawn after the opaque stadium (renderOrder) so the depth test skips the sky behind it.
        const skyDome = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), skyMaterial(u, this.quality));
        skyDome.renderOrder = 10;
        this.stadium.add(skyDome);
        this.stadium.add(stars(this.lowPower ? 500 : 1600));
        const hills = new THREE.MeshBasicNodeMaterial({ color: 0x0b0a12, side: THREE.DoubleSide });
        this.stadium.add(new THREE.Mesh(hillsGeometry(), hills));
        const outside = new THREE.Mesh(new THREE.RingGeometry(STANDS_OUT, 25000, 64, 1).rotateX(-Math.PI / 2), groundMaterial(stadiumLights));
        outside.position.y = -3;
        outside.renderOrder = 5;
        this.stadium.add(outside);
        this.stadium.visible = false;
        scene.add(this.stadium);

        // Lights for the board, tuned so a card lying face up shows its artwork's colours.
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6b5a40, 0.5));
        const sun = new THREE.DirectionalLight(0xfff3e0, 1.9);
        sun.position.set(-700, 2200, -500);
        sun.target.position.set(0, 0, 0);
        sun.castShadow = this.quality !== 'low';
        sun.shadow.mapSize.set(this.lowPower ? 1024 : 2048, this.lowPower ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -1300, right: 1300, top: 1000, bottom: -1000, near: 500, far: 5000 });
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 1;
        scene.add(sun, sun.target);
        scene.background = new THREE.Color(0x05060c);
        scene.fog = new THREE.Fog(0x14111f, 6000, 20000);
        this.apply();
    }

    /** Raises (true) or lowers (false) the stadium. */
    setStadium(on) {
        this.target = on ? 1 : 0;
    }

    /** What the stadium screens show: null, or { player: {name, health}, opponent: {name, health} }. */
    set scoreboard(value) {
        if (this.screen) this.screen.scoreboard = value;
    }

    /** Big text on the stadium screens for a moment. */
    screenFlash(text) {
        if (this.screen) this.screen.flash(text);
    }

    /** A Mexican wave around the stands. */
    wave() {
        if (performance.now() < this.waveUntil) return;
        this.waveStart = performance.now();
        this.waveUntil = this.waveStart + 5200;
        this.waveFrom = Math.random() * Math.PI * 2;
    }

    /** World positions of the braziers on the gate towers (for embers and flame jets). */
    get torches() {
        return (this.torchPoints || []).map(t => t.clone());
    }

    /** The crowd gets louder and jumps (0..1). */
    cheer(amount) {
        this.excite = Math.min(1, this.excite + amount);
    }

    /** Soft contact shadows on the sand: up to CONTACTS ellipses [x, z, radius x, radius z] (cards, heroes). */
    setContacts(list) {
        const arr = this.contacts.array;
        for (let i = 0; i < CONTACTS; i++) {
            const c = list[i];
            if (c) arr[i].set(c[0], c[1], c[2], c[3]);
            else arr[i].set(0, 0, 0, 0);
        }
    }

    apply() {
        const r = this.rise;
        this.stadium.visible = r > 0.001;
        this.uniforms.uRise.value = r;
        this.pictureMaterial.opacity = THREE.MathUtils.clamp(1 - r * 2, 0, 1);
        this.picture.visible = this.pictureMaterial.opacity > 0.001;
        this.shadowMaterial.opacity = 0.38 * this.pictureMaterial.opacity;
        this.shadows.visible = this.picture.visible;
    }

    update(now, dt) {
        if (!this.stadium) return;
        // Wall-clock based so slow devices do not stretch the transition.
        const elapsed = Math.min(250, now - (this.lastNow ?? now));
        this.lastNow = now;
        if (this.rise !== this.target) {
            const step = elapsed / 1700;
            this.rise = this.target > this.rise ? Math.min(this.target, this.rise + step) : Math.max(this.target, this.rise - step * 1.5);
            this.apply();
        }
        const u = this.uniforms;
        this.excite = 0.1 + (this.excite - 0.1) * Math.exp(-dt / 1800);
        u.uTime.value = now / 1000;
        u.uExcite.value = this.excite;
        u.uFlicker.value = 0.92 + 0.08 * Math.sin(now * 0.011) * Math.sin(now * 0.0047 + 1.3);
        // The wave goes once around the stadium; one starts by itself every now and then.
        if (this.stadium.visible && now > this.nextWave) {
            this.nextWave = now + 25000 + Math.random() * 20000;
            this.wave();
        }
        const waveT = (now - (this.waveStart ?? -1e9)) / 5200;
        u.uWaveAmp.value = waveT >= 0 && waveT <= 1 ? Math.min(1, Math.sin(Math.PI * waveT) * 2.2) : 0;
        if (waveT >= 0 && waveT <= 1) u.uWave.value = this.waveFrom + waveT * Math.PI * 2;
        if (!this.stadium.visible) return;
        this.screen.update(now);
        if (this.camera) this.crowd.update(this.camera);
        for (const light of this.towerLights) {
            const f = light.userData.flicker;
            light.intensity = 60000 * (0.85 + 0.15 * Math.sin(now * 0.02 + f) * Math.sin(now * 0.013 + f * 2));
        }
        // Camera flashes: more of them when the crowd is excited.
        const flash = this.flashes.geometry.attributes.flash;
        for (let i = 0; i < flash.count; i++) {
            let v = flash.getX(i) * Math.exp(-dt / 90);
            if (Math.random() < dt * (0.00004 + 0.0008 * this.excite)) v = 1;
            flash.setX(i, v);
        }
        flash.needsUpdate = true;
    }
}


/** Centre of a board slot (classic: x = 520 + 1920/13 * i, y = 700 for the player and 420 for the opponent). */
export function slotPosition(isPlayer, slotId) {
    return toWorld(520 + (1920 / 13) * slotId, isPlayer ? 700 : 420, 1.5);
}
