// Crowd ambience, synthesized with Web Audio (no sound files): a constant murmur that gets louder in the
// stadium views, and cheers that swell up on hits, kills and the end of the game. Follows the sound toggle.
import { sound } from './assets.js';

function noiseBuffer(ctx, seconds) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
        // Brown-ish noise: a murmur rather than a hiss.
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
    }
    return buffer;
}

export class CrowdAudio {
    constructor() {
        this.ctx = null;
        this.presence = 0; // 0 in the classic view, 1 down in the stadium
    }

    /** Starts the audio graph; must be called from a user gesture (browsers block audio before that). */
    start() {
        if (this.ctx) return;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        const ctx = new Context();
        this.ctx = ctx;
        const buffer = noiseBuffer(ctx, 4);
        this.buffer = buffer;
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0;
        this.sfx.connect(ctx.destination);

        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);

        const murmur = ctx.createBufferSource();
        murmur.buffer = buffer;
        murmur.loop = true;
        const murmurFilter = ctx.createBiquadFilter();
        murmurFilter.type = 'bandpass';
        murmurFilter.frequency.value = 520;
        murmurFilter.Q.value = 0.6;
        this.murmur = ctx.createGain();
        this.murmur.gain.value = 0.5;
        murmur.connect(murmurFilter).connect(this.murmur).connect(this.master);
        murmur.start();

