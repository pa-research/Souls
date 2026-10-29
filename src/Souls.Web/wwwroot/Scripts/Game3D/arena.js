// The arena. In the classic (top-down) view it is the classic background picture, exactly as in the classic
// client. In the other views a 3D stadium rises out of the ground around the sand: an arena wall in team
// colours, terraces packed with a cheering crowd, the two "Souls" tunnel towers, gate towers with torches,
// floodlights, flags and a dusk sky.
import * as THREE from '/lib/three/three.module.js';
import { Images, loadImage, textureFrom } from './assets.js';
import { toWorld, STAGE_W, STAGE_H } from './scene.js';

const deg = THREE.MathUtils.degToRad;

const SAND = 705; // radius of the sand circle in the picture
const WALL_R = SAND + 12;
const WALL_H = 74;
const TIERS = 16;
const TIER_DEPTH = 58;
const TIER_RISE = 30;
const STANDS_IN = WALL_R + 30;
const STANDS_OUT = STANDS_IN + TIERS * TIER_DEPTH;
const TOP = WALL_H + TIERS * TIER_RISE;
const GAP = deg(13); // the stands open at +x and -x for the tunnel towers
const ARCS = [[GAP, Math.PI - GAP], [Math.PI + GAP, 2 * Math.PI - GAP]];
const AISLES = 14; // radial stairways per side
const PILLAR_H = 1250;
const SCREEN_W = 300;
const SCREEN_H = 169;
const SCREEN_Y = 380; // just above the tunnel mouth, so it is in view from the arena

const STONE = new THREE.Color(0x4b4e57);
const RISER = new THREE.Color(0x585b64);
const TREAD = new THREE.Color(0x8d9098);
const AISLE = new THREE.Color(0xb3b5bb);
const RED = new THREE.Color(0xa93226);
const BLUE = new THREE.Color(0x2471a3);

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

// ---- Stadium geometry -------------------------------------------------------------------------------------------

