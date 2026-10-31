// The stadium's architecture: a plan (rings of terraces, towers, gates, spires, galleries) compiled into one indexed
// geometry per material slot, so the whole building is a handful of draw calls.
//
// Every vertex carries what the materials (surfaces.js) need to draw real surface detail without textures:
//   uv    physical texture space: one unit is one stone block (or plank, tile) of that surface
//   tint  sRGB albedo tint (alpha unused)
//   aux   x ambient occlusion authored per profile point, y warm light baked from the fires around it (0..1 of
//         GLOW_MAX), z the delay of its rise out of the ground (0..1 of the transition), w the surface variant
//   wave  (cloth only) how free this point is to flutter, and its phase
//
// Units are the classic stage's pixels (a spectator is about 45 tall, so one unit is roughly 3.5 cm).
import * as THREE from '/lib/three/three.webgpu.js';

const deg = THREE.MathUtils.degToRad;

export const SAND = 705; // radius of the sand circle in the classic picture
export const WALL_R = SAND + 12;
export const WALL_H = 74;
export const TIERS = 16;
export const TIER_DEPTH = 58;
export const TIER_RISE = 30;
export const STANDS_IN = WALL_R + 30;
export const STANDS_OUT = STANDS_IN + TIERS * TIER_DEPTH;
export const TOP = WALL_H + TIERS * TIER_RISE;
export const GAP = deg(13); // the stands open at +x and -x for the gatehouses
export const ARCS = [[GAP, Math.PI - GAP], [Math.PI + GAP, 2 * Math.PI - GAP]];
export const AISLES = 14; // radial stairways per side
export const AISLE_W = 0.03; // their width (radians)
export const WALKWAYS = [5, 10]; // treads without seats: walkways between the three rings of seats
export const OUTER_R = STANDS_OUT + 70; // outer façade
export const GALLERY_R = STANDS_OUT + 18; // columns of the gallery at the top of the stands
export const GALLERY_Y = TOP + 34;
export const ATTIC_TOP = GALLERY_Y + 170;
export const PILLAR_H = 1250;
export const GLOW_MAX = 3;
/** Gate towers: on the arena wall at the four corners of the board. */
export const GATE_TOWERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * 348, 0, sz * 612));
/** The stadium screens: above each tunnel mouth, facing the sand, turned a little towards the player's end. */
export const SCREEN_W = 300;
export const SCREEN_H = 169;
export const SCREEN_Y = 380;

/** Albedo tints (sRGB). Dark and muted: the board in the middle stays the brightest thing in view. */
export const TINT = {
    stone: 0x7b7469, trim: 0x968d7d, dark: 0x4f4a43, riser: 0x6c665c, tread: 0x857e70, aisle: 0x928a7b,
    blue: 0x2b5c9e, red: 0xa3352b, gold: 0xc9a24a, wood: 0x6e4b2f, bronze: 0x9a7440, iron: 0x3d3b3a,
    roof: 0x8c4a33, glowWarm: 0xffa45a, glowGreen: 0x7dff4a, plaster: 0x7a6f61,
};
/** Surface variants (aux.w) of the stone slot. */
export const STONE = { ashlar: 0, trim: 1, slab: 2, rough: 3, wood: 4 };

const C = hex => new THREE.Color(hex);
const pol = (t, r, y) => [Math.cos(t) * r, y, Math.sin(t) * r];
const teamOf = t => (Math.sin(t) > 0 ? TINT.blue : TINT.red); // player side (z > 0) blue, opponent red

// ---- Mesh writer -------------------------------------------------------------------------------------------------

class Writer {
    constructor() {
        this.slots = new Map();
        this.lights = []; // { p: [x, y, z], i, r } warm light baked into aux.y
    }

    slot(name) {
        let s = this.slots.get(name);
        if (!s) {
            s = { pos: [], nor: [], uv: [], tint: [], aux: [], wave: [], index: [], count: 0 };
            this.slots.set(name, s);
        }
        return s;
    }

    vertex(s, p, n, u, v, o, ao = 1, wave = null) {
        s.pos.push(p[0], p[1], p[2]);
        s.nor.push(n[0], n[1], n[2]);
        s.uv.push(u, v);
        const c = o.color;
        s.tint.push(c.r, c.g, c.b);
        s.aux.push(ao, 0, o.delay ?? 0, o.kind ?? 0);
        if (o.cloth) s.wave.push(wave ? wave[0] : 0, wave ? wave[1] : 0);
        return s.count++;
    }

