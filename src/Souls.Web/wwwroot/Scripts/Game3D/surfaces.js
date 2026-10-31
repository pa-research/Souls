// Procedural surfaces for the stadium (TSL node materials, no textures): stone with coursed blocks and mortar, bronze
// and iron, banner cloth, roof tiles, glowing openings, the sand, the flames and the night sky.
//
// Each material reads the per-vertex data written by stadium.js (uv in blocks, tint, aux = occlusion, baked fire
// light, rise delay, variant). Detail fades out with the pixel footprint (fwidth), so far stands do not shimmer.
import * as THREE from '/lib/three/three.webgpu.js';
import {
    Fn, attribute, cross, dFdx, dFdy, dot, exp, float, floor, fract, fwidth, hash, instancedBufferAttribute, max, min,
    mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, normalGeometry, normalView, positionLocal, positionView,
    positionWorld, reflectVector, select, sin, smoothstep, uniform, uv, varying, vec2, vec3, vec4,
} from '/lib/three/three.tsl.js';
import { GLOW_MAX } from './stadium.js';

/** Uniforms shared by the stadium's materials. */
export function stadiumUniforms() {
    return {
        uTime: uniform(0),
        uRise: uniform(0), // 0 = sunk into the ground (classic view), 1 = standing
        uFlicker: uniform(1), // warm fire light, flickering a little
        uExcite: uniform(0.1),
        uWave: uniform(0),
        uWaveAmp: uniform(0),
    };
}

const srgb = c => c.pow(vec3(2.2));
/** 1 below a, 0 above b (a < b): smoothstep with reversed edges is undefined in GLSL. */
const fall = (a, b, x) => smoothstep(a, b, x).oneMinus();
const WARM = vec3(1.0, 0.56, 0.24);

/** The rise out of the ground: vertices scale up from y = 0 after their delay (aux.z), easing out. */
export function rise(u, delay, position = positionLocal) {
    const d = float(delay);
    const t = u.uRise.sub(d).div(d.oneMinus().max(0.01)).clamp(0, 1);
    const e = t.oneMinus().pow(3).oneMinus().max(0.001);
    return position.mul(vec3(1, e, 1));
}

/**
 * Normal from a procedural height field (world units), from its screen-space derivatives, in view space. It must be
 * evaluated in uniform control flow (no If around it).
 */
const bumpNormal = Fn(([height]) => {
    const dpdx = dFdx(positionView), dpdy = dFdy(positionView);
    const dhdx = dFdx(height), dhdy = dFdy(height);
    const n = normalView;
    const r1 = cross(dpdy, n), r2 = cross(n, dpdx);
    const det = dot(dpdx, r1);
    const grad = det.sign().mul(r1.mul(dhdx).add(r2.mul(dhdy)));
    return det.abs().mul(n).sub(grad).normalize();
});

/** Specular anti-aliasing: rougher where the normal changes fast across a pixel. */
const filteredRoughness = (roughness, n) => {
    const v = max(dot(dFdx(n), dFdx(n)), dot(dFdy(n), dFdy(n)));
    return roughness.mul(roughness).add(v.mul(0.5)).sqrt().clamp(0, 1);
};

function common(m, u, lightsNode) {
    const aux = attribute('aux', 'vec4');
    m.lightsNode = lightsNode;
    m.positionNode = rise(u, aux.z);
    m.aoNode = aux.x;
    return aux;
}

/**
 * Coursed stone: blocks of irregular length in each course (no wallpaper grid), recessed mortar, hand-cut faces that
 * vary in tone, chipped arrises, rain streaks below the ledges, grime and damp near the ground.
 */
