// The crowd: low-poly people standing on the terraces, instanced in angular sectors. Each sector draws the detailed
// person (hats, hoods, helmets, long hair, pennants) when the camera is near and a simple one when it is far.
// Everything moves on the GPU: idle sway, hopping and raised arms with the crowd's excitement, the Mexican wave.
// Lighting is per vertex (the people are small on screen): moonlight, sky and the warm light of the nearest fires.
import * as THREE from '/lib/three/three.webgpu.js';
import { attribute, cos, exp, float, fract, max, mix, mod, normalGeometry, positionGeometry, select, sin, smoothstep, atan, vec3, varying } from '/lib/three/three.tsl.js';
import { ARCS, GATE_TOWERS, STANDS_IN, TIERS, TIER_DEPTH, TIER_RISE, WALKWAYS, WALL_H, GLOW_MAX, aisleAt, random } from './stadium.js';

// Parts of a person (vertex attribute `part`).
const P = { legs: 0, torso: 1, head: 2, armL: 3, armR: 4, hat: 5, hood: 6, helmet: 7, hair: 8, pennant: 9, flag: 10 };
const SHOULDER_X = 9.2, SHOULDER_Y = 33.5;
const SECTORS = 5; // per side
const NEAR = 2300; // camera distance (to a sector's centre, less its radius) below which the detailed person is drawn