/** Arena wall, terraces and outer wall as one mesh with flat-shaded steps and vertex colours. */
function terraceGeometry(segments) {
    const pos = [], nor = [], col = [];
    const radial = (t, r, y) => [Math.cos(t) * r, y, Math.sin(t) * r];
    const push = (verts, normals, color) => {
        for (const i of [0, 1, 2, 0, 2, 3]) {
            pos.push(...verts[i]);
            nor.push(...normals[i]);
            col.push(color.r, color.g, color.b);
        }
    };
    const up = [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
    const inward = (t0, t1) => {
        const a = [-Math.cos(t0), 0, -Math.sin(t0)], b = [-Math.cos(t1), 0, -Math.sin(t1)];
        return [a, b, b, a];
    };
    const outward = (t0, t1) => inward(t0, t1).map(n => n.map(v => -v));
    for (const [a0, a1] of ARCS) {
        for (let i = 0; i < segments; i++) {
            const t0 = a0 + (a1 - a0) * i / segments;
            const t1 = a0 + (a1 - a0) * (i + 1) / segments;
            const tm = (t0 + t1) / 2;
            const team = Math.sin(tm) > 0 ? BLUE : RED; // player side blue, opponent side red
            const aisle = Math.abs(((tm - a0) / (a1 - a0)) * AISLES % 1 - 0.5) > 0.47;
            // Arena wall: stone below, a team-coloured band on top, then the walkway.
            push([radial(t0, WALL_R, 0), radial(t1, WALL_R, 0), radial(t1, WALL_R, WALL_H - 22), radial(t0, WALL_R, WALL_H - 22)], inward(t0, t1), STONE);
            push([radial(t0, WALL_R, WALL_H - 22), radial(t1, WALL_R, WALL_H - 22), radial(t1, WALL_R, WALL_H), radial(t0, WALL_R, WALL_H)], inward(t0, t1), team);
            push([radial(t0, WALL_R, WALL_H), radial(t1, WALL_R, WALL_H), radial(t1, STANDS_IN, WALL_H), radial(t0, STANDS_IN, WALL_H)], up, TREAD);
            for (let k = 0; k < TIERS; k++) {
                const r = STANDS_IN + k * TIER_DEPTH;
                const h = WALL_H + k * TIER_RISE;
                push([radial(t0, r, h), radial(t1, r, h), radial(t1, r, h + TIER_RISE), radial(t0, r, h + TIER_RISE)], inward(t0, t1),
                    k % 5 === 4 ? team : RISER);
                push([radial(t0, r, h + TIER_RISE), radial(t1, r, h + TIER_RISE), radial(t1, r + TIER_DEPTH, h + TIER_RISE), radial(t0, r + TIER_DEPTH, h + TIER_RISE)], up,
                    aisle ? AISLE : TREAD);
            }
            // Parapet and outer wall.
            push([radial(t0, STANDS_OUT, TOP), radial(t1, STANDS_OUT, TOP), radial(t1, STANDS_OUT, TOP + 60), radial(t0, STANDS_OUT, TOP + 60)], inward(t0, t1), team);
            push([radial(t0, STANDS_OUT, TOP + 60), radial(t1, STANDS_OUT, TOP + 60), radial(t1, STANDS_OUT + 40, TOP + 60), radial(t0, STANDS_OUT + 40, TOP + 60)], up, STONE);
            push([radial(t1, STANDS_OUT + 40, 0), radial(t0, STANDS_OUT + 40, 0), radial(t0, STANDS_OUT + 40, TOP + 60), radial(t1, STANDS_OUT + 40, TOP + 60)], outward(t1, t0), STONE);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geometry;
}

/** Spectators: two instanced meshes (bodies and heads) that bounce with the crowd's excitement. */
function buildCrowd(uniforms, quality) {
    const spacing = { low: 30, medium: 22, high: 17 }[quality] ?? 17;
    const places = [];
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < TIERS; k++) {
        const r = STANDS_IN + k * TIER_DEPTH + TIER_DEPTH * 0.5;
        const y = WALL_H + (k + 1) * TIER_RISE;
        for (const [a0, a1] of ARCS) {
            const n = Math.floor((a1 - a0) * r / spacing);
            for (let i = 0; i < n; i++) {
                const t = a0 + (i + 0.5) * (a1 - a0) / n;
                const aisle = Math.abs(((t - a0) / (a1 - a0)) * AISLES % 1 - 0.5) > 0.45;
                if (aisle || rnd() < 0.12) continue;
                places.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, t, phase: rnd() });
            }
        }
    }
    const body = new THREE.CylinderGeometry(5.5, 7.5, 24, 6);
    body.translate(0, 12, 0);
    const head = new THREE.IcosahedronGeometry(6.5, 0);
    head.translate(0, 31, 0);
    const material = () => {
        const m = new THREE.MeshLambertMaterial();
        m.onBeforeCompile = shader => {
            shader.uniforms.uTime = uniforms.uTime;
            shader.uniforms.uExcite = uniforms.uExcite;
            shader.uniforms.uWave = uniforms.uWave;
            shader.uniforms.uWaveAmp = uniforms.uWaveAmp;
            shader.vertexShader = 'attribute float aPhase;\nuniform float uTime;\nuniform float uExcite;\nuniform float uWave;\nuniform float uWaveAmp;\n' +
                shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                    float speed = 3.0 + fract(aPhase * 13.7) * 3.0;
                    float hop = max(0.0, sin(uTime * speed + aPhase * 6.2831));
                    float eager = step(0.3, fract(aPhase * 3.1));
                    transformed.y += hop * hop * (1.5 + 16.0 * uExcite * eager);
                    transformed.x += sin(uTime * 1.3 + aPhase * 20.0) * 1.5;
                    // Mexican wave: spectators near the wave front jump up and stretch.
                    vec2 seat = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
                    float d = mod(atan(seat.y, seat.x) - uWave + 3.14159265, 6.2831853) - 3.14159265;
                    float wave = exp(-d * d * 30.0) * uWaveAmp;
                    transformed.y += wave * (22.0 + position.y * 0.6);`);
        };
        return m;
    };
    const bodies = new THREE.InstancedMesh(body, material(), places.length);
    const heads = new THREE.InstancedMesh(head, material(), places.length);
    const phases = new Float32Array(places.length);
    const shirts = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1, 0x2c3e50, 0xd35400, 0x16a085, 0x7f8c8d, 0xe74c3c];
    const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    places.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.t - Math.PI / 2);
        const s = 0.9 + rnd() * 0.25;
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(s, s, s));
        bodies.setMatrixAt(i, m);
        heads.setMatrixAt(i, m);
        // Fans wear their team's colours more often on their side of the arena.
        const team = Math.sin(p.t) > 0 ? 0x2e86c1 : 0xc0392b;
        bodies.setColorAt(i, c.set(rnd() < 0.35 ? team : shirts[Math.floor(rnd() * shirts.length)]));
        heads.setColorAt(i, c.set(skins[Math.floor(rnd() * skins.length)]));
        phases[i] = p.phase;
    });
    const phase = new THREE.InstancedBufferAttribute(phases, 1);
    body.setAttribute('aPhase', phase);
    head.setAttribute('aPhase', phase);
    const group = new THREE.Group();
    group.add(bodies, heads);
    group.userData.places = places;
    return group;
}

/** Camera flashes popping in the stands. */
function buildFlashes(places, count) {
    const picks = [];
    for (let i = 0; i < count && places.length; i++) picks.push(places[Math.floor(Math.random() * places.length)]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(picks.flatMap(p => [p.x, p.y + 34, p.z]), 3));
    geometry.setAttribute('flash', new THREE.Float32BufferAttribute(new Float32Array(picks.length), 1));
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float flash; varying float vFlash;
            void main() { vFlash = flash; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = flash * 9000.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vFlash;
            void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.98, 0.9), vFlash * smoothstep(0.5, 0.0, d)); }`,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
}

/**
 * The big stadium screen on the two pillars: the SOULS logo glowing on an LED wall, a ticker with both players'
 * health during a match, and a flash for big moments ("KO!", "VICTORY!"). Redrawn about ten times a second.
 */
class StadiumScreen {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 576;
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
        const g = this.grid.getContext('2d');
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
            g.shadowBlur = 40;
            g.fillStyle = Math.floor(t * 12) % 2 ? '#ffd400' : '#ffffff';
            g.fillText(this.flashText, 0, 0, W - 80);
            g.restore();
        } else {
            const pulse = 0.75 + 0.25 * Math.sin(now * 0.003);
            g.save();
            g.shadowColor = `rgba(150,255,80,${pulse})`;
            g.shadowBlur = 50;
            if (this.logo) {
                const w = 760, h = w * this.logo.height / this.logo.width;
                g.drawImage(this.logo, (W - w) / 2, this.scoreboard ? 40 : (H - h) / 2, w, h);
            } else {
                g.font = 'italic bold 200px Georgia, serif';
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillStyle = '#f4f4f4';
                g.fillText('SOULS', W / 2, H / 2);
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
                g.fillText('VS', W / 2, H - 75);
            }
        }
        g.drawImage(this.grid, 0, 0);
        this.texture.needsUpdate = true;
    }
}