        const roar = ctx.createBufferSource();
        roar.buffer = buffer;
        roar.loop = true;
        roar.playbackRate.value = 1.7;
        const roarFilter = ctx.createBiquadFilter();
        roarFilter.type = 'bandpass';
        roarFilter.frequency.value = 1100;
        roarFilter.Q.value = 0.9;
        this.roar = ctx.createGain();
        this.roar.gain.value = 0;
        roar.connect(roarFilter).connect(this.roar).connect(this.master);
        roar.start(0, 1.3);
    }

    /** A cheer of the given strength (0..1). */
    cheer(strength = 0.5) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const g = this.roar.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(Math.min(1.6, g.value + strength * 1.4), t + 0.25);
        g.exponentialRampToValueAtTime(0.001, t + 1.2 + strength * 2.5);
    }

    /** A deep boom (fireworks, flame jets). */
    boom(strength = 1) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const source = ctx.createBufferSource();
        source.buffer = this.buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 160 + Math.random() * 80;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(3 * strength, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        source.connect(filter).connect(gain).connect(this.sfx);
        source.start(t, Math.random() * 2, 1.4);
    }

    // ---- Spell sounds ---------------------------------------------------------------------------------------------

    /** An oscillator note: frequency glides to `to`, with a quick attack and an exponential release. */
    tone(freq, { type = 'sine', at = 0, duration = 0.5, gain = 0.3, to = null, attack = 0.01, filter = null } = {}) {
        const ctx = this.ctx, t = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(gain, t + attack);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        let node = osc.connect(amp);
        if (filter) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.setValueAtTime(filter, t);
            node = node.connect(f);
        }
        node.connect(this.sfx);
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    /** Filtered noise: `freq` sweeps to `to`. */
    hiss({ at = 0, duration = 0.5, gain = 0.5, type = 'bandpass', freq = 1000, to = null, q = 1, attack = 0.02 } = {}) {
        const ctx = this.ctx, t = ctx.currentTime + at;
        const source = ctx.createBufferSource();
        source.buffer = this.whiteBuffer || (this.whiteBuffer = (() => {
            const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            return b;
        })());
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        filter.frequency.setValueAtTime(freq, t);
        if (to) filter.frequency.exponentialRampToValueAtTime(to, t + duration);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(gain, t + attack);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        source.connect(filter).connect(amp).connect(this.sfx);
        source.start(t, Math.random() * 1.2, duration + 0.1);
    }

    /** A short synthesized sound for a spell or ability (no sound files). */
    spell(kind, strength = 1) {
        if (!this.ctx || sound.muted) return;
        const s = strength;
        switch (kind) {
            case 'fire':
                this.hiss({ duration: 0.9, gain: 0.9 * s, freq: 1400, to: 260, q: 0.8, attack: 0.05 });
                this.hiss({ duration: 0.6, gain: 0.6 * s, type: 'lowpass', freq: 220 });
                break;
            case 'ice':
                [2637, 3136, 3520, 4186].forEach((f, i) => this.tone(f * (0.98 + Math.random() * 0.04), { at: i * 0.05, duration: 0.5, gain: 0.08 * s }));
                this.hiss({ duration: 0.3, gain: 0.35 * s, type: 'highpass', freq: 4000 });
                break;
            case 'ward':
                this.tone(880, { type: 'triangle', duration: 0.7, gain: 0.12 * s, to: 1320 });
                this.tone(1320, { type: 'sine', at: 0.05, duration: 0.6, gain: 0.08 * s });
                break;
            case 'shatter':
                for (let i = 0; i < 4; i++) this.hiss({ at: i * 0.04, duration: 0.18, gain: 0.5 * s, type: 'highpass', freq: 3000 + Math.random() * 3000 });
                [3951, 4699, 5274].forEach((f, i) => this.tone(f, { at: 0.02 + i * 0.03, duration: 0.35, gain: 0.05 * s }));
                break;
            case 'venom':
                for (let i = 0; i < 5; i++) {
                    const f = 180 + Math.random() * 260;
                    this.tone(f, { at: i * 0.08, duration: 0.12, gain: 0.18 * s, to: f * 1.8 });
                }
                break;
            case 'rally':
                this.tone(196, { type: 'sawtooth', duration: 0.9, gain: 0.16 * s, attack: 0.08, filter: 1200 });
                this.tone(294, { type: 'sawtooth', at: 0.12, duration: 0.85, gain: 0.12 * s, attack: 0.08, filter: 1400 });
                break;
            case 'insight':
                [523, 659, 784, 1047].forEach((f, i) => this.tone(f, { at: i * 0.07, duration: 0.5, gain: 0.09 * s }));
                break;
            case 'drain':
                this.tone(620, { type: 'triangle', duration: 0.8, gain: 0.14 * s, to: 140 });
                this.hiss({ duration: 0.7, gain: 0.3 * s, freq: 900, to: 300, q: 2 });
                break;
            case 'grow':
                this.tone(70, { type: 'sawtooth', duration: 0.8, gain: 0.25 * s, to: 95, filter: 400, attack: 0.1 });
                this.hiss({ duration: 0.6, gain: 0.25 * s, type: 'lowpass', freq: 500 });
                break;
            case 'heal':
                [784, 988, 1175].forEach((f, i) => this.tone(f, { at: i * 0.06, duration: 0.7, gain: 0.07 * s }));
                break;
            case 'summon':
                this.hiss({ duration: 1.1, gain: 0.5 * s, type: 'lowpass', freq: 200, to: 900, attack: 0.4 });
                this.tone(110, { duration: 1.1, gain: 0.2 * s, attack: 0.3, to: 82 });
                break;
            case 'curse':
                this.tone(155, { type: 'triangle', duration: 0.9, gain: 0.16 * s });
                this.tone(220, { type: 'triangle', duration: 0.9, gain: 0.12 * s });
                break;
            case 'whoosh':
                this.hiss({ duration: 0.35, gain: 0.45 * s, freq: 500, to: 2400, q: 1.5 });
                break;
            case 'legendary':
                [261.6, 329.6, 392, 523.3].forEach((f, i) => {
                    this.tone(f, { type: 'sawtooth', at: i * 0.03, duration: 2.4, gain: 0.07 * s, attack: 0.5, filter: 1600 });
                    this.tone(f * 1.006, { type: 'triangle', at: i * 0.03, duration: 2.4, gain: 0.06 * s, attack: 0.5 });
                });
                this.boom(1.2 * s);
                break;
            default:
                break;
        }
    }

    update() {
        if (!this.ctx) return;
        this.sfx.gain.setTargetAtTime(sound.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
        if (this.ctx.state === 'suspended' && !sound.muted) this.ctx.resume().catch(() => { });
        const target = sound.muted ? 0 : 0.05 + 0.13 * this.presence;
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }
}