    /** A planar quad p0..p3 (counter-clockwise seen from its front). `uvs`: four [u, v]; `aos`: four occlusions. */
    quad(slot, p, o, uvs, aos = [1, 1, 1, 1], waves = null) {
        const s = this.slot(slot);
        const a = new THREE.Vector3(...p[1]).sub(new THREE.Vector3(...p[0]));
        const b = new THREE.Vector3(...p[2]).sub(new THREE.Vector3(...p[0]));
        const n = a.cross(b).normalize().toArray();
        const base = s.count;
        for (let i = 0; i < 4; i++) this.vertex(s, p[i], n, uvs[i][0], uvs[i][1], o, aos[i], waves && waves[i]);
        s.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** A quad with physical uvs: `w` and `h` its size along p0->p1 and p0->p3, in blocks of o.bw x o.bh. */
    panel(slot, p, o, w, h, aos) {
        const bw = o.bw ?? 48, bh = o.bh ?? 22, u0 = o.u0 ?? 0, v0 = o.v0 ?? 0;
        this.quad(slot, p, o, [[u0, v0], [u0 + w / bw, v0], [u0 + w / bw, v0 + h / bh], [u0, v0 + h / bh]], aos);
    }

    /**
     * Sweeps a profile of points { r, y, ao?, smooth?, ...edge overrides } around (cx, cz) from angle t0 to t1. Walking
     * along the profile, the solid is on the right: an inner wall goes up, an outer wall comes down. Edge overrides on
     * the first point of an edge: color, kind, bw, bh (block size), skip.
     */
    ring(slot, profile, t0, t1, segs, o, cx = 0, cz = 0) {
        const s = this.slot(slot);
        const n2 = [];
        for (let i = 0; i < profile.length - 1; i++) {
            const a = profile[i], b = profile[i + 1];
            const len = Math.hypot(b.r - a.r, b.y - a.y) || 1;
            n2.push([-(b.y - a.y) / len, (b.r - a.r) / len]);
        }
        const avg = (p, q) => { const x = p[0] + q[0], y = p[1] + q[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
        let acc = 0;
        for (let i = 0; i < profile.length - 1; i++) {
            const a = profile[i], b = profile[i + 1];
            const len = Math.hypot(b.r - a.r, b.y - a.y);
            const v0 = acc;
            acc += len;
            if (len < 1e-6 || a.skip) continue;
            const e = { ...o, color: a.color !== undefined ? C(a.color) : o.color, kind: a.kind ?? o.kind };
            const bw = a.bw ?? o.bw ?? 48, bh = a.bh ?? o.bh ?? 22;
            const na = a.smooth && i > 0 ? avg(n2[i - 1], n2[i]) : n2[i];
            const nb = b.smooth && i < n2.length - 1 ? avg(n2[i], n2[i + 1]) : n2[i];
            const rMid = Math.max(1, (a.r + b.r) / 2);
            const base = s.count;
            for (let j = 0; j <= segs; j++) {
                const t = t0 + (t1 - t0) * j / segs, c = Math.cos(t), sn = Math.sin(t);
                const u = (t - t0) * rMid / bw + (o.u0 ?? 0);
                this.vertex(s, [cx + c * a.r, a.y, cz + sn * a.r], [c * na[0], na[1], sn * na[0]], u, v0 / bh, e, a.ao ?? 1);
                this.vertex(s, [cx + c * b.r, b.y, cz + sn * b.r], [c * nb[0], nb[1], sn * nb[0]], u, (v0 + len) / bh, e, b.ao ?? 1);
            }
            // Winding from the first quad (both of its triangles, one may be degenerate at an axis) against the normal.
            const at = q => new THREE.Vector3(s.pos[q * 3], s.pos[q * 3 + 1], s.pos[q * 3 + 2]);
            const A0 = at(base), B0 = at(base + 1), A1 = at(base + 2), B1 = at(base + 3);
            const geomN = A1.clone().sub(A0).cross(B1.clone().sub(A0)).add(B1.clone().sub(A0).cross(B0.clone().sub(A0)));
            const tm = t0 + (t1 - t0) / (2 * segs);
            const want = new THREE.Vector3(Math.cos(tm) * n2[i][0], n2[i][1], Math.sin(tm) * n2[i][0]);
            const ccw = geomN.dot(want) >= 0;
            for (let j = 0; j < segs; j++) {
                const a0 = base + 2 * j, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
                if (ccw) s.index.push(a0, a1, b1, a0, b1, b0);
                else s.index.push(a0, b1, a1, a0, b0, b1);
            }
        }
    }

    /** A box centred at (x, y, z), turned by `rot` about y, with physical uvs on every face. `skip`: faces to leave out. */
    box(slot, x, y, z, w, h, d, rot, o, skip = '') {
        const c = Math.cos(rot), s = Math.sin(rot);
        // Local axes: X (width) = (c, 0, -s), Y up, Z (depth) = (s, 0, c), the usual three.js rotation about y.
        const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
        const hw = w / 2, hh = h / 2, hd = d / 2;
        const faces = {
            pz: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], w, h],
            nz: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], w, h],
            px: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], d, h],
            nx: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], d, h],
            py: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], w, d],
            ny: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], w, d],
        };
        const ao = o.boxAo ?? [1, 1, 1, 1];
        for (const [name, f] of Object.entries(faces)) {
            if (skip.includes(name)) continue;
            const aos = name === 'py' ? [1, 1, 1, 1] : name === 'ny' ? [0.6, 0.6, 0.6, 0.6] : ao;
            this.panel(slot, f.slice(0, 4).map(q => P(...q)), o, f[4], f[5], aos);
        }
    }

    /** Appends a three.js geometry (transformed by `matrix`), its uvs scaled by 1 / (o.bw, o.bh). */
    geometry(slot, geometry, matrix, o) {
        const s = this.slot(slot);
        const g = geometry.index ? geometry : geometry; // indexed or not, both handled below
        const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
        const nm = new THREE.Matrix3().getNormalMatrix(matrix);
        const p = new THREE.Vector3(), n = new THREE.Vector3();
        const base = s.count;
        const bw = o.bw ?? 48, bh = o.bh ?? 22;
        for (let i = 0; i < pos.count; i++) {
            p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
            n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
            const u = uv ? uv.getX(i) * (o.uScale ?? 1) / bw : 0, v = uv ? uv.getY(i) * (o.vScale ?? 1) / bh : 0;
            const ao = o.aoAt ? o.aoAt(p, n) : (o.ao ?? 1);
            this.vertex(s, p.toArray(), n.toArray(), u, v, o, ao, o.waveAt ? o.waveAt(p, i) : null);
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) s.index.push(base + g.index.getX(i));
        else for (let i = 0; i < pos.count; i++) s.index.push(base + i);
        // A mirrored matrix turns the triangles inside out.
        if (matrix.determinant() < 0) {
            const idx = s.index;
            for (let i = idx.length - (g.index ? g.index.count : pos.count); i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
        }
    }

    /** A warm light that brightens the surfaces around it (baked per vertex). */
    light(p, intensity, radius) { this.lights.push({ p, i: intensity, r: radius }); }

    /** Bakes the lights and returns one BufferGeometry per slot. */
    build() {
        const out = {};
        for (const [name, s] of this.slots) {
            this.bake(s);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
            const tint = new Uint8Array(s.count * 4), aux = new Uint8Array(s.count * 4);
            const c = new THREE.Color();
            for (let i = 0; i < s.count; i++) {
                c.setRGB(s.tint[i * 3], s.tint[i * 3 + 1], s.tint[i * 3 + 2]).getRGB(c, THREE.SRGBColorSpace);
                tint[i * 4] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
                tint[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
                tint[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
                tint[i * 4 + 3] = 255;
                for (let k = 0; k < 4; k++) aux[i * 4 + k] = Math.round(THREE.MathUtils.clamp(s.aux[i * 4 + k] / (k === 3 ? 255 : 1), 0, 1) * 255);
            }
            g.setAttribute('tint', new THREE.BufferAttribute(tint, 4, true));
            g.setAttribute('aux', new THREE.BufferAttribute(aux, 4, true));
            if (s.wave.length) g.setAttribute('wave', new THREE.Float32BufferAttribute(s.wave, 2));
            g.setIndex(s.count > 65535 ? new THREE.Uint32BufferAttribute(s.index, 1) : new THREE.Uint16BufferAttribute(s.index, 1));
            g.computeBoundingSphere();
            out[name] = g;
        }
        return out;
    }

    /** Warm light per vertex: falloff with distance, facing the light, never quite black on the far side. */
    bake(s) {
        // Lights in a grid of cells on the ground plane, each listed in the cells its reach (3 r) touches.
        const CELL = 300, grid = new Map();
        const key = (cx, cz) => cx * 4096 + cz;
        for (const l of this.lights) {
            const reach = 3 * l.r;
            for (let cx = Math.floor((l.p[0] - reach) / CELL); cx <= Math.floor((l.p[0] + reach) / CELL); cx++) {
                for (let cz = Math.floor((l.p[2] - reach) / CELL); cz <= Math.floor((l.p[2] + reach) / CELL); cz++) {
                    const k = key(cx, cz);
                    if (!grid.has(k)) grid.set(k, []);
                    grid.get(k).push(l);
                }
            }
        }
        for (let i = 0; i < s.count; i++) {
            const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
            const nx = s.nor[i * 3], ny = s.nor[i * 3 + 1], nz = s.nor[i * 3 + 2];
            let sum = 0;
            for (const l of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []) {
                const dx = l.p[0] - x, dy = l.p[1] - y, dz = l.p[2] - z;
                const d2 = dx * dx + dy * dy + dz * dz, r2 = l.r * l.r;
                if (d2 > 9 * r2) continue;
                const d = Math.sqrt(d2) || 1;
                const facing = Math.max(0.12, (dx * nx + dy * ny + dz * nz) / d);
                sum += l.i * facing / (1 + d2 / r2) * (1 - d2 / (9 * r2));
            }
            s.aux[i * 4 + 1] = Math.min(1, sum / GLOW_MAX);
        }
    }
}

// ---- Seeded randomness ---------------------------------------------------------------------------------------------

export function random(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---- Modules ---------------------------------------------------------------------------------------------------------

/** Is angle t inside one of the aisles of an arc [a0, a1]? Returns the aisle's centre or null. */
export function aisleAt(t, a0, a1) {
    const period = (a1 - a0) / AISLES;
    const k = Math.round((t - a0) / period - 0.5);
    const c = a0 + (k + 0.5) * period;
    return Math.abs(t - c) < AISLE_W / 2 ? c : null;
}

/** Angular ranges of an arc between its aisles, and the aisles themselves. */
function aisleSplit(a0, a1) {
    const period = (a1 - a0) / AISLES, seats = [], aisles = [];
    let t = a0;
    for (let k = 0; k < AISLES; k++) {
        const c = a0 + (k + 0.5) * period;
        seats.push([t, c - AISLE_W / 2]);
        aisles.push([c - AISLE_W / 2, c + AISLE_W / 2]);
        t = c + AISLE_W / 2;
    }
    seats.push([t, a1]);
    return { seats, aisles };
}

const isGateTower = (x, z, margin) => GATE_TOWERS.some(g => Math.hypot(x - g.x, z - g.z) < 176 + margin);

/** Arena wall (podium), terraces with aisle stairs, the walkway parapets and the back wall of the stands. */
function stands(w, segs, fires) {
    // The arena wall and the walkway on it: plinth, ashlar face, a moulded coping.
    const wall = [
        { r: WALL_R - 9, y: -2, ao: 0.55, kind: STONE.rough, color: TINT.dark },
        { r: WALL_R - 9, y: 9, ao: 0.8, kind: STONE.trim, color: TINT.trim },
        { r: WALL_R, y: 11, ao: 0.6 },
        { r: WALL_R, y: 58, ao: 0.95, kind: STONE.ashlar },
        { r: WALL_R - 6, y: 61, ao: 0.7, kind: STONE.trim, color: TINT.trim, smooth: true },
        { r: WALL_R - 9, y: 66, kind: STONE.trim, color: TINT.trim },
        { r: WALL_R - 9, y: 71, kind: STONE.trim, color: TINT.trim },
        { r: WALL_R - 5, y: WALL_H, kind: STONE.slab, color: TINT.tread },
        { r: STANDS_IN, y: WALL_H, ao: 0.6 },
    ];
    // One tier: riser with a rounded nosing, then the tread.
    const tier = (k, aisle) => {
        const r = STANDS_IN + k * TIER_DEPTH, h = WALL_H + k * TIER_RISE;
        const walkway = WALKWAYS.includes(k - 1); // the riser behind a walkway is a parapet with a coping
        const riserColor = walkway ? TINT.trim : TINT.riser;
        if (aisle) {
            const half = TIER_DEPTH / 2, step = TIER_RISE / 2;
            return [
                { r, y: h, ao: 0.6, kind: STONE.slab, color: TINT.aisle, bw: 40, bh: step },
                { r, y: h + step, kind: STONE.slab, color: TINT.aisle, bw: 40, bh: half },
                { r: r + half, y: h + step, ao: 0.6, kind: STONE.slab, color: TINT.aisle, bw: 40, bh: step },
                { r: r + half, y: h + TIER_RISE, kind: STONE.slab, color: TINT.aisle, bw: 40, bh: half },
            ];
        }
        return [
            { r, y: h, ao: 0.5, kind: walkway ? STONE.trim : STONE.slab, color: riserColor, bw: 90, bh: TIER_RISE - 4 },
            { r, y: h + TIER_RISE - 4, ao: 0.85, kind: STONE.trim, color: TINT.trim, smooth: true },
            { r: r - 4, y: h + TIER_RISE - 1, kind: STONE.trim, color: TINT.trim, smooth: true },
            { r: r - 3, y: h + TIER_RISE, kind: STONE.slab, color: WALKWAYS.includes(k) ? TINT.aisle : TINT.tread, bw: 70, bh: TIER_DEPTH },
        ];
    };
    const back = [
        { r: STANDS_OUT, y: TOP, ao: 0.55, kind: STONE.ashlar, color: TINT.stone },
        { r: STANDS_OUT, y: GALLERY_Y - 6, ao: 0.9, kind: STONE.trim, color: TINT.trim },
        { r: STANDS_OUT - 6, y: GALLERY_Y - 3, kind: STONE.trim, color: TINT.trim, smooth: true },
        { r: STANDS_OUT - 6, y: GALLERY_Y, kind: STONE.slab, color: TINT.tread },
        { r: OUTER_R - 26, y: GALLERY_Y, ao: 0.5 },
    ];
    const profile = aisle => {
        const p = [...wall];
        for (let k = 0; k < TIERS; k++) p.push(...tier(k, aisle));
        p.push(...back);
        return p;
    };
    for (const [a0, a1] of ARCS) {
        const { seats, aisles } = aisleSplit(a0, a1);
        const team = teamOf((a0 + a1) / 2);
        for (const [t0, t1] of seats) {
            const n = Math.max(2, Math.round(segs * (t1 - t0) / (a1 - a0)));
            w.ring('stone', profile(false), t0, t1, n, { color: C(TINT.stone), delay: 0 });
            // Wooden benches along each row of seats (not on the walkways).
            for (let k = 0; k < TIERS; k++) {
                if (WALKWAYS.includes(k)) continue;
                const r = STANDS_IN + k * TIER_DEPTH, y = WALL_H + (k + 1) * TIER_RISE;
                w.ring('stone', [{ r: r + 13, y, ao: 0.55 }, { r: r + 13, y: y + 7 }, { r: r + 33, y: y + 7 }, { r: r + 33, y, ao: 0.55 }],
                    t0 + 0.004, t1 - 0.004, n, { color: C(TINT.wood), kind: STONE.wood, delay: 0, bw: 90, bh: 6 });
            }
        }
        for (const [t0, t1] of aisles) {
            w.ring('stone', profile(true), t0, t1, 2, { color: C(TINT.aisle), delay: 0 });
            // The cheeks of the stairs: where a seat tread stands above the half step in front of it.
            for (const [t, sign] of [[t0, -1], [t1, 1]]) {
                for (let k = 0; k < TIERS; k++) {
                    const r = STANDS_IN + k * TIER_DEPTH, h = WALL_H + k * TIER_RISE;
                    const q = [pol(t, r - 3, h + TIER_RISE / 2), pol(t, r + TIER_DEPTH / 2, h + TIER_RISE / 2), pol(t, r + TIER_DEPTH / 2, h + TIER_RISE), pol(t, r - 3, h + TIER_RISE)];
                    if (sign > 0) q.reverse();
                    w.panel('stone', q, { color: C(TINT.riser), kind: STONE.slab, bw: 40, bh: 15 }, TIER_DEPTH / 2, TIER_RISE / 2, [0.6, 0.6, 0.9, 0.9]);
                }
            }
        }
        // Team-coloured cloth along the two walkway parapets.
        for (const k of WALKWAYS) {
            const r = STANDS_IN + (k + 1) * TIER_DEPTH - 1, h = WALL_H + (k + 1) * TIER_RISE;
            for (const [t0, t1] of seats) {
                const n = Math.max(1, Math.round((t1 - t0) * r / 60));
                for (let i = 0; i < n; i++) {
                    const ta = t0 + (t1 - t0) * (i + 0.12) / n, tb = t0 + (t1 - t0) * (i + 0.88) / n;
                    clothPanel(w, ta, tb, r, h + 1, h + TIER_RISE - 5, team, i * 1.7 + k);
                }
            }
            // A torch on an iron post beside every stairway on the walkway: warm light up in the stands.
            for (const [ta] of aisles) {
                const t = ta - 0.012;
                const [x, , z] = pol(t, r - 10, 0);
                w.box('metal', x, h + 20, z, 3, 40, 3, Math.PI / 2 - t, { color: C(TINT.iron) });
                w.ring('metal', [{ r: 0.1, y: h + 40 }, { r: 7, y: h + 46 }, { r: 6, y: h + 47 }, { r: 0.1, y: h + 44 }], 0, Math.PI * 2, 6, { color: C(TINT.iron) }, x, z);
                fires.push({ p: [x, h + 47, z], size: 24, hue: 0, phase: t * 7 + k });
                w.light([x, h + 52, z], 1.1, 120);
            }
        }
    }
}

/** A banner hanging flat against a curved wall (radius r, facing the centre) from angle ta to tb, between y0 and y1. */
function clothPanel(w, ta, tb, r, y0, y1, color, phase, sway = 0.25) {
    const s = w.slot('cloth');
    const o = { color: C(color), cloth: true, kind: 0 };
    const cols = 3, rows = 4, base = s.count;
    for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
            const t = ta + (tb - ta) * i / cols, y = y1 - (y1 - y0) * j / rows;
            const n = [-Math.cos(t), 0, -Math.sin(t)];
            // A pointed hem: the middle hangs lower.
            const dip = (1 - Math.abs(i / cols - 0.5) * 2) * (y1 - y0) * 0.12 * (j / rows);
            w.vertex(s, pol(t, r - 0.5, y - dip), n, i / cols, j / rows, o, 1, [sway * (j / rows), phase]);
        }
    }
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 2, d = a + cols + 1;
            s.index.push(a, d, c, a, c, b);
        }
    }
}

