// Renderer, cameras and the mapping between the classic 2D stage (1920x1080) and the 3D world.
//
// Views: "classic" looks at the arena picture from (almost) straight above, exactly like the classic client;
// "arena", "field" and "cinematic" go down into the 3D stadium. The player can also orbit and zoom freely.
// Hand cards and the End Turn sign live in a HUD scene that is drawn on top with its own camera, so they
// stay where the classic client has them whatever the world camera does.
//
// Rendering uses three.js's WebGPURenderer: WebGPU where the browser has it, its WebGL 2 backend otherwise (or with
// `?renderer=webgl`). The world (with bloom) and then the HUD are drawn into one linear HDR target, which is
// converted to the screen's colour space at the end.
import * as THREE from '/lib/three/three.webgpu.js';
import { pass, texture } from '/lib/three/three.tsl.js';
import { bloom } from '/lib/three/addons/tsl/display/BloomNode.js';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Classic stage point (x right, y down) to world space (x right, y up, z towards the player). */
export const toWorld = (x, y, height = 0) => new THREE.Vector3(x - STAGE_W / 2, height, y - STAGE_H / 2);

/** World point to the classic stage coordinates of the board point below it. */
export const toClassic = v => ({ x: v.x + STAGE_W / 2, y: v.z + STAGE_H / 2 });

const deg = THREE.MathUtils.degToRad;

/**
 * Point sprites: a unit quad drawn once per instance, for a PointsNodeMaterial whose positionNode reads the
 * per-instance position (WebGPU only draws one-pixel points). Meshes using it need frustumCulled = false.
 */
export function spriteGeometry(attributes, count) {
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
    geometry.instanceCount = count;
    return geometry;
}

export const VIEWS = {
    classic: { label: 'Classic', key: '1', stadium: false, cardTilt: 0 },
    arena: { label: 'Arena', key: '2', stadium: true, cardTilt: 0.35 },
    field: { label: 'Field', key: '3', stadium: true, cardTilt: 1.05, playerHero: 0.5 },
    cinematic: { label: 'Cinematic', key: '4', stadium: true, cardTilt: 0.8 },
    free: { label: 'Free', key: null, stadium: true, cardTilt: 0.6 },
};

const CLASSIC_FIT = [toWorld(0, 0), toWorld(STAGE_W, 0), toWorld(0, STAGE_H), toWorld(STAGE_W, STAGE_H)];
// Portrait: the classic view frames the board alone (both slot rows, both heroes), not the whole classic stage.
const PORTRAIT_CLASSIC_FIT = [toWorld(440, 0), toWorld(1480, 0), toWorld(440, STAGE_H), toWorld(1480, STAGE_H)];
// The board (both slot rows and both heroes on their podiums) for the angled view.
const BOARD_FIT = [
    new THREE.Vector3(-700, 0, -640), new THREE.Vector3(700, 0, -640),
    new THREE.Vector3(-640, 0, 700), new THREE.Vector3(640, 0, 700),
    new THREE.Vector3(0, 300, -585),
];
// Portrait: the narrow screen holds the slot rows edge to edge (cards 150 x 210 on them) and both heroes on their podiums.
const PORTRAIT_BOARD_FIT = [
    new THREE.Vector3(-545, 0, -230), new THREE.Vector3(545, 0, -230),
    new THREE.Vector3(-545, 0, 270), new THREE.Vector3(545, 0, 270),
    new THREE.Vector3(0, 0, -725), new THREE.Vector3(0, 300, -585),
    new THREE.Vector3(0, 0, 725), new THREE.Vector3(0, 270, 585),
];
// The part of the screen a view frames its subject in (normalized device y): all of it, except in portrait.
const FULL_SCREEN = { top: 1, bottom: -1 };

/**
 * Portrait (aspect below 1): the classic 16:9 layout would leave the board a thin strip, so the screen is split into
 * bands, top to bottom (CSS pixels): the camera and settings buttons (two rows, see game3d.css), the opponent's hand,
 * the board (every view frames it there), a row with the player's status, End Turn and the turn fuse, the player's
 * hand, and the battle log and chat. `card` is the width of a hand card.
 */