function stoneMaterial(u, lightsNode, detailed, full) {
    const m = new THREE.MeshStandardNodeMaterial();
    const aux = common(m, u, lightsNode);
    const tint = srgb(attribute('tint', 'vec4').rgb);
    const kind = aux.w.mul(255).round();
    const p = uv();
    const row = floor(p.y);
    // Each course has its own block length (0.75..1.35) and its own offset.
    const rowLen = hash(row.mul(12.9).add(kind.mul(3.3))).mul(0.6).add(0.75);
    const ux = p.x.div(rowLen).add(hash(row.mul(78.2)).mul(7.0));
    const cell = floor(ux);
    const f = vec2(fract(ux), fract(p.y));
    const rnd = hash(cell.mul(7.31).add(row.mul(131.7)).add(kind.mul(17.0)));
    const rnd2 = hash(cell.mul(3.17).add(row.mul(57.3)).add(5.0));
    const fw = fwidth(p).length().max(0.0001);
    const detail = smoothstep(0.06, 0.4, fw).oneMinus(); // block detail fades out when blocks are a few pixels
    const chip = full ? mx_noise_float(vec3(p.mul(vec2(9.0, 18.0)), 2.0)).mul(0.012) : float(0);
    const wood = kind.equal(4); // planks: seams between them only, grain along them
    const edge = min(min(f.x, f.x.oneMinus()).mul(rowLen).div(float(0.028).add(chip)), select(wood, float(99), min(f.y, f.y.oneMinus()).div(float(0.06).add(chip.mul(2)))));
    const aa = fw.mul(18).add(0.2);
    const block = smoothstep(float(1).sub(aa), float(1).add(aa), edge);
    const arris = smoothstep(1.0, 2.6, edge).oneMinus().mul(block); // the worn edge of each block
    const joints = select(kind.equal(1), 0.3, select(kind.equal(3), 0.7, 1.0)).mul(detail);
    const mortar = block.oneMinus().mul(joints);
    const grain = detailed ? mx_noise_float(select(wood, vec3(p.x.mul(14.0), p.y.mul(0.8), rnd.mul(9.0)), vec3(p.mul(vec2(2.6, 5.2)), rnd.mul(9.0)))) : float(0);
    const stains = detailed ? mx_fractal_noise_float(positionWorld.mul(0.0045), full ? 3 : 2, 2.0, 0.5) : float(0);
    const streaks = full ? mx_noise_float(vec3(positionWorld.x.mul(0.09), positionWorld.y.mul(0.006), positionWorld.z.mul(0.09))) : float(0);
    const value = float(1).add(rnd.sub(0.5).mul(select(kind.equal(1), 0.1, 0.3))).add(grain.mul(select(wood, 0.25, 0.0)))
        .add(f.x.sub(0.5).mul(rnd2.sub(0.5)).mul(0.16).mul(detail))
        .add(grain.mul(0.08).mul(detail)).add(stains.mul(0.16)).add(arris.mul(joints).mul(0.07))
        .sub(smoothstep(0.1, 0.6, streaks).mul(0.12));
    const hue = rnd2.sub(0.5).mul(0.1);
    let col = tint.mul(value).mul(vec3(float(1).add(hue), 1, float(1).sub(hue)));
    col = mix(col, tint.mul(vec3(0.72, 0.7, 0.66)), mortar);
    // Grime and damp: darker and a little green towards the ground, darker in the occluded corners.
    const ground = smoothstep(0, 80, positionWorld.y);
    col = mix(col.mul(vec3(0.62, 0.66, 0.6)), col, ground.mul(0.7).add(0.3)).mul(mix(float(0.55), float(1), aux.x));
    m.colorNode = col;
    const height = block.mul(joints).mul(1.6).sub(arris.mul(joints).mul(0.5)).add(grain.mul(0.35).mul(detail)).add(stains.mul(0.6));
    const n = detailed ? bumpNormal(height) : normalView;
    m.normalNode = n;
    m.roughnessNode = filteredRoughness(mix(float(0.86), float(0.95), mortar).sub(select(kind.equal(1), 0.12, 0.0)), n);
    m.metalnessNode = float(0);
    m.emissiveNode = col.mul(WARM).mul(aux.y.mul(GLOW_MAX)).mul(u.uFlicker);
    return m;
}

/** Bronze and iron: polished where it stands out, green verdigris where it is sheltered; a cheap sky reflection. */
function metalMaterial(u, lightsNode) {
    const m = new THREE.MeshStandardNodeMaterial();
    const aux = common(m, u, lightsNode);
    const tint = srgb(attribute('tint', 'vec4').rgb);
    const n = mx_noise_float(positionWorld.mul(0.06));
    const bronze = smoothstep(0.05, 0.2, tint.r.sub(tint.b));
    const patina = smoothstep(0.55, 0.95, n.mul(0.5).add(0.5).add(aux.x.oneMinus().mul(0.5))).mul(bronze);
    const col = mix(tint, vec3(0.16, 0.33, 0.27), patina.mul(0.7));
    m.colorNode = col;
    m.metalnessNode = mix(float(0.8), float(0.15), patina);
    m.roughnessNode = n.mul(0.08).add(0.36).add(patina.mul(0.4));
    const sky = mix(vec3(0.05, 0.04, 0.03), vec3(0.18, 0.22, 0.34), reflectVector.y.mul(0.5).add(0.5));
    m.emissiveNode = col.mul(sky.mul(0.8).add(WARM.mul(aux.y.mul(GLOW_MAX * 0.45)).mul(u.uFlicker)));
    return m;
}