/** A swallow-tailed banner hanging from a rod at (x, y, z), its front facing direction `face` (radians about y). */
function hangingBanner(w, x, y, z, face, width, len, color, phase) {
    const s = w.slot('cloth');
    const o = { color: C(color), cloth: true };
    const cols = 4, rows = 6, base = s.count;
    const nx = Math.sin(face), nz = Math.cos(face);
    const tx = Math.cos(face), tz = -Math.sin(face);
    for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
            const a = i / cols - 0.5, f = j / rows;
            const notch = Math.max(0, f - 0.75) / 0.25 * (1 - Math.abs(a) * 2) * len * 0.18;
            w.vertex(s, [x + tx * a * width, y - f * len + notch, z + tz * a * width], [nx, 0, nz], i / cols, f, o, 1, [f, phase]);
        }
    }
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 2, d = a + cols + 1;
            s.index.push(a, c, b, a, d, c);
        }
    }
}

/** Pilasters, banners and torch sconces on the arena wall; a bronze railing along its top. */
function wallDressing(w, fires) {
    let n = 0;
    for (const [a0, a1] of ARCS) {
        // Railing: posts and a top rail, broken where the gate towers stand.
        const posts = Math.round((a1 - a0) * WALL_R / 26);
        let run = null;
        const rail = (t0, t1) => w.ring('metal', [{ r: 712, y: 85 }, { r: 712, y: 89 }, { r: 715.5, y: 89 }, { r: 715.5, y: 85 }, { r: 712, y: 85 }], t0, t1, Math.max(2, Math.round((t1 - t0) * 40)), { color: C(TINT.bronze), delay: 0.05 });
        for (let i = 0; i <= posts; i++) {
            const t = a0 + (a1 - a0) * i / posts;
            const [x, , z] = pol(t, 713.8, 0);
            const blocked = isGateTower(x, z, 4);
            if (!blocked) {
                w.box('metal', x, 80.5, z, 2.4, 13, 2.4, Math.PI / 2 - t, { color: C(TINT.bronze), delay: 0.05 }, 'ny');
                run = run ?? t;
            }
            if ((blocked || i === posts) && run !== null) {
                const end = blocked ? a0 + (a1 - a0) * (i - 1) / posts : t;
                if (end > run) rail(run, end);
                run = null;
            }
        }
        const count = 22;
        for (let i = 0; i <= count; i++) {
            const t = a0 + (a1 - a0) * i / count;
            const [x, , z] = pol(t, WALL_R, 0);
            if (isGateTower(x, z, 10)) continue;
            // Pilaster: a shallow pier with a capital block, standing on the plinth.
            const rot = Math.PI / 2 - t; // local z radial
            const [px, , pz] = pol(t, WALL_R - 3, 0);
            w.box('stone', px, 35, pz, 15, 48, 7, rot, { color: C(TINT.trim), kind: STONE.trim, bw: 30, bh: 30, delay: 0.05 }, 'ny');
            if (i === count) continue;
            const tm = t + (a1 - a0) / count / 2;
            const [mx, , mz] = pol(tm, WALL_R, 0);
            if (isGateTower(mx, mz, 50)) continue;
            if (n++ % 2 === 0) {
                // Torch sconce: an iron bracket and a bowl with fire.
                const [bx, , bz] = pol(tm, WALL_R - 8, 0);
                w.box('metal', bx, 50, bz, 4, 14, 12, Math.PI / 2 - tm, { color: C(TINT.iron), delay: 0.05 });
                const bowl = new THREE.LatheGeometry([new THREE.Vector2(0.1, 0), new THREE.Vector2(4, 1), new THREE.Vector2(8, 6), new THREE.Vector2(7, 7)], 8);
                const [cx, , cz] = pol(tm, WALL_R - 15, 0);
                w.geometry('metal', bowl, new THREE.Matrix4().makeTranslation(cx, 56, cz), { color: C(TINT.iron), delay: 0.05 });
                fires.push({ p: [cx, 66, cz], size: 22, hue: 0, phase: n * 1.3 });
                w.light([cx, 70, cz], 1.0, 90);
            } else {
                // A team banner on the wall face.
                const tw = 46 / WALL_R;
                clothPanel(w, tm - tw / 2, tm + tw / 2, WALL_R - 1.5, 14, 57, teamOf(t), n * 0.7, 0.15);
            }
        }
    }
}