/** Soft additive glow sprite (torch fire, lamps). */
function glowTexture(inner, outer) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.35, outer);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * One "Souls" tower: a gatehouse filling the gap in the stands with a glowing tunnel mouth, and a tall pillar
 * with a green ring that carries the stadium screen, facing the sand.
 */
function tunnelTower(side, screen) {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1 });
    const green = new THREE.MeshStandardMaterial({ color: 0x9ae62b, emissive: 0x6fcf0f, emissiveIntensity: 0.9, roughness: 0.4 });

    // Gatehouse: a wedge that exactly fills the gap in the stands.
    const g = GAP + deg(1), out = STANDS_OUT + 40;
    const front = WALL_R * Math.cos(g);
    const wedge = new THREE.Shape([
        new THREE.Vector2(side * front, WALL_R * Math.sin(g)),
        new THREE.Vector2(side * out * Math.cos(g), out * Math.sin(g)),
        new THREE.Vector2(side * out * Math.cos(g), -out * Math.sin(g)),
        new THREE.Vector2(side * front, -WALL_R * Math.sin(g)),
    ]);
    const house = new THREE.Mesh(new THREE.ExtrudeGeometry(wedge, { depth: TOP + 80, bevelEnabled: false }).rotateX(-Math.PI / 2), stone);
    house.castShadow = house.receiveShadow = true;
    group.add(house);

    // Tunnel mouth facing the sand: a dark arch framed by a green glowing ring.
    const arch = new THREE.Shape();
    arch.moveTo(-130, 0);
    arch.lineTo(-130, 130);
    arch.absarc(0, 130, 130, Math.PI, 0, true);
    arch.lineTo(130, 0);
    arch.lineTo(-130, 0);
    const mouth = new THREE.Mesh(new THREE.ShapeGeometry(arch, 24), dark);
    mouth.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    mouth.position.set(side * (front - 1), 0, 0);
    group.add(mouth);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(140, 10, 12, 48, Math.PI), green);
    ring.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    ring.position.set(side * (front - 4), 130, 0);
    group.add(ring);
    for (const z of [-140, 140]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(20, 130, 20), green);
        post.position.set(side * (front - 4), 65, z);
        group.add(post);
    }

    // The pillar (where the picture shows the "Souls" banner) with green rings and the screen on top.
    const pillarX = side * 880;
    const navy = new THREE.MeshStandardMaterial({ color: 0x24426e, roughness: 0.45, metalness: 0.35 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(120, 150, PILLAR_H, 40), navy);
    pillar.position.set(pillarX, PILLAR_H / 2, 0);
    pillar.castShadow = true;
    group.add(pillar);
    for (const y of [TOP + 90, PILLAR_H - 30]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(y > TOP + 100 ? 124 : 138, 13, 16, 64), green);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(pillarX, y, 0);
        group.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(150, 120, 40, 40), stone);
    cap.position.set(pillarX, PILLAR_H + 20, 0);
    group.add(cap);

    // The stadium screen, cantilevered from the wall in front of the pillar, facing the sand and turned a little
    // towards the player's end so it reads well from the low views.
    const facing = -side * (Math.PI / 2 - 0.25);
    const normal = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const screenX = side * (front - 85);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 40, SCREEN_H + 40, 26),
        new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 }));
    frame.rotation.y = facing;
    frame.position.set(screenX, SCREEN_Y, 0);
    frame.castShadow = true;
    group.add(frame);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
    display.rotation.y = facing;
    display.position.copy(frame.position).addScaledVector(normal, 14);
    group.add(display);
    for (const y of [SCREEN_Y + SCREEN_H / 2 - 40, SCREEN_Y - SCREEN_H / 2 + 40]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(110, 26, 26), stone);
        arm.position.set(side * (front - 40), y, 0);
        group.add(arm);
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 40, 10, 14), green);
    lip.rotation.y = facing;
    lip.position.copy(frame.position).addScaledVector(normal, 10).setY(SCREEN_Y - SCREEN_H / 2 - 26);
    group.add(lip);

    // Round platform in front of the tunnel.
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(150, 156, 16, 48), new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.6, metalness: 0.3 }));
    platform.position.set(side * (SAND - 30), 8, 0);
    platform.receiveShadow = true;
    group.add(platform);
    for (const r of [80, 125]) {
        const inlay = new THREE.Mesh(new THREE.TorusGeometry(r, 4, 6, 48), new THREE.MeshStandardMaterial({ color: 0xd98c2b, emissive: 0x8a4d10, emissiveIntensity: 0.6 }));
        inlay.rotation.x = Math.PI / 2;
        inlay.position.set(side * (SAND - 30), 17, 0);
        group.add(inlay);
    }
    return group;
}

