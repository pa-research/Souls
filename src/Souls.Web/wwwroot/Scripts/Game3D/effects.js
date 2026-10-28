// Visual effects: particles, floating numbers, the targeting arrow, hero beams and camera shake.
import * as THREE from '/lib/three/three.module.js';
import { Images, loadImage, textureFrom } from './assets.js';
import { tweens, Ease } from './tween.js';

const MAX_PARTICLES = 3000;

export class Effects {
    constructor(stage) {
        this.stage = stage;
        this.scene = stage.scene;
        this.shakeAmount = 0;
        this.particles = [];
        this.initParticles();
        this.initArrow();
    }

    async initParticles() {
        const geometry = new THREE.BufferGeometry();
        this.pPositions = new Float32Array(MAX_PARTICLES * 3);
        this.pColors = new Float32Array(MAX_PARTICLES * 4);
        this.pSizes = new Float32Array(MAX_PARTICLES);
        geometry.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('pcolor', new THREE.BufferAttribute(this.pColors, 4).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('size', new THREE.BufferAttribute(this.pSizes, 1).setUsage(THREE.DynamicDrawUsage));
        this.pMaterial = new THREE.ShaderMaterial({
            uniforms: { map: { value: null }, scale: { value: 800 } },
            vertexShader: `attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float scale;
                void main() {
                    vColor = pcolor;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * scale / -mv.z;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `uniform sampler2D map; varying vec4 vColor;
                void main() {
                    vec4 t = texture2D(map, gl_PointCoord);
                    gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a);
                    if (gl_FragColor.a < 0.01) discard;
                }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.points = new THREE.Points(geometry, this.pMaterial);
        this.points.frustumCulled = false;
        this.points.renderOrder = 10;
        this.scene.add(this.points);
        const image = await loadImage(Images.particle);
        if (image) this.pMaterial.uniforms.map.value = textureFrom(image);
    }

    /** Emits a burst of particles. */
    burst(position, { color = 0xffffff, count = 40, speed = 260, size = 40, life = 900, gravity = -200, spread = 1, up = 0.6 } = {}) {
        const c = new THREE.Color(color);
        for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
            const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * up + (1 - up) * (Math.random() * 2 - 1), Math.random() * 2 - 1)
                .normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7) * spread);
            this.particles.push({
                p: position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, Math.random() * 10, (Math.random() - 0.5) * 30)),
                v: dir, age: 0, life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8), color: c, gravity,
            });
        }
    }

    /** Particles rising around a point (heal / buff). */
    sparkle(position, color = 0x7dff7a, count = 30) {
        this.burst(position, { color, count, speed: 90, size: 34, life: 1300, gravity: 160, up: 1 });
    }

    updateParticles(dt) {
        if (!this.points) return;
        const s = dt / 1000;
        this.particles = this.particles.filter(p => (p.age += dt) < p.life);
        const n = this.particles.length;
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            p.v.y += p.gravity * s;
            p.p.addScaledVector(p.v, s);
            const k = 1 - p.age / p.life;
            this.pPositions.set([p.p.x, p.p.y, p.p.z], i * 3);
            this.pColors.set([p.color.r, p.color.g, p.color.b, k], i * 4);
            this.pSizes[i] = p.size * (0.5 + 0.5 * k);
        }
        const geometry = this.points.geometry;
        geometry.setDrawRange(0, n);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.pcolor.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;
        this.pMaterial.uniforms.scale.value = this.stage.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.stage.camera.fov / 2)));
    }

    /** A number that floats up and fades out ("-3", "+2"). */
    floatText(text, position, color = '#ff4136', size = 90) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const g = canvas.getContext('2d');
        g.font = 'bold 96px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 12;
        g.strokeStyle = '#000';
        g.strokeText(text, 128, 64);
        g.fillStyle = color;
        g.fillText(text, 128, 64);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.scale.set(size * 2, size, 1);
        sprite.position.copy(position);
        sprite.renderOrder = 20;
        this.scene.add(sprite);
        const start = position.clone();
        tweens.run(1400, t => {
            sprite.position.y = start.y + 60 + t * 110;
            sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
            const pop = t < 0.15 ? 0.6 + t / 0.15 * 0.6 : 1.2 - Math.min(0.2, (t - 0.15));
            sprite.scale.set(size * 2 * pop, size * pop, 1);
        }, Ease.linear).then(() => {
            sprite.removeFromParent();
            texture.dispose();
            sprite.material.dispose();
        });
    }

    shake(amount = 12) {
        this.shakeAmount = Math.max(this.shakeAmount, amount);
    }

    applyShake(camera) {
        if (this.shakeAmount < 0.1) return;
        camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
        camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
        camera.position.z += (Math.random() - 0.5) * this.shakeAmount;
        this.shakeAmount *= 0.88;
    }

    // ---- Targeting arrow ----------------------------------------------------------------------------------------

    async initArrow() {
        this.arrow = new THREE.Group();
        this.arrow.visible = false;
        this.arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.85, depthTest: false });
        this.arrowTube = new THREE.Mesh(new THREE.BufferGeometry(), this.arrowMaterial);
        this.arrowHead = new THREE.Mesh(new THREE.ConeGeometry(26, 56, 16), this.arrowMaterial);
        this.arrowTube.renderOrder = this.arrowHead.renderOrder = 30;
        this.reticleMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, color: 0xff3b30 });
        this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.reticleMaterial);
        this.reticle.renderOrder = 31;
        this.arrow.add(this.arrowTube, this.arrowHead, this.reticle);
        this.scene.add(this.arrow);
        const image = await loadImage(Images.target);
        if (image) { this.reticleMaterial.map = textureFrom(image); this.reticleMaterial.needsUpdate = true; }
    }

    /** Shows the arrow from `from` to `to` (world points). `color` red for attacks, green for abilities. */
    showArrow(from, to, color, locked) {
        if (!this.arrow) return;
        this.arrow.visible = true;
        this.arrowMaterial.color.set(color);
        this.reticleMaterial.color.set(locked ? color : 0xffffff);
        const a = from.clone(); a.y = Math.max(a.y, 30);
        const b = to.clone(); b.y = Math.max(b.y, 30);
        // Bend the arrow sideways as well as up: the camera looks down, so a purely vertical arc would look straight.
        const mid = a.clone().lerp(b, 0.5);
        const d = a.distanceTo(b);
        const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
        mid.addScaledVector(side, d * 0.18);
        mid.y += Math.min(220, d * 0.15) + 30;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        this.arrowTube.geometry.dispose();
        this.arrowTube.geometry = new THREE.TubeGeometry(curve, 40, 9, 8, false);
        const tangent = curve.getTangent(1);
        this.arrowHead.position.copy(b).addScaledVector(tangent, 10);
        this.arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        this.reticle.position.copy(to).setY(to.y + 6);
        this.reticle.quaternion.copy(this.stage.camera.quaternion);
        this.reticle.scale.setScalar(locked ? 1.15 : 0.8);
    }

    hideArrow() {
        if (this.arrow) this.arrow.visible = false;
    }

    // ---- Hero beam ------------------------------------------------------------------------------------------------

    /** An energy beam from one point to another (classic hero attack). Resolves when it has hit. */
    beam(from, to, color = 0xffd34d, duration = 1600) {
        const dir = to.clone().sub(from);
        const length = dir.length();
        const material = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 }, color: { value: new THREE.Color(color) }, fade: { value: 0 } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `uniform float time; uniform vec3 color; uniform float fade; varying vec2 vUv;
                void main() {
                    float stripes = 0.6 + 0.4 * sin(vUv.y * 60.0 - time * 30.0);
                    float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
                    gl_FragColor = vec4(color * (0.7 + core) * stripes, fade * (0.4 + 0.6 * core));
                }`,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 16, 1, true), material);
        mesh.renderOrder = 15;
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        this.scene.add(mesh);
        const set = grow => {
            mesh.scale.set(1, Math.max(1, length * grow), 1);
            mesh.position.copy(from).addScaledVector(dir, grow / 2);
        };
        set(0);
        return tweens.run(duration, t => {
            material.uniforms.time.value = t * duration / 1000;
            const grow = Math.min(1, t / 0.3);
            set(grow);
            material.uniforms.fade.value = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
            if (grow >= 1 && Math.random() < 0.5) this.burst(to, { color, count: 3, speed: 200, size: 30, life: 500 });
        }, Ease.linear).then(() => {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
        });
    }

    update(dt) {
        this.updateParticles(dt);
        if (this.arrow && this.arrow.visible) this.reticle.rotateZ(dt * 0.002);
    }
}