/** Banner cloth: team colour, a woven texture, a gold border and an emblem; flutters in the wind. */
function clothMaterial(u, lightsNode) {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const aux = attribute('aux', 'vec4');
    m.lightsNode = lightsNode;
    const wave = attribute('wave', 'vec2');
    const t = u.uTime;
    const flutter = sin(t.mul(2.3).add(wave.y).add(positionLocal.y.mul(0.04)).add(positionLocal.x.mul(0.02)))
        .add(sin(t.mul(3.7).add(wave.y.mul(1.7)).add(positionLocal.z.mul(0.03))).mul(0.5));
    const moved = positionLocal.add(normalGeometry.mul(flutter.mul(wave.x).mul(9))).add(vec3(0, sin(t.mul(1.9).add(wave.y)).mul(wave.x).mul(3), 0));
    m.positionNode = rise(u, aux.z, moved);
    const tint = srgb(attribute('tint', 'vec4').rgb);
    const q = uv();
    const gold = vec3(0.62, 0.42, 0.13);
    const border = smoothstep(0.37, 0.4, q.x.sub(0.5).abs()).max(smoothstep(0.93, 0.96, q.y.oneMinus()));
    const d = vec2(q.x.sub(0.5), q.y.sub(0.42).mul(0.8)).length();
    const ring = fall(0.015, 0.03, d.sub(0.17).abs());
    const diamond = fall(0.085, 0.1, q.x.sub(0.5).abs().add(q.y.sub(0.42).abs().mul(0.75)));
    const weave = sin(q.x.mul(380)).mul(sin(q.y.mul(420))).mul(0.04).add(1);
    const emblem = ring.max(diamond).max(border);
    const col = mix(tint.mul(weave), gold, emblem).mul(mix(float(0.75), float(1), aux.x));
    m.colorNode = col;
    m.roughnessNode = mix(float(0.88), float(0.45), emblem);
    m.metalnessNode = emblem.mul(0.6);
    m.emissiveNode = col.mul(WARM).mul(aux.y.mul(GLOW_MAX)).mul(u.uFlicker);
    return m;
}

/** Roof tiles: rounded terracotta (variant 0) or flat slate (variant 1) in overlapping rows. */
function roofMaterial(u, lightsNode, detailed) {
    const m = new THREE.MeshStandardNodeMaterial();
    const aux = common(m, u, lightsNode);
    const tint = srgb(attribute('tint', 'vec4').rgb);
    const p = uv();
    const row = floor(p.y);
    const ux = p.x.add(row.mul(0.5));
    const f = vec2(fract(ux), fract(p.y));
    const rnd = hash(floor(ux).mul(9.1).add(row.mul(71.3)));
    const fw = fwidth(p).length();
    const detail = smoothstep(0.08, 0.5, fw).oneMinus();
    const slate = aux.w.mul(255).round().equal(1);
    const round = select(slate, smoothstep(0.0, 0.08, f.x).mul(fall(0.92, 1.0, f.x)), sin(f.x.mul(Math.PI)));
    const lap = smoothstep(0.0, 0.3, f.y);
    const height = round.mul(1.2).add(lap.mul(1.5)).mul(detail);
    const col = tint.mul(round.mul(0.25).add(0.75).mul(detail).add(detail.oneMinus().mul(0.9)))
        .mul(lap.mul(0.35).add(0.65).mul(detail).add(detail.oneMinus().mul(0.85)))
        .mul(rnd.sub(0.5).mul(0.3).mul(detail).add(1)).mul(mix(float(0.5), float(1), aux.x));
    m.colorNode = col;
    const n = detailed ? bumpNormal(height) : normalView;
    m.normalNode = n;
    m.roughnessNode = filteredRoughness(float(0.7), n);
    m.emissiveNode = col.mul(WARM).mul(aux.y.mul(GLOW_MAX)).mul(u.uFlicker);
    return m;
}