/** Round gate towers in the corners, with crenellations and a torch. */
function gateTower(x, z, fireTexture, lights) {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.9 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(150, 168, 150, 32), stone);
    tower.position.set(x, 75, z);
    tower.castShadow = tower.receiveShadow = true;
    group.add(tower);
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(34, 34, 22), stone);
        merlon.position.set(x + Math.cos(a) * 140, 167, z + Math.sin(a) * 140);
        merlon.rotation.y = -a;
        group.add(merlon);
    }
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(34, 18, 30, 12), new THREE.MeshStandardMaterial({ color: 0x2b2420, metalness: 0.6, roughness: 0.4 }));
    bowl.position.set(x, 165, z);
    group.add(bowl);
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fire.position.set(x, 215, z);
    fire.scale.set(120, 150, 1);
    fire.userData.flicker = Math.random() * 10;
    group.add(fire);
    if (lights) {
        const light = new THREE.PointLight(0xff9a3c, 60000, 1100, 2);
        light.position.set(x, 230, z);
        light.userData.flicker = fire.userData.flicker;
        group.add(light);
    }
    group.userData.fire = fire;
    return group;
}

function floodlight(angle, lampTexture) {
    const group = new THREE.Group();
    const r = STANDS_OUT + 180;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.5, metalness: 0.8 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(16, 30, 1250, 8), steel);
    mast.position.set(x, 625, z);
    group.add(mast);
    const head = new THREE.Group();
    head.position.set(x, 1270, z);
    head.lookAt(0, 0, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(300, 170, 24), steel);
    head.add(frame);
    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
            const lamp = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), lampMaterial);
            lamp.position.set(-105 + i * 70, -38 + j * 76, 13);
            head.add(lamp);
        }
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    glow.scale.set(900, 700, 1);
    glow.position.z = 40;
    head.add(glow);
    group.add(head);

    // A faint light shaft towards the sand.
    const length = Math.hypot(r, 1270) * 0.85;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(520, length, 32, 1, true), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying float vY; void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4(vec3(1.0, 0.95, 0.8), 0.07 * pow(vY, 2.0)); }',
    }));
    const dir = new THREE.Vector3(-x, -1270, -z).normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    cone.position.set(x, 1270, z).addScaledVector(dir, length / 2);
    group.add(cone);
    return group;
}