function portraitBands(width, height) {
    const card = Math.round(THREE.MathUtils.clamp(width * 0.24, 86, 150)); // the frame art is about 0.82 of it
    const buttons = 104;
    const footer = height - 56;
    const hand = footer - Math.round(card * 1.4) - 8;
    const action = hand - 78;
    return { card, opponentHand: [buttons, buttons + 48], board: [buttons + 48, action], action: [action, hand], hand: [hand, footer] };
}

const QUALITIES = ['low', 'medium', 'high'];
// The level the frame-rate watch stepped down to on this device; cleared by choosing "Auto" in the settings.
export const QUALITY_KEY = 'souls3d.quality';

/** The `?fx=low|medium|high` override, or null for automatic quality. */
function forcedQuality() {
    const forced = new URLSearchParams(window.location.search).get('fx');
    return QUALITIES.includes(forced) ? forced : null;
}

/** `?renderer=webgl` (or localStorage `souls3d.renderer` = "webgl") runs the WebGL 2 backend even where WebGPU works. */
function forcedWebGL() {
    if (new URLSearchParams(window.location.search).get('renderer') === 'webgl') return true;
    try { return localStorage.getItem('souls3d.renderer') === 'webgl'; } catch (e) { return false; }
}

/** The GPU behind the renderer's backend, as the browser names it ("nvidia ampere", "ANGLE (...)"). */
function gpuName(renderer) {
    const backend = renderer.backend;
    if (backend.isWebGPUBackend) {
        const info = backend.device.adapterInfo || {};
        return [info.vendor, info.architecture, info.description, info.isFallbackAdapter ? 'fallback' : ''].filter(Boolean).join(' ');
    }
    const gl = backend.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/**
 * Graphics quality: "low" for software rendering (no bloom, thinner crowd), "medium" for phones and tablets,
 * "high" otherwise, but no higher than the level this device was stepped down to before. `?fx=` overrides it.
 */
function detectQuality(gpu) {
    const forced = forcedQuality();
    if (forced) return forced;
    if (/swiftshader|llvmpipe|software|fallback/i.test(gpu)) return 'low';
    const detected = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
    let stored = null;
    try { stored = localStorage.getItem(QUALITY_KEY); } catch (e) { /* storage blocked */ }
    return QUALITIES.indexOf(stored) >= 0 && QUALITIES.indexOf(stored) < QUALITIES.indexOf(detected) ? stored : detected;
}

/** Device pixel ratio to render at for a quality level. */
function pixelRatio(quality) {
    return quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, quality === 'medium' ? 1.5 : 2);
}

export class Stage {
    constructor(container) {
        this.container = container;

        // Anti-aliasing comes from the multisampled targets below; the canvas only receives the finished frame.
        const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', forceWebGL: forcedWebGL() });
        this.autoQuality = !forcedQuality();
        this.frameWatch = null; // started by watchFrameRate() once the arena is loaded
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.domElement.className = 'souls3d-canvas';
        container.appendChild(renderer.domElement);
        this.renderer = renderer;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 10, 60000);

        // The classic top-down camera, fitted so the whole classic stage fills the view (also defines the HUD).
        this.classicCamera = new THREE.PerspectiveCamera(30, 16 / 9, 10, 60000);
        this.classicTilt = deg(8);

        // HUD: drawn after the world with a cleared depth buffer, by a camera sitting at the origin.
        this.hudScene = new THREE.Scene();
        this.hudCamera = new THREE.PerspectiveCamera(30, 16 / 9, 10, 60000);
        this.hud = new THREE.Group();
        this.hudScene.add(this.hud, new THREE.AmbientLight(0xffffff, 1.55));
        const hudSun = new THREE.DirectionalLight(0xfff3e0, 1.8);
        hudSun.position.set(-0.3, 0.6, 1);
        this.hudScene.add(hudSun);