/** Unlit glow: lit corridors and doorways (variant = brightness), soul-green runes, dark slits. */
function glowMaterial(u) {
    const m = new THREE.MeshBasicNodeMaterial();
    const aux = attribute('aux', 'vec4');
    m.positionNode = rise(u, aux.z);
    const tint = srgb(attribute('tint', 'vec4').rgb);
    const k = aux.w.mul(2.55);
    const green = tint.g.sub(tint.r).greaterThan(0.3);
    const pulse = select(green, sin(u.uTime.mul(1.4)).mul(0.15).add(1), u.uFlicker);
    const gradient = select(green, float(1), mix(float(1.15), float(0.55), uv().y.clamp(0, 1)));
    m.colorNode = tint.mul(k).mul(pulse).mul(gradient);
    return m;
}

/** The stadium's materials by slot. Low quality: flat stone and roofs; medium: fewer noise layers than high. */
export function stadiumMaterials(u, lightsNode, quality) {
    const detailed = quality !== 'low';
    const materials = {
        stone: stoneMaterial(u, lightsNode, detailed, quality === 'high'),
        metal: metalMaterial(u, lightsNode),
        cloth: clothMaterial(u, lightsNode),
        roof: roofMaterial(u, lightsNode, detailed),
        glow: glowMaterial(u),
    };
    debugView(materials);
    return materials;
}

/**
 * `?stadiumDebug=ao|light|rise|variant|blocks` shows one of the baked per-vertex fields (or the block grid) instead of
 * the surfaces, to check the plan's occlusion, fire light, rise order, surface variants and texture scale.
 */
function debugView(materials) {
    const mode = new URLSearchParams(window.location.search).get('stadiumDebug');
    if (!mode) return;
    const aux = attribute('aux', 'vec4');
    const field = {
        ao: vec3(aux.x),
        light: vec3(aux.y, aux.y.mul(0.6), aux.y.mul(0.3)),
        rise: vec3(aux.z.mul(2.5), aux.z.mul(0.5), aux.z.oneMinus()),
        variant: vec3(fract(aux.w.mul(255 * 0.37)), fract(aux.w.mul(255 * 0.61)), fract(aux.w.mul(255 * 0.89))),
        blocks: vec3(fract(uv().x), fract(uv().y), 0.2),
    }[mode];
    if (!field) return;
    for (const m of Object.values(materials)) {
        if (m.isMeshStandardNodeMaterial) {
            m.colorNode = vec3(0);
            m.normalNode = null;
            m.emissiveNode = field;
        } else {
            m.colorNode = field;
        }
    }
}

// ---- Sand ------------------------------------------------------------------------------------------------------------

/** Contact shadows on the sand: up to this many soft ellipses (x, z, radius x, radius z) under cards and heroes. */
export const CONTACTS = 16;

/**
 * The arena floor, lit like the board: raked sand with grain, darker trodden paths and footprints between the tunnels
 * and around the podiums, damp shade along the wall, and soft contact shadows under the cards and heroes.
 */
