// Renderer, cameras and the mapping between the classic 2D stage (1920x1080) and the 3D world.
//
// Views: "classic" looks at the arena picture from (almost) straight above, exactly like the classic client;
// "arena", "field" and "cinematic" go down into the 3D stadium. The player can also orbit and zoom freely.
// Hand cards and the End Turn sign live in a HUD scene that is drawn on top with its own camera, so they
// stay where the classic client has them whatever the world camera does.
import * as THREE from '/lib/three/three.module.js';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Classic stage point (x right, y down) to world space (x right, y up, z towards the player). */
export const toWorld = (x, y, height = 0) => new THREE.Vector3(x - STAGE_W / 2, height, y - STAGE_H / 2);

/** World point to the classic stage coordinates of the board point below it. */
export const toClassic = v => ({ x: v.x + STAGE_W / 2, y: v.z + STAGE_H / 2 });

const deg = THREE.MathUtils.degToRad;

export const VIEWS = {
    classic: { label: 'Classic', key: '1', stadium: false, cardTilt: 0 },
    arena: { label: 'Arena', key: '2', stadium: true, cardTilt: 0.35 },
    field: { label: 'Field', key: '3', stadium: true, cardTilt: 1.05, playerHero: 0.5 },
    cinematic: { label: 'Cinematic', key: '4', stadium: true, cardTilt: 0.8 },
    free: { label: 'Free', key: null, stadium: true, cardTilt: 0.6 },
};

const CLASSIC_FIT = [toWorld(0, 0), toWorld(STAGE_W, 0), toWorld(0, STAGE_H), toWorld(STAGE_W, STAGE_H)];
// The board (both slot rows and both heroes on their podiums) for the angled view.
const BOARD_FIT = [
    new THREE.Vector3(-700, 0, -640), new THREE.Vector3(700, 0, -640),
    new THREE.Vector3(-640, 0, 700), new THREE.Vector3(640, 0, 700),
    new THREE.Vector3(0, 300, -585),
];

function detectLowPower(renderer) {
    try {
        const gl = renderer.getContext();
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        return /swiftshader|llvmpipe|software/i.test(name);
    } catch (e) {
        return false;
    }
}

export class Stage {
    constructor(container) {
        this.container = container;

        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.lowPower = detectLowPower(renderer);
        renderer.setPixelRatio(this.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.autoClear = false;
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

        this.raycaster = new THREE.Raycaster();
        this.listeners = new Set();
        this.viewListeners = new Set();
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
        this.renderer.setSize(width, height, false);
        for (const cam of [this.camera, this.classicCamera, this.hudCamera]) {
            cam.aspect = width / height;
            cam.updateProjectionMatrix();
        }
        this.fit(this.classicCamera, CLASSIC_FIT, this.classicTilt);
        for (const fn of this.listeners) fn();
    }

    /** Fits `cam` (looking down at `tilt` from vertical, from the player's side) so all `points` are in view. */
    fit(cam, points, tilt, margin = 0.985) {
        cam.updateProjectionMatrix();
        const target = new THREE.Vector3(0, 0, 40);
        let distance = 2400;
        const v = new THREE.Vector3();
        for (let i = 0; i < 40; i++) {
            this.place(cam, target, distance, tilt);
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of points) {
                v.copy(p).project(cam);
                minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            }
            const scale = Math.max((maxX - minX) / 2 / margin, (maxY - minY) / 2 / margin);
            distance *= scale;
            const halfHeight = distance * Math.tan(deg(cam.fov / 2)) / Math.max(0.2, Math.cos(tilt));
            target.z -= ((maxY + minY) / 2) * halfHeight * 0.5;
        }
        this.place(cam, target, distance, tilt);
        return { target, distance };
    }

    place(cam, target, distance, tilt) {
        cam.position.set(target.x, target.y + distance * Math.cos(tilt), target.z + distance * Math.sin(tilt));
        cam.lookAt(target);
        cam.updateMatrixWorld(true);
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
        return { x: (v.x + 1) / 2 * this.container.clientWidth, y: (1 - v.y) / 2 * this.container.clientHeight };
    }

    /** Classic stage point to CSS pixels, as laid out by the HUD. */
    classicToScreen(x, y) {
        const v = toWorld(x, y).project(this.classicCamera);
        return { x: (v.x + 1) / 2 * this.container.clientWidth, y: (1 - v.y) / 2 * this.container.clientHeight };
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
        this.free.distance = THREE.MathUtils.clamp(this.free.distance * factor, 450, 5200);
    }

    /** The camera the current view wants at time `now`. */
    viewPose(now) {
        const cam = this._viewCam || (this._viewCam = new THREE.PerspectiveCamera(30, 1, 10, 60000));
        cam.aspect = this.camera.aspect;
        const name = this.menu ? 'cinematic' : this.view;
        if (name === 'classic') {
            cam.copy(this.classicCamera);
        } else if (name === 'arena') {
            cam.fov = 44;
            this.fit(cam, BOARD_FIT, deg(48), 0.97);
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

    updateCamera(now) {
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
        if (cam.fov !== fov) {
            cam.fov = fov;
            cam.updateProjectionMatrix();
        }
        cam.updateMatrixWorld(true);
    }

    render() {
        const r = this.renderer;
        r.clear();
        r.render(this.scene, this.camera);
        r.clearDepth();
        r.render(this.hudScene, this.hudCamera);
    }
}