/** A round gate tower with a battered base, a corbelled parapet with merlons, a banner and a brazier on top. */
function gateTower(w, center, segs, fires, torches) {
    const { x, z } = center;
    const profile = [
        { r: 0, y: 166, kind: STONE.slab, color: TINT.dark, bw: 40, bh: 34 },
        { r: 146, y: 166, ao: 0.55 },
        { r: 146, y: 196, ao: 0.9, kind: STONE.ashlar },
        { r: 170, y: 196, kind: STONE.trim, color: TINT.trim },
        { r: 170, y: 172, kind: STONE.ashlar },
        { r: 168, y: 166, ao: 0.6, kind: STONE.trim, color: TINT.trim, smooth: true },
        { r: 158, y: 156, ao: 0.5, kind: STONE.ashlar },
        { r: 158, y: 112, kind: STONE.trim, color: TINT.trim },
        { r: 163, y: 108, kind: STONE.trim, color: TINT.trim },
        { r: 163, y: 101, ao: 0.7, kind: STONE.trim, color: TINT.trim },
        { r: 158, y: 98, ao: 0.6, kind: STONE.ashlar },
        { r: 158, y: 34, kind: STONE.rough, color: TINT.dark },
        { r: 178, y: -2, ao: 0.5 },
    ];
    w.ring('stone', profile, 0, Math.PI * 2, segs, { color: C(TINT.stone), delay: 0.25 }, x, z);
    // Merlons and the corbels under the parapet.
    const merlons = 14;
    for (let i = 0; i < merlons; i++) {
        const a = (i + 0.5) / merlons * Math.PI * 2;
        w.box('stone', x + Math.cos(a) * 158, 207, z + Math.sin(a) * 158, 30, 22, 24, -a + Math.PI / 2, { color: C(TINT.stone), kind: STONE.ashlar, bw: 30, bh: 22, delay: 0.25 }, 'ny');
    }
    for (let i = 0; i < 28; i++) {
        const a = (i + 0.5) / 28 * Math.PI * 2;
        w.box('stone', x + Math.cos(a) * 164, 160, z + Math.sin(a) * 164, 9, 12, 14, -a + Math.PI / 2, { color: C(TINT.trim), kind: STONE.trim, delay: 0.25 }, 'py');
    }
    // Arrow slits: dark recessed strips around the shaft.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        w.box('glow', x + Math.cos(a) * 157.6, 70, z + Math.sin(a) * 157.6, 7, 30, 2, -a + Math.PI / 2, { color: C(0x140c06), delay: 0.25 });
    }
    // Brazier: a bronze bowl on a fluted stem on the tower top.
    const brazier = new THREE.LatheGeometry([
        new THREE.Vector2(0.1, 0), new THREE.Vector2(26, 0), new THREE.Vector2(24, 6), new THREE.Vector2(10, 10), new THREE.Vector2(8, 30),
        new THREE.Vector2(12, 34), new THREE.Vector2(38, 44), new THREE.Vector2(44, 54), new THREE.Vector2(40, 56), new THREE.Vector2(20, 50), new THREE.Vector2(0.1, 50),
    ], 16);
    w.geometry('metal', brazier, new THREE.Matrix4().makeTranslation(x, 166, z), { color: C(TINT.bronze), delay: 0.25 });
    const fire = new THREE.Vector3(x, 232, z);
    fires.push({ p: fire.toArray(), size: 120, hue: 0, phase: x * 0.01 + z * 0.003, main: true });
    torches.push(fire.clone().setY(200));
    w.light([x, 240, z], 2.2, 230);
    // A long team banner facing the sand.
    const face = Math.atan2(-x, -z);
    const [fx, fz] = [Math.sin(face), Math.cos(face)];
    hangingBanner(w, x + fx * 160, 188, z + fz * 160, face, 64, 120, z > 0 ? TINT.blue : TINT.red, x * 0.02);
    w.box('metal', x + fx * 161, 189, z + fz * 161, 74, 4, 4, face, { color: C(TINT.iron), delay: 0.25 });
}