export function sandMaterial(u, contacts, quality) {
    const m = new THREE.MeshStandardNodeMaterial();
    const detailed = quality !== 'low';
    const p = positionWorld.xz;
    const r = p.length();
    const big = mx_fractal_noise_float(vec3(p.mul(0.0022), 0.5), 3, 2.0, 0.5);
    const grainN = detailed ? mx_noise_float(vec3(p.mul(0.35), 1.7)) : float(0);
    // Raked rings around the centre, broken up where people walked.
    const fw = fwidth(r).max(0.001);
    const rakeFade = smoothstep(0.6, 2.2, fw).oneMinus();
    const rakeBreak = smoothstep(-0.15, 0.35, mx_noise_float(vec3(p.mul(0.006), 3.1)));
    const rake = sin(r.mul(0.42).add(big.mul(3.0))).mul(rakeFade).mul(rakeBreak);
    // Trodden paths: tunnel to tunnel along x, and rings around the podiums (z = ±585).
    const path = fall(20, 90, p.y.abs()).mul(smoothstep(160, 420, p.x.abs()));
    const podium = fall(160, 260, vec2(p.x, p.y.abs().sub(585)).length());
    const trodden = path.max(podium).max(smoothstep(560, 690, r).mul(0.6));
    const cells = mx_worley_noise_float(vec2(p.x.mul(0.07), p.y.mul(0.045)));
    const prints = detailed ? fall(0.18, 0.32, cells).mul(trodden).mul(smoothstep(-0.2, 0.4, mx_noise_float(vec3(p.mul(0.02), 7.0)))) : float(0);
    // Damp shade along the foot of the wall.
    const wall = smoothstep(560, 712, r);
    // Contact shadows.
    const contact = Fn(() => {
        const shade = float(1).toVar();
        for (let i = 0; i < CONTACTS; i++) {
            const c = contacts.element(i);
            const d = vec2(p.x.sub(c.x).div(c.z.max(1)), p.y.sub(c.y).div(c.w.max(1)));
            shade.mulAssign(float(1).sub(exp(dot(d, d).mul(-2.2)).mul(0.6)));
        }
        return shade;
    })();
    let col = vec3(0.7, 0.46, 0.17).mul(float(1).add(big.mul(0.12)).add(grainN.mul(0.05)));
    col = mix(col, vec3(0.5, 0.31, 0.15), trodden.mul(0.35).add(prints.mul(0.3)));
    col = col.mul(rake.mul(0.04).add(1)).mul(mix(float(1), float(0.62), wall)).mul(contact);
    m.colorNode = col;
    const height = rake.mul(0.6).sub(prints.mul(1.2)).add(grainN.mul(0.25)).add(big.mul(4));
    const n = detailed ? bumpNormal(height) : normalView;
    m.normalNode = n;
    m.roughnessNode = float(0.96);
    m.metalnessNode = float(0);
    return m;
}

// ---- Fire --------------------------------------------------------------------------------------------------------------

/**
 * All the stadium's flames as one instanced sprite: a noise-driven tongue of fire (hue 0), green soul fire (1) or the
 * blazing crystal of a beacon (2). `fires`: [{ p: [x, y, z], size, hue, phase }].
 */
export function fireSprites(fires, u) {
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(fires.flatMap(f => f.p)), 3);
    const info = new THREE.InstancedBufferAttribute(new Float32Array(fires.flatMap(f => [f.size, f.hue, f.phase, 0])), 4);
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const at = instancedBufferAttribute(pos);
    const data = instancedBufferAttribute(info);
    const size = data.x, hue = data.y, phase = data.z;
    const grow = u.uRise.sub(0.25).div(0.75).clamp(0, 1);
    m.positionNode = vec3(at.x, at.y.mul(grow), at.z);
    m.scaleNode = vec2(size.mul(select(hue.equal(2), 1.0, 0.62)), size).mul(grow.max(0.001));
    const q = varying(uv());
    const t = u.uTime;
    const flame = Fn(() => {
        const n1 = mx_noise_float(vec3(q.x.mul(3.2), q.y.mul(2.6).sub(t.mul(2.4)).add(phase), phase));
        const n2 = mx_noise_float(vec3(q.x.mul(7.0), q.y.mul(6.0).sub(t.mul(4.1)), phase.add(3.0)));
        const y = q.y;
        const x = q.x.sub(0.5).add(n1.mul(0.13).add(n2.mul(0.05)).mul(y.add(0.15)));
        const width = mix(float(0.3), float(0.02), y.pow(0.85));
        const body = fall(width.mul(0.25), width, x.abs()).mul(fall(0.5, 0.98, y.add(n1.mul(0.12)))).mul(smoothstep(0.0, 0.1, y));
        const core = body.mul(body).mul(fall(0.2, 0.8, y));
        const halo = exp(vec2(q.x.sub(0.5), y.sub(0.2).mul(0.8)).length().mul(-6.0)).mul(0.22);
        const warm = mix(vec3(1.0, 0.2, 0.03), vec3(1.0, 0.72, 0.36), core).mul(body.mul(1.6)).add(vec3(1.0, 0.45, 0.12).mul(halo));
        const soul = mix(vec3(0.15, 0.85, 0.12), vec3(0.75, 1.0, 0.6), core).mul(body.mul(2.4)).add(vec3(0.3, 1.0, 0.2).mul(halo));
        const d = vec2(q.x.sub(0.5), q.y.sub(0.5)).length();
        const rays = fall(0.0, 0.012, q.x.sub(0.5).abs()).add(fall(0.0, 0.012, q.y.sub(0.5).abs())).mul(fall(0.0, 0.5, d));
        const crystal = vec3(1.0, 0.93, 0.78).mul(exp(d.mul(-14.0)).mul(3.0).add(exp(d.mul(-5.0)).mul(0.35)).add(rays.mul(0.5)));
        return select(hue.lessThan(0.5), warm, select(hue.lessThan(1.5), soul, crystal));
    })();
    m.colorNode = vec4(flame, 1);
    const sprite = new THREE.Sprite(m);
    sprite.count = fires.length;
    sprite.center.set(0.5, 0.18);
    sprite.frustumCulled = false;
    return sprite;
}