        this.view = 'classic';
        this.free = { azimuth: 0, elevation: deg(50), distance: 2200, target: new THREE.Vector3(0, 40, 0) };
        this.transition = { from: null, start: 0, duration: 1 };
        this.menu = true; // cinematic orbit behind the menu
        this.kick = 0; // field-of-view punch on big hits

        this.raycaster = new THREE.Raycaster();
        this.listeners = new Set();
        this.viewListeners = new Set();
    }

    /**
     * Starts the GPU backend (WebGPU, or WebGL 2 where it is missing), picks the quality and sets up the frame:
     * world and HUD go into `target` (linear, half float, 4x MSAA), `output` converts it for the screen.
     */
    async init() {
        const renderer = this.renderer;
        await renderer.init();
        this.backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
        this.gpu = gpuName(renderer);
        console.info(`[Souls3D] ${this.backend} on ${this.gpu}`);
        this.quality = detectQuality(this.gpu);
        renderer.setPixelRatio(pixelRatio(this.quality));
        this.target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
        this.output = new THREE.RenderPipeline(renderer, texture(this.target.texture));
        // Bloom makes torches, rings, screens and effects glow. Subtle in the classic view to keep it 1:1.
        if (this.quality !== 'low') {
            this.world = pass(this.scene, this.camera, { samples: 4 });
            this.bloom = bloom(this.world, 0.45, 0.35, 0.88);
            this.pipeline = new THREE.RenderPipeline(renderer, this.world.add(this.bloom));
            this.pipeline.outputColorTransform = false; // the HUD still goes on top
        }
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    /** Registers a callback for when the layout changes (window resize). */
    onResize(fn) { this.listeners.add(fn); }

    /** Registers a callback for view changes. */
    onView(fn) { this.viewListeners.add(fn); }

    /** The view that is showing (the menu always uses the cinematic orbit). */
    get viewInfo() { return VIEWS[this.menu ? 'cinematic' : this.view]; }

    resize() {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        // Kept for toScreen/classicToScreen: reading clientWidth every frame, between the HUD's DOM writes, forces
        // the browser to lay out the page again each time.
        this.width = width;
        this.height = height;
        // Portrait: the bands of the screen, and the part of it (normalized device y) the views frame the board in.
        this.portrait = width < height;
        this.bands = this.portrait ? portraitBands(width, height) : null;
        this.frame = this.portrait ? { top: 1 - 2 * this.bands.board[0] / height, bottom: 1 - 2 * this.bands.board[1] / height } : FULL_SCREEN;
        this.renderer.setSize(width, height, false);
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.target.setSize(size.x, size.y);
        for (const cam of [this.camera, this.classicCamera, this.hudCamera]) {
            cam.aspect = width / height;
            cam.updateProjectionMatrix();
        }
        if (this.portrait) this.fit(this.classicCamera, PORTRAIT_CLASSIC_FIT, this.classicTilt, 0.97, this.frame);
        else this.fit(this.classicCamera, CLASSIC_FIT, this.classicTilt);
        for (const fn of this.listeners) fn();
    }

    /**
     * Fits `cam` (looking down at `tilt` from vertical, from the player's side or from `azimuth` around the arena) so
     * all `points` are in view, between the `frame.top` and `frame.bottom` of the screen (normalized device y).
     */
    fit(cam, points, tilt, margin = 0.985, frame = FULL_SCREEN, azimuth = 0) {
        cam.updateProjectionMatrix();
        const target = new THREE.Vector3(0, 0, 40);
        let distance = 2400;
        const v = new THREE.Vector3();
        for (let i = 0; i < 40; i++) {
            this.place(cam, target, distance, tilt, azimuth);
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of points) {
                v.copy(p).project(cam);
                minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            }
            const scale = Math.max((maxX - minX) / 2 / margin, (maxY - minY) / (frame.top - frame.bottom) / margin);
            distance *= scale;
            const halfHeight = distance * Math.tan(deg(cam.fov / 2)) / Math.max(0.2, Math.cos(tilt));
            const shift = ((maxY + minY) / 2 - (frame.top + frame.bottom) / 2) * halfHeight * 0.5;
            target.x -= shift * Math.sin(azimuth);
            target.z -= shift * Math.cos(azimuth);
        }
        this.place(cam, target, distance, tilt, azimuth);
        return { target, distance };
    }

    place(cam, target, distance, tilt, azimuth = 0) {
        const ground = distance * Math.sin(tilt);
        cam.position.set(target.x + ground * Math.sin(azimuth), target.y + distance * Math.cos(tilt), target.z + ground * Math.cos(azimuth));
        cam.lookAt(target);
        cam.updateMatrixWorld(true);
    }

    /** Screen point (CSS pixels) to the classic stage point the HUD shows there. */
    classicAtPixel(x, y) {
        return this.classicAtScreen(new THREE.Vector2(x / this.width * 2 - 1, 1 - y / this.height * 2));
    }

    /** CSS pixels per classic stage pixel on the HUD, across the stage at row `y`. */
    pixelsPerClassic(y) {
        return (this.classicToScreen(1060, y).x - this.classicToScreen(960, y).x) / 100;
    }

    /**
     * A world pose that looks like a 2D sprite drawn at classic screen point (x, y) in the classic view, floating
     * `lift` (0..1) of the way from the board towards the classic camera, facing it and keeping its apparent size.
     */
    anchor(x, y, lift, scale = 1) {
        const cam = this.classicCamera;
        const position = toWorld(x, y).lerp(cam.position, lift);
        return { position, quaternion: cam.quaternion.clone(), scale: (1 - lift) * scale };
    }

    /** The same as `anchor` but in HUD space (relative to the HUD camera at the origin). */
    hudPose(x, y, lift, scale = 1) {
        const cam = this.classicCamera;
        const position = toWorld(x, y).applyMatrix4(cam.matrixWorldInverse).multiplyScalar(1 - lift);
        return { position, quaternion: new THREE.Quaternion(), scale: (1 - lift) * scale };
    }

    /** Ratio that keeps HUD objects at the same screen position and size under the live camera's field of view. */
    fovRatio() {
        return Math.tan(deg(this.camera.fov / 2)) / Math.tan(deg(this.hudCamera.fov / 2));
    }

    /** Moves an object from the HUD into world group `root`, keeping where it appears on screen. */
    hudToWorld(object, root) {
        const k = this.fovRatio();
        const p = object.position.clone();
        p.x *= k; p.y *= k;
        root.add(object);
        object.position.copy(p.applyMatrix4(this.camera.matrixWorld));
        object.quaternion.premultiply(this.camera.quaternion);
        object.scale.multiplyScalar(k);
    }

    /** Moves an object from the world into the HUD, keeping where it appears on screen. */
    worldToHud(object) {
        const k = this.fovRatio();
        const p = object.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorldInverse);
        p.x /= k; p.y /= k;
        this.hud.add(object);
        object.position.copy(p);
        object.quaternion.premultiply(this.camera.quaternion.clone().invert());
        object.scale.multiplyScalar(1 / k);
    }

    /** Pointer event to normalized device coordinates. */
    ndc(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        return new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1);
    }

    /** Intersection of the pointer ray (live camera) with the horizontal plane at `height`. */
    pointerOnPlane(ndc, height = 0) {
        this.raycaster.setFromCamera(ndc, this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
        const hit = new THREE.Vector3();
        return this.raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    }

    /** The classic stage point that the HUD shows at this screen position (HUD hit-testing). */
    classicAtScreen(ndc) {
        this.raycaster.setFromCamera(ndc, this.classicCamera);
        const hit = new THREE.Vector3();
        return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? toClassic(hit) : null;
    }

    /** Raycasts HUD objects. */
    pickHud(ndc, objects) {
        this.raycaster.setFromCamera(ndc, this.hudCamera);
        return this.raycaster.intersectObjects(objects, true);
    }

    /** World point to CSS pixels inside the container (live camera). */
    toScreen(world) {
        const v = world.clone().project(this.camera);
        return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
    }

    /** Classic stage point to CSS pixels, as laid out by the HUD. */
    classicToScreen(x, y) {
        const v = toWorld(x, y).project(this.classicCamera);
        return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
    }

    // ---- Views ----------------------------------------------------------------------------------------------------

    setView(name) {
        if (!VIEWS[name] || name === 'free' || (name === this.view && !this.menu)) return;
        this.beginTransition();
        this.view = name;
        for (const fn of this.viewListeners) fn(name);
    }

    leaveMenu() {
        if (!this.menu) return;
        this.beginTransition(2600);
        this.menu = false;
        for (const fn of this.viewListeners) fn(this.view);
    }

    beginTransition(duration = 1700) {
        this.transition = {
            from: { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), fov: this.camera.fov },
            start: performance.now(),
            duration,
        };
    }

    /** Starts free orbiting from wherever the camera is now (called on the first drag / wheel). */
    enterFree() {
        if (this.view === 'free' || this.menu) return;
        const target = this.pointerOnPlane(new THREE.Vector2(0, 0), 0) || new THREE.Vector3();
        target.clampLength(0, 600).setY(40);
        const offset = this.camera.position.clone().sub(target);
        const distance = offset.length();
        this.free = {
            target,
            distance,
            azimuth: Math.atan2(offset.x, offset.z),
            elevation: Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1)),
            fov: this.camera.fov,
        };
        this.view = 'free';
        this.transition = { from: null, start: 0, duration: 1 };
        for (const fn of this.viewListeners) fn('free');
    }

    orbitBy(dx, dy) {
        this.enterFree();
        if (this.view !== 'free') return;
        const f = this.free;
        f.azimuth -= dx * 0.005;
        f.elevation = THREE.MathUtils.clamp(f.elevation + dy * 0.004, deg(6), deg(89));
    }

    zoomBy(factor) {
        this.enterFree();
        if (this.view !== 'free') return;
        // Portrait views stand further back (the narrow screen), so free zooming goes further out there.
        this.free.distance = THREE.MathUtils.clamp(this.free.distance * factor, 450, this.portrait ? 8000 : 5200);
    }

    /** The camera the current view wants at time `now`. */
    viewPose(now) {
        const cam = this._viewCam || (this._viewCam = new THREE.PerspectiveCamera(30, 1, 10, 60000));
        cam.aspect = this.camera.aspect;
        const name = this.menu ? 'cinematic' : this.view;
        // Portrait: each view frames the board (just the slot rows and the heroes) in its band of the screen.
        const portrait = this.portrait && !this.menu;
        if (name === 'classic') {
            cam.copy(this.classicCamera);
        } else if (name === 'arena') {
            cam.fov = 44;
            this.fit(cam, portrait ? PORTRAIT_BOARD_FIT : BOARD_FIT, deg(portrait ? 40 : 48), 0.97, this.frame);
        } else if (portrait && name === 'field') {
            // Not down at the front row: the narrow screen needs the camera so far back that it would be in the stands.
            cam.fov = 60;
            this.fit(cam, PORTRAIT_BOARD_FIT, deg(56), 0.97, this.frame);
        } else if (portrait && name === 'cinematic') {
            // A slow sway above the player's end instead of the orbit: from this far back, the pillars beside the arena
            // would pass in front of the board.
            cam.fov = 50;
            this.fit(cam, PORTRAIT_BOARD_FIT, deg(40 + Math.sin(now * 0.00011) * 4), 0.97, this.frame, Math.sin(now * 0.00009) * 0.7);
        } else if (name === 'field') {
            // Down at the front row behind your hero, looking across the sand at the opponent.
            cam.fov = 55;
            const back = Math.max(1, 1.7 / cam.aspect);
            cam.position.set(0, 430 * back, 930 * back);
            cam.lookAt(0, 0, -150);
        } else if (name === 'cinematic') {
            // A slow orbit above the terraces (higher and wider behind the menu).
            cam.fov = 44;
            const a = now * 0.00005 + 0.6;
            const radius = this.menu ? 1900 : 1500, height = this.menu ? 1500 : 1080;
            cam.position.set(Math.sin(a) * radius, height + Math.sin(now * 0.00011) * 90, Math.cos(a) * radius);
            cam.lookAt(0, this.menu ? 0 : 60, 0);
        } else {
            const f = this.free;
            cam.fov = f.fov || 40;
            cam.position.set(
                f.target.x + Math.sin(f.azimuth) * Math.cos(f.elevation) * f.distance,
                f.target.y + Math.sin(f.elevation) * f.distance,
                f.target.z + Math.cos(f.azimuth) * Math.cos(f.elevation) * f.distance);
            cam.lookAt(f.target);
        }
        cam.updateMatrixWorld(true);
        return cam;
    }

    /** A quick zoom-in punch of the camera (degrees of field of view), for big hits. */
    punch(amount = 4) {
        this.kick = Math.max(this.kick, amount);
    }

    updateCamera(now) {
        const elapsed = Math.min(100, now - (this.lastCameraUpdate ?? now));
        this.lastCameraUpdate = now;
        this.kick *= Math.exp(-elapsed / 220);
        const want = this.viewPose(now);
        const t = this.transition;
        const cam = this.camera;
        let fov = want.fov;
        if (t.from && now - t.start < t.duration) {
            const p = (now - t.start) / t.duration;
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            // Swoop: rise a little in the middle of the move so the camera does not cut through the stands.
            cam.position.lerpVectors(t.from.position, want.position, e);
            cam.position.y += Math.sin(Math.PI * e) * 250;
            cam.quaternion.slerpQuaternions(t.from.quaternion, want.quaternion, e);
            fov = t.from.fov + (want.fov - t.from.fov) * e;
        } else {
            t.from = null;
            cam.position.copy(want.position);
            cam.quaternion.copy(want.quaternion);
        }
        fov -= this.kick;
        if (this.bloom) {
            const strength = this.viewInfo.stadium ? 0.45 : 0.1;
            this.bloom.strength.value += (strength - this.bloom.strength.value) * Math.min(1, elapsed / 400);
        }
        if (cam.fov !== fov) {
            cam.fov = fov;
            cam.updateProjectionMatrix();
        }
        cam.updateMatrixWorld(true);
    }

    /**
     * Steps the quality down (high, medium, low) while frames stay below 45 per second over five seconds, with
     * automatic quality only. The new level takes effect at once (pixel ratio, bloom) and is remembered for the next
     * visit, which also builds a lighter stadium.
     */
    watchFrameRate() {
        if (this.autoQuality) this.frameWatch = { start: performance.now(), frames: 0 };
    }

    checkFrameRate(now) {
        const w = this.frameWatch;
        if (!w || this.quality === 'low') return;
        // A long gap means the tab was hidden or the page was busy loading: start a new window.
        if (now - (w.last ?? now) > 1000) { w.start = now; w.frames = 0; }
        w.last = now;
        w.frames++;
        if (now - w.start < 5000) return;
        const fps = w.frames * 1000 / (now - w.start);
        w.start = now;
        w.frames = 0;
        if (fps >= 45) return;
        this.quality = QUALITIES[QUALITIES.indexOf(this.quality) - 1];
        try { localStorage.setItem(QUALITY_KEY, this.quality); } catch (e) { /* storage blocked */ }
        this.renderer.setPixelRatio(pixelRatio(this.quality));
        if (this.quality === 'low' && this.pipeline) {
            for (const part of [this.pipeline, this.bloom, this.world]) part.dispose();
            this.pipeline = this.bloom = this.world = null;
        }
        this.resize();
    }

    render(now = performance.now()) {
        this.checkFrameRate(now);
        const r = this.renderer;
        r.setRenderTarget(this.target);
        if (this.pipeline) this.pipeline.render();
        else r.render(this.scene, this.camera);
        r.autoClearColor = false; // the HUD goes over the world
        r.render(this.hudScene, this.hudCamera);
        r.autoClearColor = true;
        r.setRenderTarget(null);
        this.output.render();
    }
}