/** The gatehouse at side ±1 (x): a portal with a vaulted tunnel, turrets, the stadium screen and a tall soul spire. */
function gatehouse(w, side, segs, fires, screens) {
    const g = GAP + deg(1);
    const front = WALL_R * Math.cos(g), half = WALL_R * Math.sin(g);
    const outR = OUTER_R + 10, outHalf = outR * Math.sin(g), outX = outR * Math.cos(g);
    const H = ATTIC_TOP + 20; // the portal's crown and the turrets
    const Hw = H - 40; // the gatehouse body
    const X = v => side * v;
    const stone = { color: C(TINT.stone), kind: STONE.ashlar, delay: 0.15 };
    const trim = { color: C(TINT.trim), kind: STONE.trim, delay: 0.15 };
    // Body: the wedge behind the portal (sides, back, roof). Its front is the portal slab.
    const depth = 46; // thickness of the portal slab
    const fx = front + depth;
    const fh = WALL_R * Math.sin(g) + depth * Math.tan(g);
    const P = (x, y, z) => [X(x), y, z];
    const flipX = q => (side > 0 ? q : [q[1], q[0], q[3], q[2]]); // mirrored on the -x side
    // left/right sides of the wedge
    for (const sz of [-1, 1]) {
        const q = [P(fx, 0, sz * fh), P(outX, 0, sz * outHalf), P(outX, Hw, sz * outHalf), P(fx, Hw, sz * fh)];
        w.panel('stone', (sz > 0) === (side > 0) ? q : [q[1], q[0], q[3], q[2]], stone, Math.hypot(outX - fx, outHalf - fh), Hw);
    }
    // back
    w.panel('stone', flipX([P(outX, 0, outHalf), P(outX, 0, -outHalf), P(outX, Hw, -outHalf), P(outX, Hw, outHalf)]), stone, outHalf * 2, Hw);
    // roof deck
    w.panel('stone', flipX([P(fx, Hw, fh), P(outX, Hw, outHalf), P(outX, Hw, -outHalf), P(fx, Hw, -fh)]), { ...stone, kind: STONE.slab }, outX - fx, outHalf * 2);

    // Portal slab with the arched tunnel mouth (an opening through the slab, not a dark plane).
    const AW = 130, AH = 140; // half width, spring height of the arch
    const shape = new THREE.Shape();
    shape.moveTo(-half - 30, -2);
    shape.lineTo(half + 30, -2);
    shape.lineTo(half + 30, Hw);
    shape.lineTo(-half - 30, Hw);
    shape.lineTo(-half - 30, -2);
    const hole = new THREE.Path();
    hole.moveTo(-AW, -2);
    hole.lineTo(-AW, AH);
    hole.absarc(0, AH, AW, Math.PI, 0, true);
    hole.lineTo(AW, -2);
    hole.lineTo(-AW, -2);
    shape.holes.push(hole);
    const slab = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 18 });
    // Shape x -> world z, shape y -> world y, extrusion (+z) -> outward (+x on side 1).
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, side), new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0)).setPosition(X(front), 0, 0);
    w.geometry('stone', slab, m, stone);

    // The tunnel: walls and barrel vault running back into the gatehouse, dark at the far end with a green glow.
    const tunnelLen = 360;
    const vault = [];
    for (let i = 0; i <= 12; i++) {
        const a = Math.PI * i / 12;
        vault.push([Math.cos(a) * AW, AH + Math.sin(a) * AW]);
    }
    const arch = [[AW, -2], ...vault, [-AW, -2]];
    for (let i = 0; i < arch.length - 1; i++) {
        const [z0, y0] = arch[i], [z1, y1] = arch[i + 1];
        const x0 = front + depth - 1, x1 = front + tunnelLen;
        const q = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z1), P(x0, y1, z1)];
        const len = Math.hypot(z1 - z0, y1 - y0);
        const aos = [0.75, 0.25, 0.25, 0.75];
        w.panel('stone', side > 0 ? [q[1], q[0], q[3], q[2]] : q, { ...stone, color: C(TINT.dark), kind: STONE.ashlar }, tunnelLen - depth, len, aos);
    }
    // Far end: the soul light behind two heavy wooden doors standing ajar, banded with iron.
    const endQ = [P(front + tunnelLen, -2, AW), P(front + tunnelLen, -2, -AW), P(front + tunnelLen, AH + AW, -AW), P(front + tunnelLen, AH + AW, AW)];
    w.panel('glow', side > 0 ? [endQ[1], endQ[0], endQ[3], endQ[2]] : endQ, { color: C(0x3cff55), kind: 120, delay: 0.15, bw: 1, bh: 1 }, 1, 1);
    const wood = { color: C(TINT.wood), kind: STONE.wood, delay: 0.15, bw: 16, bh: 120 };
    for (const sz of [-1, 1]) {
        const dw = AW - 8, dz = sz * (8 + dw / 2), dx = X(front + tunnelLen - 22);
        w.box('stone', dx, (AH + 40) / 2 - 2, dz, 10, AH + 40, dw, sz * side * 0.12, wood);
        for (const y of [24, 80, AH + 6]) w.box('metal', dx - side * 5.5, y, dz, 2, 8, dw + 2, sz * side * 0.12, { color: C(TINT.iron), delay: 0.15 });
    }
    // Voussoirs: a ring of wedge stones around the arch, a keystone with a green soul gem.
    const ringPts = 15;
    for (let i = 0; i < ringPts; i++) {
        const a0 = Math.PI * i / ringPts, a1 = Math.PI * (i + 1) / ringPts;
        const r0 = AW + 2, r1 = AW + (i === Math.floor(ringPts / 2) ? 34 : 24);
        const pts = [[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a1) * r0, Math.sin(a1) * r0], [Math.cos(a1) * r1, Math.sin(a1) * r1], [Math.cos(a0) * r1, Math.sin(a0) * r1]];
        const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u * 0.985 + (u > 0 ? 0 : 0), v)));
        const gv = new THREE.ExtrudeGeometry(sh, { depth: 8, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.2, bevelSegments: 1 });
        const mm = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, side), new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0)).setPosition(X(front - 8), AH, 0);
        w.geometry('stone', gv, mm, { ...trim, bw: 30, bh: 30 });
    }
    // Green rune band inside the voussoirs (the "Souls" ring of the classic picture).
    const band = new THREE.TorusGeometry(AW + 1, 2.6, 6, 40, Math.PI);
    w.geometry('glow', band, new THREE.Matrix4().makeRotationY(side > 0 ? -Math.PI / 2 : Math.PI / 2).setPosition(X(front - 9), AH, 0), { color: C(TINT.glowGreen), kind: 170, delay: 0.15 });
    const gem = new THREE.OctahedronGeometry(9, 0);
    w.geometry('glow', gem, new THREE.Matrix4().makeScale(0.6, 1.2, 1).setPosition(X(front - 18), AH + AW + 16, 0), { color: C(TINT.glowGreen), kind: 200, delay: 0.15 });
    // Pilasters and a cornice framing the portal; a crenellated parapet on top.
    for (const sz of [-1, 1]) {
        w.box('stone', X(front - 10), Hw / 2, sz * (AW + 66), 24, Hw, 34, side > 0 ? -Math.PI / 2 : Math.PI / 2, { ...trim, bw: 40, bh: 40 }, 'ny');
    }
    for (const [y, hgt, dep] of [[300, 14, 22], [314, 8, 28], [Hw - 6, 12, 26]]) {
        w.box('stone', X(front - dep / 2 + 4), y, 0, dep, hgt, half * 2 + 70, 0, { ...trim, bw: 60, bh: 14 });
    }
    for (let i = -4; i <= 4; i++) {
        w.box('stone', X(front + 6), Hw + 14, i * 40, 22, 28, 26, 0, { ...stone, bw: 26, bh: 28 }, 'ny');
    }
    // Two turrets with conical slate roofs flank the portal.
    for (const sz of [-1, 1]) {
        const cx = X(front + 30), cz = sz * (half + 26);
        w.ring('stone', [
            { r: 0, y: H + 70, kind: STONE.slab },
            { r: 52, y: H + 70, kind: STONE.trim, color: TINT.trim },
            { r: 52, y: H + 58, kind: STONE.trim, color: TINT.trim },
            { r: 46, y: H + 48, ao: 0.6, kind: STONE.ashlar },
            { r: 46, y: 300, kind: STONE.ashlar },
            { r: 50, y: 290, kind: STONE.trim, color: TINT.trim },
            { r: 50, y: -2, ao: 0.5 },
        ], 0, Math.PI * 2, Math.max(12, segs >> 3), { ...stone }, cx, cz);
        w.ring('roof', [{ r: 0, y: H + 200 }, { r: 60, y: H + 68, ao: 0.7 }, { r: 54, y: H + 64 }], 0, Math.PI * 2, Math.max(12, segs >> 3), { color: C(0x4a4f5e), kind: 1, delay: 0.15, bw: 16, bh: 12 }, cx, cz);
        w.box('metal', cx, H + 215, cz, 3, 34, 3, 0, { color: C(TINT.bronze), delay: 0.15 });
        hangingBanner(w, cx - side * 50, H + 40, cz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 46, 140, TINT.gold, cz * 0.03);
    }

    // The stadium screen in a bronze frame, held out from the portal on iron struts.
    const facing = -side * (Math.PI / 2 - 0.25);
    const normal = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const sx = X(front - 85);
    w.box('metal', sx, SCREEN_Y, 0, SCREEN_W + 36, SCREEN_H + 36, 20, facing, { color: C(TINT.bronze), delay: 0.15 });
    w.box('metal', sx - normal.x * 10, SCREEN_Y, -normal.z * 10, SCREEN_W + 10, SCREEN_H + 10, 6, facing, { color: C(TINT.iron), delay: 0.15 });
    for (const y of [SCREEN_Y + SCREEN_H / 2 - 30, SCREEN_Y - SCREEN_H / 2 + 30]) {
        for (const sz of [-1, 1]) w.box('metal', X(front - 40), y, sz * 90, 96, 10, 10, 0, { color: C(TINT.iron), delay: 0.15 });
    }
    w.box('glow', sx + normal.x * 11, SCREEN_Y - SCREEN_H / 2 - 22, normal.z * 11, SCREEN_W + 30, 5, 3, facing, { color: C(TINT.glowGreen), kind: 200, delay: 0.15 });
    screens.push({ position: new THREE.Vector3(sx, SCREEN_Y, 0).addScaledVector(normal, 10.5), rotation: facing });

    // A dais in front of the tunnel: two round steps with bronze inlay rings.
    const dx = X(SAND - 30);
    w.ring('stone', [
        { r: 0, y: 18, kind: STONE.slab, color: TINT.tread, bw: 40, bh: 40 },
        { r: 116, y: 18, kind: STONE.trim, color: TINT.trim },
        { r: 118, y: 10, ao: 0.7, kind: STONE.slab, color: TINT.tread },
        { r: 150, y: 10, kind: STONE.trim, color: TINT.trim },
        { r: 154, y: -2, ao: 0.6 },
    ], 0, Math.PI * 2, Math.max(24, segs >> 2), { ...stone, delay: 0.15 }, dx, 0);
    for (const r of [70, 104]) {
        w.geometry('glow', new THREE.TorusGeometry(r, 2.2, 4, 64), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(dx, 18.3, 0), { color: C(0xd98c2b), kind: 120, delay: 0.15 });
    }

    // The soul spire: a tall column on a pedestal with a capital and a bronze bowl of green soul fire.
    const px = X(880);
    const spire = [
        { r: 0, y: PILLAR_H + 6, kind: STONE.trim, color: TINT.trim },
        { r: 104, y: PILLAR_H + 6, kind: STONE.trim, color: TINT.trim },
        { r: 104, y: PILLAR_H - 16, ao: 0.7, kind: STONE.trim, color: TINT.trim },
        { r: 92, y: PILLAR_H - 24, kind: STONE.trim, color: TINT.trim, smooth: true },
        { r: 72, y: PILLAR_H - 60, ao: 0.7, kind: STONE.ashlar, smooth: true },
        { r: 74, y: H + 140, kind: STONE.ashlar },
        { r: 84, y: H + 120, kind: STONE.trim, color: TINT.trim, smooth: true },
        { r: 96, y: H + 100, kind: STONE.trim, color: TINT.trim },
        { r: 96, y: H + 40, kind: STONE.ashlar },
        { r: 112, y: H + 20, kind: STONE.trim, color: TINT.trim },
        { r: 112, y: Hw - 2, ao: 0.6 },
    ];
    w.ring('stone', spire, 0, Math.PI * 2, Math.max(16, segs >> 3), { ...stone, delay: 0.3 }, px, 0);
    for (const y of [H + 300, PILLAR_H - 140]) {
        w.ring('metal', [{ r: 76, y: y + 16 }, { r: 80, y: y + 12, smooth: true }, { r: 80, y: y - 12, smooth: true }, { r: 76, y: y - 16 }], 0, Math.PI * 2, 24, { color: C(TINT.bronze), delay: 0.3 }, px, 0);
        w.geometry('glow', new THREE.TorusGeometry(81, 2.4, 4, 48), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(px, y, 0), { color: C(TINT.glowGreen), kind: 255, delay: 0.3 });
    }
    const bowl = new THREE.LatheGeometry([
        new THREE.Vector2(0.1, 0), new THREE.Vector2(60, 0), new THREE.Vector2(60, 8), new THREE.Vector2(40, 16), new THREE.Vector2(36, 34),
        new THREE.Vector2(70, 50), new THREE.Vector2(96, 76), new THREE.Vector2(100, 88), new THREE.Vector2(90, 90), new THREE.Vector2(50, 80), new THREE.Vector2(0.1, 80),
    ], 24);
    w.geometry('metal', bowl, new THREE.Matrix4().makeTranslation(px, PILLAR_H + 6, 0), { color: C(TINT.bronze), delay: 0.3 });
    fires.push({ p: [px, PILLAR_H + 150, 0], size: 300, hue: 1, phase: side * 2 });
}

