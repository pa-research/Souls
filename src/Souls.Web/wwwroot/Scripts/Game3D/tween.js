// Minimal tween engine: animates numeric properties of any object (Vector3, Euler, materials, plain objects).

export const Ease = {
    linear: t => t,
    quadIn: t => t * t,
    quadOut: t => t * (2 - t),
    quadInOut: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    cubicOut: t => 1 - Math.pow(1 - t, 3),
    sineInOut: t => -(Math.cos(Math.PI * t) - 1) / 2,
    backOut: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elasticOut: t => {
        if (t === 0 || t === 1) return t;
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    },
};

export class Tweens {
    constructor() {
        this.active = [];
        this.now = 0;
    }

    /**
     * Animates `props` of `target` to the given values.
     * Returns a promise that resolves when done (or when cancelled by another tween on the same target + key).
     */
    to(target, props, duration, ease = Ease.cubicOut, delay = 0) {
        return new Promise(resolve => {
            const keys = Object.keys(props);
            // A new tween on a property replaces running tweens on that property.
            for (const t of this.active) {
                if (t.target === target) {
                    t.keys = t.keys.filter(k => !keys.includes(k));
                    if (t.keys.length === 0) { t.done = true; t.resolve(); }
                }
            }
            this.active.push({
                target, keys, to: props, from: null, start: this.now + delay, duration: Math.max(1, duration), ease, resolve, done: false,
            });
        });
    }

    /**
     * Calls `fn(easedProgress)` every frame for `duration` ms. The returned promise has a `cancel()`;
     * a cancelled run stops calling `fn` and resolves immediately.
     */
    run(duration, fn, ease = Ease.cubicOut, delay = 0) {
        const state = { p: 0, cancelled: false };
        const proxy = {
            get t() { return state.p; },
            set t(v) { state.p = v; if (!state.cancelled) fn(v); },
        };
        const promise = this.to(proxy, { t: 1 }, duration, ease, delay);
        promise.cancel = () => {
            state.cancelled = true;
            for (const t of this.active) {
                if (t.target === proxy && !t.done) { t.done = true; t.resolve(); }
            }
        };
        return promise;
    }

    wait(ms) {
        return this.to({ v: 0 }, { v: 1 }, ms, Ease.linear);
    }

    update(now) {
        this.now = now;
        // Iterate over a snapshot: callbacks may start new tweens.
        for (const t of [...this.active]) {
            if (t.done || now < t.start) continue;
            if (!t.from) {
                t.from = {};
                for (const k of t.keys) t.from[k] = t.target[k];
            }
            const p = Math.min(1, (now - t.start) / t.duration);
            const e = t.ease(p);
            for (const k of t.keys) t.target[k] = t.from[k] + (t.to[k] - t.from[k]) * e;
            if (p >= 1) { t.done = true; t.resolve(); }
        }
        this.active = this.active.filter(t => !t.done);
    }
}

export const tweens = new Tweens();