function flags(uniforms) {
    const group = new THREE.Group();
    const colors = [0xc0392b, 0x2e86c1, 0xf1c40f];
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.7, roughness: 0.3 });
    const flagGeometry = new THREE.PlaneGeometry(110, 66, 10, 4);
    flagGeometry.translate(55, 0, 0);
    for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + 0.05;
        if (Math.abs(Math.cos(a)) > Math.cos(GAP * 1.6)) continue; // not over the tunnel towers
        const r = STANDS_OUT + 20;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 220, 6), poleMaterial);
        pole.position.set(Math.cos(a) * r, TOP + 170, Math.sin(a) * r);
        group.add(pole);
        const material = new THREE.MeshLambertMaterial({ color: colors[i % 3], side: THREE.DoubleSide });
        material.onBeforeCompile = shader => {
            shader.uniforms.uTime = uniforms.uTime;
            shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                float w = position.x / 110.0;
                transformed.z += sin(position.x * 0.06 - uTime * 5.0 + ${(i * 1.7).toFixed(1)}) * 12.0 * w;
                transformed.y += sin(position.x * 0.04 - uTime * 3.0) * 4.0 * w;`);
        };
        const flag = new THREE.Mesh(flagGeometry, material);
        flag.position.set(Math.cos(a) * r, TOP + 245, Math.sin(a) * r);
        flag.rotation.y = -a + Math.PI / 2;
        group.add(flag);
    }
    return group;
}

function skyDome(lowPower) {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
            top: { value: new THREE.Color(0x0b1026) },
            mid: { value: new THREE.Color(0x3b2a5c) },
            horizon: { value: new THREE.Color(0xf08a4b) },
        },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vDir;
            void main() {
                float h = max(vDir.y, 0.0);
                vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, h));
                c = mix(c, top, smoothstep(0.25, 0.8, h));
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }`,
    }));
    group.add(dome);
    const stars = [];
    for (let i = 0; i < (lowPower ? 400 : 1500); i++) {
        const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.2;
        stars.push(Math.cos(a) * Math.cos(e) * 28000, Math.sin(e) * 28000, Math.sin(a) * Math.cos(e) * 28000);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    group.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));
    return group;
}

// ---- The arena ----------------------------------------------------------------------------------------------------