/** The outer façade: three storeys of arcades between engaged columns, cornices, and an attic. */
function facade(w, segs, quality) {
    const storeys = [[0, 190], [190, 380], [380, GALLERY_Y]];
    const r = OUTER_R;
    // Cornices and the attic as continuous rings, coming down the outside (solid on the right).
    const prof = [
        { r: OUTER_R - 26, y: ATTIC_TOP, kind: STONE.slab, color: TINT.tread },
        { r: r + 12, y: ATTIC_TOP, kind: STONE.trim, color: TINT.trim },
        { r: r + 12, y: ATTIC_TOP - 12, ao: 0.8, kind: STONE.trim, color: TINT.trim },
        { r: r + 4, y: ATTIC_TOP - 22, ao: 0.6, kind: STONE.ashlar, color: TINT.stone },
        { r: r + 4, y: GALLERY_Y + 8, kind: STONE.trim, color: TINT.trim },
        { r: r + 14, y: GALLERY_Y + 4, kind: STONE.trim, color: TINT.trim },
        { r: r + 14, y: GALLERY_Y - 8, ao: 0.6, kind: STONE.trim, color: TINT.trim },
        { r: r + 2, y: GALLERY_Y - 14, ao: 0.5, skip: true },
    ];
    for (const y of [380, 190]) {
        prof.push({ r: r + 2, y: y + 12, kind: STONE.trim, color: TINT.trim, ao: 0.6 }, { r: r + 13, y: y + 8, kind: STONE.trim, color: TINT.trim }, { r: r + 13, y: y - 4, ao: 0.7, kind: STONE.trim, color: TINT.trim }, { r: r + 2, y: y - 10, ao: 0.5, skip: true });
    }
    prof.push({ r: r + 2, y: 16, kind: STONE.rough, color: TINT.dark }, { r: r + 16, y: 8, kind: STONE.rough, color: TINT.dark }, { r: r + 16, y: -2 });
    for (const [a0, a1] of ARCS) w.ring('stone', prof, a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.stone), delay: 0.1 });

    // Arcade bays between the cornices: a slab with an arched opening, a glowing corridor behind, an engaged column.
    const rnd = random(77);
    const bayW = 118;
    const slabs = new Map(); // one extrusion per storey (every bay of a storey is the same shape)
    for (const [a0, a1] of ARCS) {
        const n = Math.round((a1 - a0) * r / bayW);
        const da = (a1 - a0) / n;
        for (let i = 0; i < n; i++) {
            const t = a0 + (i + 0.5) * da;
            const half = Math.sin(da / 2) * r;
            const rot = Math.PI / 2 - t; // local +z points outward
            const m = new THREE.Matrix4().makeRotationY(rot).setPosition(...pol(t, r * Math.cos(da / 2), 0));
            storeys.forEach(([y0, y1], s) => {
                const h0 = y0 + (s === 0 ? 16 : 12), h1 = y1 - 10;
                const aw = half * 0.58, spring = h0 + (h1 - h0) * 0.55;
                const key = `${half.toFixed(2)}|${s}`;
                if (!slabs.has(key)) {
                    const shape = new THREE.Shape();
                    shape.moveTo(-half, h0); shape.lineTo(half, h0); shape.lineTo(half, h1); shape.lineTo(-half, h1); shape.lineTo(-half, h0);
                    const hole = new THREE.Path();
                    hole.moveTo(-aw, h0); hole.lineTo(-aw, spring); hole.absarc(0, spring, aw, Math.PI, 0, true); hole.lineTo(aw, h0); hole.lineTo(-aw, h0);
                    shape.holes.push(hole);
                    slabs.set(key, new THREE.ExtrudeGeometry(shape, { depth: 22, bevelEnabled: false, curveSegments: quality === 'high' ? 8 : 5 }).translate(0, 0, -22));
                }
                w.geometry('stone', slabs.get(key), m, { color: C(TINT.stone), kind: STONE.ashlar, delay: 0.1 });
                // The corridor wall behind, lit warm in some bays.
                const lit = rnd() < 0.55 ? 0.35 + rnd() * 0.65 : 0.05;
                const back = new THREE.PlaneGeometry(aw * 2 + 4, spring + aw - h0 + 2).translate(0, (spring + aw + h0) / 2, -40);
                w.geometry('glow', back, m, { color: C(lit > 0.1 ? TINT.glowWarm : 0x24190f), kind: Math.round(lit * 90), delay: 0.1, bw: 1, bh: 1 });
                // Floor of the corridor.
                const floor = new THREE.PlaneGeometry(aw * 2, 20).rotateX(-Math.PI / 2).translate(0, h0, -31);
                w.geometry('stone', floor, m, { color: C(TINT.dark), kind: STONE.slab, ao: 0.5, delay: 0.1 });
                if (lit > 0.6 && s > 0) w.light(new THREE.Vector3(0, spring, -20).applyMatrix4(m).toArray(), 0.7, 80);
            });
            // Long banners on the attic, every few bays.
            if (i % 5 === 2) {
                const face = Math.atan2(Math.cos(t), Math.sin(t));
                const [bx, , bz] = pol(t, r + 7, 0);
                hangingBanner(w, bx, ATTIC_TOP - 26, bz, face, 64, 132, teamOf(t), i * 0.9);
                w.box('metal', bx, ATTIC_TOP - 25, bz, 74, 3, 3, face, { color: C(TINT.iron), delay: 0.1 });
            }
            // Engaged column at the pier between bays.
            const tc = a0 + i * da;
            if (i > 0) {
                for (const [y0, y1] of storeys) {
                    w.ring('stone', [
                        { r: 0, y: y1 - 8, kind: STONE.trim, color: TINT.trim },
                        { r: 13, y: y1 - 8, kind: STONE.trim, color: TINT.trim },
                        { r: 13, y: y1 - 16, ao: 0.7, kind: STONE.trim, color: TINT.trim },
                        { r: 9, y: y1 - 22, kind: STONE.trim, color: TINT.trim, smooth: true },
                        { r: 10, y: y0 + 18, kind: STONE.trim, color: TINT.trim, smooth: true },
                        { r: 14, y: y0 + 10, kind: STONE.trim, color: TINT.trim },
                        { r: 14, y: y0 + 4, ao: 0.6 },
                    ], tc - Math.PI / 2 - 0.2, tc + Math.PI / 2 + 0.2, 6, { color: C(TINT.trim), delay: 0.1 }, ...[Math.cos(tc) * (r + 4), Math.sin(tc) * (r + 4)]);
                }
            }
        }
    }
}