// ---- Sky ---------------------------------------------------------------------------------------------------------------

/** Direction of the moon (and of the light it casts on the stadium): low behind the player's end, to the left. */
export const MOON = new THREE.Vector3(-0.42, 0.42, 0.8).normalize();

/**
 * Night sky: deep blue at the zenith, the last glow of sunset low over the opponent's end, a moon with a halo behind
 * the player, slow clouds lit by the moon.
 */
export function skyMaterial(u, quality) {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const dir = varying(positionLocal.normalize());
    const h = dir.y.max(0);
    const moon = vec3(MOON.x, MOON.y, MOON.z);
    const md = dot(dir, moon);
    const west = smoothstep(-0.3, 1.0, dir.z.negate()).pow(1.5);
    const zenith = vec3(0.006, 0.01, 0.035), mid = vec3(0.02, 0.028, 0.08), horizon = vec3(0.07, 0.06, 0.12);
    let sky = mix(mix(horizon, mid, smoothstep(0.0, 0.22, h)), zenith, smoothstep(0.22, 0.85, h));
    const glow = exp(h.mul(-10.0)).mul(west);
    sky = sky.add(vec3(0.75, 0.24, 0.07).mul(glow.mul(0.4))).add(vec3(0.4, 0.1, 0.18).mul(exp(h.mul(-4.0)).mul(west).mul(0.06)));
    sky = sky.add(vec3(0.35, 0.42, 0.6).mul(md.max(0).pow(24).mul(0.12)).add(vec3(0.7, 0.75, 0.9).mul(md.max(0).pow(400).mul(0.35))));
    if (quality !== 'low') {
        const plane = dir.xz.div(h.add(0.12)).mul(0.9);
        const c = mx_fractal_noise_float(vec3(plane.x.add(u.uTime.mul(0.004)), plane.y, 1.3), 4, 2.0, 0.5);
        const cover = smoothstep(0.05, 0.55, c).mul(smoothstep(0.0, 0.08, h)).mul(fall(0.3, 0.9, h));
        const lit = vec3(0.05, 0.06, 0.1).add(vec3(0.5, 0.52, 0.6).mul(md.max(0).pow(6).mul(0.6))).add(vec3(0.5, 0.2, 0.08).mul(glow.mul(0.6)));
        sky = mix(sky, lit, cover.mul(0.85));
    }
    // The moon's disc, with darker seas.
    const disc = smoothstep(0.99935, 0.99952, md);
    const seas = mx_noise_float(dir.mul(260.0)).mul(0.5).add(0.5);
    sky = mix(sky, vec3(1.6, 1.55, 1.4).mul(seas.mul(0.25).add(0.75)), disc);
    m.colorNode = sky;
    return m;
}

/** The trodden earth around the stadium, lit by the stadium's light. */
export function groundMaterial(lightsNode) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    m.lightsNode = lightsNode;
    const n = mx_fractal_noise_float(vec3(positionWorld.xz.mul(0.0011), 0.3), 4, 2.0, 0.5);
    m.colorNode = mix(vec3(0.016, 0.013, 0.01), vec3(0.045, 0.036, 0.024), n.mul(0.5).add(0.5));
    return m;
}

/** Distant hills around the horizon: a dark jagged ring that the fog fades into the sky. */
export function hillsGeometry() {
    const segs = 160, pos = [], idx = [];
    const R = 16000;
    let s = 5;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const off = Array.from({ length: 6 }, () => rnd() * 10);
    for (let i = 0; i <= segs; i++) {
        const a = i / segs * Math.PI * 2;
        let hgt = 0;
        for (let k = 0; k < 6; k++) hgt += Math.sin(a * (k + 1) * 3 + off[k]) / (k + 1);
        hgt = 500 + hgt * 380 + Math.sin(a * 41) * 40;
        pos.push(Math.cos(a) * R, -50, Math.sin(a) * R, Math.cos(a) * R, Math.max(80, hgt), Math.sin(a) * R);
        if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
}