export class Arena {
    constructor(scene, quality) {
        this.scene = scene;
        this.quality = quality;
        this.lowPower = quality !== 'high';
        this.rise = 0; // 0 = classic picture, 1 = stadium
        this.target = 0;
        this.excite = 0.1;
        this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 }, uWave: { value: 0 }, uWaveAmp: { value: 0 } };
        this.waveUntil = 0;
        this.nextWave = 20000;
    }

    async build() {
        const scene = this.scene;
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

        // The sand: the same picture, lit, inside the arena wall.
        const sand = new THREE.Mesh(pictureUvs(new THREE.CircleGeometry(WALL_R + 2, 96).rotateX(-Math.PI / 2)),
            new THREE.MeshStandardMaterial({ map: picture, roughness: 1 }));
        sand.receiveShadow = true;
        scene.add(sand);

        // Stadium (hidden in the classic view, rises when leaving it).
        this.stadium = new THREE.Group();
        this.stadium.name = 'stadium';
        this.parts = [];
        const part = (object, delay) => { this.parts.push({ object, delay }); this.stadium.add(object); return object; };

        const outside = new THREE.Mesh(new THREE.CircleGeometry(25000, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f1a17, roughness: 1 }));
        outside.position.y = -3;
        this.stadium.add(outside);

        const stands = new THREE.Group();
        const terraces = new THREE.Mesh(terraceGeometry(this.lowPower ? 60 : 120), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
        terraces.receiveShadow = true;
        stands.add(terraces);
        const crowd = buildCrowd(this.uniforms, this.quality);
        stands.add(crowd);
        this.flashes = buildFlashes(crowd.userData.places, this.quality === 'high' ? 220 : 80);
        stands.add(this.flashes);
        part(stands, 0);

        this.screen = new StadiumScreen();
        part(tunnelTower(-1, this.screen), 0.15);
        part(tunnelTower(1, this.screen), 0.15);

        const fire = glowTexture('rgba(255,250,220,1)', 'rgba(255,140,30,0.8)');
        this.towers = [];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const tower = gateTower(sx * 348, sz * 612, fire, this.quality === 'high');
                this.towers.push(tower);
                part(tower, 0.25);
            }
        }

        const lamp = glowTexture('rgba(255,255,245,1)', 'rgba(255,240,200,0.35)');
        for (let i = 0; i < 4; i++) part(floodlight(deg(45 + i * 90), lamp), 0.35);
        part(flags(this.uniforms), 0.45);

        this.sky = skyDome(this.lowPower);
        this.stadium.add(this.sky);
        this.stadium.visible = false;
        scene.add(this.stadium);

        // Lights for the 3D pieces, tuned so a card lying face up shows its artwork's colours.
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6b5a40, 0.5));
        const sun = new THREE.DirectionalLight(0xfff3e0, 1.9);
        sun.position.set(-700, 2200, -500);
        sun.target.position.set(0, 0, 0);
        sun.castShadow = true;
        sun.shadow.mapSize.set(this.lowPower ? 1024 : 2048, this.lowPower ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -1300, right: 1300, top: 1000, bottom: -1000, near: 500, far: 5000 });
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 1;
        scene.add(sun, sun.target);
        scene.background = new THREE.Color(0x0b0806);
        scene.fog = new THREE.Fog(0x2a2036, 9000, 26000);
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

    /** World positions of the torch fires on the gate towers (for embers and flame jets). */
    get torches() {
        return (this.towers || []).map(t => t.userData.fire.position.clone().setY(200));
    }

    /** The crowd gets louder and jumps (0..1). */
    cheer(amount) {
        this.excite = Math.min(1, this.excite + amount);
    }

    apply() {
        const r = this.rise;
        this.stadium.visible = r > 0.001;
        for (const { object, delay } of this.parts) {
            const t = THREE.MathUtils.clamp((r - delay) / (1 - delay), 0, 1);
            const e = t === 1 ? 1 : 1 - Math.pow(1 - t, 3);
            object.scale.y = Math.max(0.001, e);
        }
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
        this.excite = 0.1 + (this.excite - 0.1) * Math.exp(-dt / 1800);
        this.uniforms.uTime.value = now / 1000;
        this.uniforms.uExcite.value = this.excite;
        // The wave goes once around the stadium; one starts by itself every now and then.
        if (this.stadium.visible && now > this.nextWave) {
            this.nextWave = now + 25000 + Math.random() * 20000;
            this.wave();
        }
        const waveT = (now - (this.waveStart ?? -1e9)) / 5200;
        this.uniforms.uWaveAmp.value = waveT >= 0 && waveT <= 1 ? Math.min(1, Math.sin(Math.PI * waveT) * 2.2) : 0;
        if (waveT >= 0 && waveT <= 1) this.uniforms.uWave.value = this.waveFrom + waveT * Math.PI * 2;
        if (!this.stadium.visible) return;
        this.screen.update(now);
        for (const tower of this.towers) {
            const f = tower.userData.fire;
            const k = 0.85 + 0.15 * Math.sin(now * 0.02 + f.userData.flicker) * Math.sin(now * 0.013 + f.userData.flicker * 2);
            f.scale.set(120 * k, 150 * (0.9 + 0.2 * k), 1);
            for (const child of tower.children) if (child.isPointLight) child.intensity = 60000 * k;
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