/** The gallery at the top of the stands: columns under a tiled lean-to roof, in front of the attic wall. */
function gallery(w, segs) {
    const y0 = GALLERY_Y, y1 = y0 + 120;
    for (const [a0, a1] of ARCS) {
        // Entablature beam on the columns and the tiled roof sloping up to the attic.
        w.ring('stone', [
            { r: GALLERY_R - 12, y: y1, kind: STONE.trim, color: TINT.trim, ao: 0.6 },
            { r: GALLERY_R - 12, y: y1 + 16, kind: STONE.trim, color: TINT.trim },
            { r: GALLERY_R - 16, y: y1 + 20, kind: STONE.trim, color: TINT.trim, skip: true },
        ], a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.trim), delay: 0.1 });
        w.ring('stone', [{ r: GALLERY_R + 12, y: y1 + 16 }, { r: GALLERY_R + 12, y: y1, kind: STONE.trim, color: TINT.trim, ao: 0.5 }, { r: GALLERY_R - 12, y: y1, ao: 0.5 }], a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.trim), delay: 0.1 });
        w.ring('roof', [{ r: GALLERY_R - 26, y: y1 + 18, ao: 0.8 }, { r: OUTER_R - 20, y: ATTIC_TOP - 4 }], a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.roof), kind: 0, delay: 0.1, bw: 14, bh: 18 });
        w.ring('stone', [{ r: GALLERY_R - 26, y: y1 + 12, ao: 0.4 }, { r: GALLERY_R - 26, y: y1 + 18 }], a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.trim), kind: STONE.trim, delay: 0.1 });
        // The attic's inner face behind the columns, with a warm glow in the doorways.
        w.ring('stone', [{ r: OUTER_R - 26, y: y0, ao: 0.4 }, { r: OUTER_R - 26, y: ATTIC_TOP - 4, ao: 0.5 }], a0 - deg(0.6), a1 + deg(0.6), segs, { color: C(TINT.plaster), kind: STONE.ashlar, delay: 0.1 });
        const n = Math.round((a1 - a0) * GALLERY_R / 86);
        for (let i = 0; i <= n; i++) {
            const t = a0 + (a1 - a0) * i / n;
            const [x, , z] = pol(t, GALLERY_R, 0);
            w.ring('stone', [
                { r: 0, y: y1, kind: STONE.trim },
                { r: 12, y: y1, kind: STONE.trim },
                { r: 12, y: y1 - 8, ao: 0.8, kind: STONE.trim },
                { r: 7.5, y: y1 - 14, kind: STONE.trim, smooth: true },
                { r: 8.5, y: y0 + 14, kind: STONE.trim, smooth: true },
                { r: 12, y: y0 + 8, kind: STONE.trim },
                { r: 12, y: y0, ao: 0.5 },
            ], 0, Math.PI * 2, 8, { color: C(TINT.trim), kind: STONE.trim, delay: 0.1 }, x, z);
            if (i < n && i % 3 === 1) {
                const tm = t + (a1 - a0) / n / 2;
                const door = 30 / (OUTER_R - 26);
                const q = [pol(tm - door, OUTER_R - 26.5, y0), pol(tm + door, OUTER_R - 26.5, y0), pol(tm + door, OUTER_R - 26.5, y0 + 80), pol(tm - door, OUTER_R - 26.5, y0 + 80)];
                w.quad('glow', q.reverse(), { color: C(TINT.glowWarm), kind: 70, delay: 0.1 }, [[0, 0], [1, 0], [1, 1], [0, 1]]);
                w.light(pol(tm, OUTER_R - 40, y0 + 50), 0.8, 90);
            }
        }
    }
}