/** A person, feet at the origin, facing +z. `detailed`: with accessories (parts shown per variant). */
function personGeometry(detailed) {
    const pos = [], nor = [], part = [];
    const face = (a, b, c, d, n, id) => {
        for (const v of [a, b, c, a, c, d]) { pos.push(...v); nor.push(...n); part.push(id); }
    };
    // A box from y0 to y1, w x d at the bottom, scaled by `taper` in x at the top; `skip`: faces to leave out.
    const box = (cx, y0, cz, w, h, d, id, taper = 1, skip = 'ny') => {
        const y1 = y0 + h, hw = w / 2, tw = hw * taper, hd = d / 2;
        const v = (x, y, z) => [cx + x, y, cz + z];
        const s = (tw - hw) / h; // side slope
        const nx = 1 / Math.hypot(1, s);
        if (!skip.includes('pz')) face(v(-hw, y0, hd), v(hw, y0, hd), v(tw, y1, hd), v(-tw, y1, hd), [0, 0, 1], id);
        if (!skip.includes('nz')) face(v(hw, y0, -hd), v(-hw, y0, -hd), v(-tw, y1, -hd), v(tw, y1, -hd), [0, 0, -1], id);
        if (!skip.includes('px')) face(v(hw, y0, hd), v(hw, y0, -hd), v(tw, y1, -hd), v(tw, y1, hd), [nx, -s * nx, 0], id);
        if (!skip.includes('nx')) face(v(-hw, y0, -hd), v(-hw, y0, hd), v(-tw, y1, hd), v(-tw, y1, -hd), [-nx, -s * nx, 0], id);
        if (!skip.includes('py')) face(v(-tw, y1, hd), v(tw, y1, hd), v(tw, y1, -hd), v(-tw, y1, -hd), [0, 1, 0], id);
        if (!skip.includes('ny')) face(v(-hw, y0, -hd), v(hw, y0, -hd), v(hw, y0, hd), v(-hw, y0, hd), [0, -1, 0], id);
    };
    const head = (cx, cy, cz, r, id, sx = 1, sy = 1, sz = 1) => {
        const g = detailed ? new THREE.IcosahedronGeometry(r, 0) : new THREE.OctahedronGeometry(r, 0);
        g.scale(sx, sy, sz).translate(cx, cy, cz);
        const gp = g.attributes.position, gn = g.attributes.normal;
        for (let i = 0; i < gp.count; i++) { pos.push(gp.getX(i), gp.getY(i), gp.getZ(i)); nor.push(gn.getX(i), gn.getY(i), gn.getZ(i)); part.push(id); }
    };
    box(-3.2, 0, 0, 5.4, 19.5, 6.4, P.legs, 1, 'nypy');
    box(3.2, 0, 0, 5.4, 19.5, 6.4, P.legs, 1, 'nypy');
    box(0, 19, 0, 12, 15, 7, P.torso, 1.3);
    head(0, 40.5, 0.3, 5.2, P.head, 0.92, 1.12, 1);
    box(-SHOULDER_X, 19, 0, 4.2, 15, 4.6, P.armL, 1, 'ny');
    box(SHOULDER_X, 19, 0, 4.2, 15, 4.6, P.armR, 1, 'ny');
    if (detailed) {
        box(0, 44.2, 0, 15, 1.4, 15, P.hat, 1, '');
        box(0, 45.5, 0, 8.5, 5, 8.5, P.hat, 0.85);
        box(0, 34.5, -1.2, 11.5, 12.5, 10.5, P.hood, 0.8);
        box(0, 18, -4.6, 15.5, 17, 2.2, P.hood, 1.05);
        box(0, 42, 0, 10.6, 5.5, 10.6, P.helmet, 0.8);
        box(0, 47, 0, 1.8, 4, 10, P.helmet, 1);
        box(0, 30, -3.6, 9.5, 13, 3, P.hair, 1.05);
        box(SHOULDER_X, 16, 2.6, 1.1, 34, 1.1, P.pennant, 1, '');
        box(SHOULDER_X + 6.5, 40, 2.6, 12, 9, 0.6, P.flag, 0.2, '');
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
    return g;
}

/**
 * The material: places each person on its seat (aSeat: x, y, z, facing), animates it, picks the colour of each part
 * and lights it per vertex. `light`: { moon (direction to it), moonColor, sky, ground } as THREE values.
 */
function crowdMaterial(u, light) {
    const m = new THREE.MeshBasicNodeMaterial();
    const seat = attribute('aSeat', 'vec4');
    const look = attribute('aLook', 'vec4'); // skin, hair, variant (+8 with a pennant), phase
    const shirt = attribute('aShirt', 'vec4'); // shirt colour (sRGB), warm light at the seat
    const part = attribute('part', 'float');
    const ph = look.w;
    const t = u.uTime;
    const is = id => part.equal(id);
    // Which accessories this person has.
    const variant = mod(look.z, 8.0);
    const pennant = look.z.greaterThanEqual(8.0);
    const shown = select(part.lessThan(4.5), float(1),
        select(is(P.hat), variant.equal(1).select(1, 0),
            select(is(P.hood), variant.equal(2).select(1, 0),
                select(is(P.helmet), variant.equal(3).select(1, 0),
                    select(is(P.hair), variant.equal(4).select(1, 0), pennant.select(1, 0))))));
    // Excitement: hopping and raised arms (most people join in), and the wave going round.
    const eager = fract(ph.mul(3.1)).greaterThan(0.25).select(1, 0);
    const speed = fract(ph.mul(13.7)).mul(3).add(3);
    const hop = sin(t.mul(speed).add(ph.mul(6.283))).max(0);
    const angle = atan(seat.z, seat.x);
    const d = mod(angle.sub(u.uWave).add(Math.PI), Math.PI * 2).sub(Math.PI);
    const wave = exp(d.mul(d).mul(-28)).mul(u.uWaveAmp);
    const cheer = u.uExcite.mul(1.5).sub(0.2).add(eager.sub(0.5).mul(0.4)).clamp(0, 1)
        .mul(sin(t.mul(speed).mul(0.5).add(ph.mul(20))).mul(0.25).add(0.75));
    const lift = hop.mul(hop).mul(u.uExcite.mul(14).mul(eager).add(0.6)).add(wave.mul(15));
    const raise = mix(float(0.14), float(2.7), max(cheer, wave)).add(sin(t.mul(1.1).add(ph.mul(40))).mul(0.06));
    // Arms (and the pennant in the right hand) swing out and up about the shoulder.
    const side = select(is(P.armL), float(-1), float(1));
    const arm = part.greaterThan(2.5).and(part.lessThan(4.5)).or(part.greaterThan(8.5));
    const a = select(arm, raise.mul(side), float(0));
    const ca = cos(a), sa = sin(a);
    const pivot = vec3(side.mul(SHOULDER_X), SHOULDER_Y, 0);
    const rel = positionGeometry.sub(pivot);
    const swung = vec3(rel.x.mul(ca).sub(rel.y.mul(sa)), rel.x.mul(sa).add(rel.y.mul(ca)), rel.z).add(pivot);
    const n0 = normalGeometry;
    const nArm = vec3(n0.x.mul(ca).sub(n0.y.mul(sa)), n0.x.mul(sa).add(n0.y.mul(ca)), n0.z);
    // The pennant's flag flutters.
    const flutter = select(is(P.flag), sin(t.mul(9).add(ph.mul(30)).add(positionGeometry.x.mul(0.5))).mul(positionGeometry.x.sub(SHOULDER_X).mul(0.25)), float(0));
    const local = select(shown.greaterThan(0.5), swung.add(vec3(0, 0, flutter)), vec3(0, 38, 0));
    // Seat: scale, turn to face the arena (plus a little looking around), lift.
    const scale = fract(ph.mul(7.7)).mul(0.22).add(0.9);
    const turn = seat.w.add(sin(t.mul(0.4).add(ph.mul(50))).mul(0.18));
    const c = cos(turn), s = sin(turn);
    const sway = sin(t.mul(1.3).add(ph.mul(20))).mul(1.2);
    const lx = local.x.mul(scale).add(sway), ly = local.y.mul(scale).add(lift), lz = local.z.mul(scale);
    const grow = u.uRise.clamp(0, 1).oneMinus().pow(3).oneMinus().max(0.001);
    const world = vec3(lx.mul(c).add(lz.mul(s)).add(seat.x), ly.add(seat.y).mul(grow), lx.negate().mul(s).add(lz.mul(c)).add(seat.z));
    m.positionNode = world;
    // Colours per part.
    const srgb = v => v.pow(vec3(2.2));
    const skin = mix(mix(vec3(0.98, 0.8, 0.62), vec3(0.78, 0.55, 0.36), look.x.mul(2).clamp(0, 1)), vec3(0.36, 0.22, 0.13), look.x.mul(2).sub(1).clamp(0, 1));
    const hair = mix(mix(vec3(0.08, 0.06, 0.05), vec3(0.4, 0.24, 0.12), look.y.mul(2).clamp(0, 1)), vec3(0.85, 0.66, 0.35), look.y.mul(2).sub(1).clamp(0, 1));
    const top = srgb(shirt.rgb);
    const pants = mix(vec3(0.16, 0.13, 0.11), vec3(0.32, 0.27, 0.21), fract(ph.mul(5.3)));
    const hat = mix(vec3(0.24, 0.17, 0.1), vec3(0.75, 0.62, 0.38), fract(ph.mul(9.1)));
    const team = select(seat.z.greaterThan(0), vec3(0.13, 0.33, 0.75), vec3(0.72, 0.13, 0.1));
    const albedo = select(is(P.legs), pants, select(is(P.torso), top, select(is(P.head), skin,
        select(part.lessThan(4.5), top, select(is(P.hat), hat, select(is(P.hood), top.mul(0.45),
            select(is(P.helmet), vec3(0.5, 0.52, 0.55), select(is(P.hair), hair, select(is(P.pennant), vec3(0.35, 0.24, 0.14), team)))))))));
    // Per-vertex light: moon, sky and ground bounce, warm fire light; darker low down between the rows.
    const n = vec3(nArm.x.mul(c).add(nArm.z.mul(s)), nArm.y, nArm.x.negate().mul(s).add(nArm.z.mul(c)));
    const moon = vec3(...light.moon.toArray()), moonColor = vec3(...light.moonColor.toArray());
    const sky = vec3(...light.sky.toArray()), ground = vec3(...light.ground.toArray());
    const lit = mix(ground, sky, n.y.mul(0.5).add(0.5)).add(moonColor.mul(n.dot(moon).max(0))).mul(1 / Math.PI) // as three.js's Lambert
        .add(vec3(1.0, 0.56, 0.24).mul(shirt.a.mul(GLOW_MAX).mul(u.uFlicker)).mul(n.y.mul(0.3).add(0.7)));
    const low = smoothstep(0, 30, positionGeometry.y).mul(0.45).add(0.55);
    m.colorNode = varying(albedo.mul(lit).mul(low));
    return m;
}

/** Warm light at a point from the baked light list (same falloff as the stadium's). */
function warmAt(lights, x, y, z) {
    let sum = 0;
    for (const l of lights) {
        const dx = l.p[0] - x, dy = l.p[1] - y, dz = l.p[2] - z;
        const d2 = dx * dx + dy * dy + dz * dz, r2 = l.r * l.r;
        if (d2 > 9 * r2) continue;
        sum += l.i * 0.6 / (1 + d2 / r2) * (1 - d2 / (9 * r2));
    }
    return Math.min(1, sum / GLOW_MAX);
}

export class Crowd {
    /** `quality` sets the density and whether near sectors get the detailed people. `lights`: the stadium's warm lights. */
    constructor(u, quality, light, lights) {
        this.group = new THREE.Group();
        this.group.name = 'crowd';
        const spacing = { low: 30, medium: 23, high: 18.5 }[quality] ?? 18.5;
        const rnd = random(11);
        const places = [];
        const shirts = [0xb03a2e, 0x2e6da4, 0xd4ac0d, 0x239b56, 0x7d3c98, 0xca6f1e, 0xd0d3d4, 0x2c3e50, 0xa04000, 0x117a65, 0x707b7c, 0xe6b0aa, 0x5d6d7e, 0x784212];
        for (let k = 0; k < TIERS; k++) {
            if (WALKWAYS.includes(k)) continue;
            const r0 = STANDS_IN + k * TIER_DEPTH + TIER_DEPTH * 0.42;
            const y = WALL_H + (k + 1) * TIER_RISE;
            for (const [a0, a1] of ARCS) {
                const n = Math.floor((a1 - a0) * r0 / spacing);
                for (let i = 0; i < n; i++) {
                    const t = a0 + (i + 0.5 + (rnd() - 0.5) * 0.3) * (a1 - a0) / n;
                    if (aisleAt(t, a0, a1) !== null || Math.abs(t - (aisleAt(t + 0.012, a0, a1) ?? aisleAt(t - 0.012, a0, a1) ?? 99)) < 0.03 || rnd() < 0.1) continue;
                    const r = r0 + (rnd() - 0.5) * 8;
                    const x = Math.cos(t) * r, z = Math.sin(t) * r;
                    if (GATE_TOWERS.some(g => Math.hypot(x - g.x, z - g.z) < 200)) continue;
                    places.push({ x, y, z, t, a0, a1 });
                }
            }
        }
        this.places = places;
        // Per-person attributes, grouped by sector.
        const sectors = [];
        for (const [a0, a1] of ARCS) for (let s = 0; s < SECTORS; s++) sectors.push({ a0: a0 + (a1 - a0) * s / SECTORS, a1: a0 + (a1 - a0) * (s + 1) / SECTORS, people: [] });
        const color = new THREE.Color();
        for (const p of places) {
            const sector = sectors.find(s => p.t >= s.a0 && p.t <= s.a1);
            const teamFan = rnd() < 0.38;
            color.set(teamFan ? (Math.sin(p.t) > 0 ? 0x2e64b0 : 0xb0302a) : shirts[Math.floor(rnd() * shirts.length)]);
            const v = rnd();
            const variant = v < 0.42 ? 0 : v < 0.58 ? 1 : v < 0.72 ? 2 : v < 0.8 ? 3 : 4;
            const facing = Math.atan2(-Math.cos(p.t), -Math.sin(p.t));
            sector.people.push({
                seat: [p.x, p.y, p.z, facing],
                look: [rnd(), rnd(), variant + (rnd() < 0.07 ? 8 : 0), rnd()],
                shirt: [...color.getRGB(new THREE.Color(), THREE.SRGBColorSpace).toArray(), warmAt(lights, p.x, p.y + 30, p.z)],
            });
        }
        const near = quality === 'low' ? null : personGeometry(true);
        const far = personGeometry(false);
        const material = crowdMaterial(u, light);
        this.sectors = [];
        for (const s of sectors) {
            if (!s.people.length) continue;
            const seat = new THREE.InstancedBufferAttribute(new Float32Array(s.people.flatMap(p => p.seat)), 4);
            const look = new THREE.InstancedBufferAttribute(new Float32Array(s.people.flatMap(p => p.look)), 4);
            const shirt = new THREE.InstancedBufferAttribute(new Uint8Array(s.people.flatMap(p => p.shirt.map(c => Math.round(THREE.MathUtils.clamp(c, 0, 1) * 255)))), 4, true);
            const center = new THREE.Vector3();
            for (const p of s.people) center.add(new THREE.Vector3(p.seat[0], p.seat[1], p.seat[2]));
            center.divideScalar(s.people.length);
            let radius = 0;
            for (const p of s.people) radius = Math.max(radius, center.distanceTo(new THREE.Vector3(p.seat[0], p.seat[1], p.seat[2])));
            const mesh = base => {
                const g = new THREE.InstancedBufferGeometry().copy(base);
                g.setAttribute('aSeat', seat);
                g.setAttribute('aLook', look);
                g.setAttribute('aShirt', shirt);
                g.instanceCount = s.people.length;
                g.boundingSphere = new THREE.Sphere(center.clone().setY(center.y + 25), radius + 60);
                const mm = new THREE.Mesh(g, material);
                this.group.add(mm);
                return mm;
            };
            const entry = { center, radius, far: mesh(far), near: near ? mesh(near) : null };
            if (entry.near) entry.near.visible = false;
            this.sectors.push(entry);
        }
    }

    /** Picks the detailed or the simple people per sector by the camera's distance. */
    update(camera) {
        for (const s of this.sectors) {
            if (!s.near) continue;
            const d = camera.position.distanceTo(s.center) - s.radius * 0.6;
            const near = d < (s.near.visible ? NEAR * 1.08 : NEAR);
            s.near.visible = near;
            s.far.visible = !near;
        }
    }
}