/** Flag poles on the attic with fluttering pennants. */
function flags(w) {
    for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + 0.05;
        if (Math.abs(Math.cos(a)) > Math.cos(GAP * 1.8)) continue;
        const [x, , z] = pol(a, OUTER_R - 4, 0);
        w.ring('metal', [{ r: 0, y: ATTIC_TOP + 230 }, { r: 2.4, y: ATTIC_TOP + 226 }, { r: 3.2, y: ATTIC_TOP - 2 }], 0, Math.PI * 2, 6, { color: C(TINT.bronze), delay: 0.45 }, x, z);
        const s = w.slot('cloth');
        const color = [TINT.red, TINT.blue, TINT.gold][i % 3];
        const o = { color: C(color), cloth: true };
        const cols = 8, rows = 3, base = s.count, L = 120, H = 62;
        const dir = -a + Math.PI / 2; // along the tangent
        const tx = Math.cos(dir), tz = -Math.sin(dir);
        for (let j = 0; j <= rows; j++) {
            for (let k = 0; k <= cols; k++) {
                const f = k / cols;
                const hh = H * (1 - 0.45 * f); // tapering pennant
                const y = ATTIC_TOP + 222 - H / 2 + (j / rows - 0.5) * hh;
                w.vertex(s, [x + tx * f * L, y, z + tz * f * L], [-tz, 0, tx], f, j / rows, o, 1, [f, i * 1.7]);
            }
        }
        for (let j = 0; j < rows; j++) {
            for (let k = 0; k < cols; k++) {
                const p = base + j * (cols + 1) + k;
                s.index.push(p, p + 1, p + cols + 2, p, p + cols + 2, p + cols + 1);
            }
        }
    }
}

/** Beacon spires outside the stands at the diagonals: they light the sand like floodlights. */
function beacons(w, fires) {
    const heads = [];
    for (let i = 0; i < 4; i++) {
        const a = deg(45 + i * 90);
        const r = STANDS_OUT + 200;
        const [x, , z] = pol(a, r, 0);
        w.ring('stone', [
            { r: 0, y: 1150, kind: STONE.trim, color: TINT.trim },
            { r: 70, y: 1150, kind: STONE.trim, color: TINT.trim },
            { r: 70, y: 1132, ao: 0.6, kind: STONE.trim, color: TINT.trim },
            { r: 48, y: 1110, kind: STONE.ashlar, smooth: true },
            { r: 62, y: 300, kind: STONE.ashlar },
            { r: 84, y: 280, kind: STONE.trim, color: TINT.trim },
            { r: 84, y: 220, kind: STONE.ashlar },
            { r: 100, y: 200, kind: STONE.trim, color: TINT.trim },
            { r: 100, y: -2, ao: 0.5, kind: STONE.rough, color: TINT.dark },
        ], 0, Math.PI * 2, 4, { color: C(TINT.stone), delay: 0.35 }, x, z);
        // Lantern: a bronze cage around a blazing crystal, facing the arena.
        for (let k = 0; k < 8; k++) {
            const b = k / 8 * Math.PI * 2;
            w.box('metal', x + Math.cos(b) * 56, 1218, z + Math.sin(b) * 56, 6, 136, 6, Math.PI / 2 - b, { color: C(TINT.iron), delay: 0.35 });
        }
        w.ring('metal', [{ r: 0, y: 1330 }, { r: 74, y: 1288 }, { r: 66, y: 1282 }, { r: 66, y: 1280, ao: 0.5 }, { r: 0, y: 1280 }], 0, Math.PI * 2, 8, { color: C(TINT.bronze), delay: 0.35 }, x, z);
        w.ring('metal', [{ r: 0, y: 1156 }, { r: 70, y: 1156 }, { r: 74, y: 1148 }, { r: 66, y: 1140 }], 0, Math.PI * 2, 8, { color: C(TINT.bronze), delay: 0.35 }, x, z);
        heads.push(new THREE.Vector3(x, 1225, z));
        fires.push({ p: [x, 1225, z], size: 260, hue: 2, phase: i });
    }
    return heads;
}

/** The ground around the stadium: a paved apron, then trodden earth. */
function apron(w) {
    w.ring('stone', [{ r: OUTER_R + 16, y: -2.5 }, { r: OUTER_R + 260, y: -2.5, ao: 1 }], 0, Math.PI * 2, 96, { color: C(0x6d655a), kind: STONE.slab, delay: 0, bw: 70, bh: 70 });
}

/**
 * Compiles the stadium. `quality` sets the detail (segments around the rings). Returns the geometries per slot, the fires
 * (for the flame sprites), the torch positions on the gate towers, the screen poses and the beacon heads.
 */
export function buildStadium(quality) {
    const segs = { low: 72, medium: 112, high: 160 }[quality] ?? 160;
    const w = new Writer();
    const fires = [], torches = [], screens = [];
    stands(w, segs, fires);
    wallDressing(w, fires);
    for (const c of GATE_TOWERS) gateTower(w, c, Math.max(24, segs >> 2), fires, torches);
    gatehouse(w, -1, segs, fires, screens);
    gatehouse(w, 1, segs, fires, screens);
    facade(w, segs, quality);
    gallery(w, segs);
    flags(w);
    const beaconHeads = beacons(w, fires);
    apron(w);
    const geometries = w.build();
    return { geometries, fires, torches, screens, beaconHeads, lights: w.lights };
}
