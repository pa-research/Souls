// The crowd and the spells: a looping crowd bed that gets louder in the stadium views and swells on hits, cheers and
// gasps on the big moments, fireworks, and a sample for each spell. Everything plays on the sound board's graph, so
// it follows the sound switch. A spell whose sample did not load falls back to the synthesized sound below.
import { sound } from './assets.js';

const SPELLS = {
    fire: 'fire', ice: 'ice', ward: 'ward', shatter: 'shatter', venom: 'venom', rally: 'rally', insight: 'insight',
    drain: 'drain', grow: 'grow', heal: 'heal', summon: 'summon', curse: 'curse', whoosh: 'spell_whoosh', legendary: 'legendary',
};

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
        this.presence = 0; // 0 in the classic view, 1 down in the stadium
        this.swell = 0; // how excited the crowd is (cheers add to it, it settles by itself)
        this.bed = null;
        this.ctx = null;
    }

    /** Starts the crowd bed once the audio is unlocked and its loop decoded (update calls it every frame). */
    start() {
        const buffer = sound.buffers.get('crowd_loop');
        if (this.bed || !sound.ctx || !buffer) return;
        this.bed = sound.ctx.createGain();
        this.bed.gain.value = 0;
        this.bed.connect(sound.sfx);
        const loop = sound.ctx.createBufferSource();
        loop.buffer = buffer;
        loop.loop = true;
        loop.connect(this.bed);
        loop.start();
    }

    /** The crowd reacts with the given strength (0..1): the bed swells, a big moment gets a cheer. */
    cheer(strength = 0.5) {
        this.swell = Math.min(1.5, this.swell + strength);
        if (strength >= 0.5) sound.play('crowd_cheer', 0.3 + 0.4 * strength, { gap: 2500 });
    }

    /** The crowd gasps (a heavy blow to a hero, a hero falls). */
    gasp() {
        sound.play('crowd_gasp', 0.6, { gap: 1500 });
    }

    /** A firework bursting over the stadium (a dozen at once share a few sounds). */
    firework() {
        if (!sound.play('fireworks', 0.4, { gap: 700, rate: 0.9 + Math.random() * 0.2 }) && sound.unavailable('fireworks')) this.boom(0.6);
    }

    /** The whoosh of the flame jets on the gate towers. */
    flames(strength = 1) {
        if (!sound.play('fire', Math.min(0.5, 0.3 * strength), { gap: 250, rate: 0.8 }) && sound.unavailable('fire')) this.boom(0.5 * strength);
    }

    /** The synthesized sounds' output (the fallback when a sample is missing). */
    synth() {
        if (!this.ctx && sound.ctx) {
            this.ctx = sound.ctx;
            this.buffer = noiseBuffer(this.ctx, 4);
            this.sfx = this.ctx.createGain();
            this.sfx.gain.value = 0.5;
            this.sfx.connect(sound.sfx);
        }
        return !!this.ctx && sound.running && !sound.muted;
    }

    /** A deep boom (synthesized). */
    boom(strength = 1) {
        if (!this.synth()) return;
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

    /** The sound of a spell or ability: its sample, or a synthesized sound if the sample did not load. */
    spell(kind, strength = 1) {
        const name = SPELLS[kind];
        if (name && !sound.unavailable(name)) {
            sound.play(name, Math.min(0.85, 0.6 * strength), { gap: 120 });
            return;
        }
        if (!this.synth()) return;
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

    /** Every frame: the bed follows the camera (louder down in the stadium) and the crowd's excitement. */
    update() {
        this.start();
        const now = performance.now();
        this.swell *= Math.exp(-(now - (this.lastUpdate ?? now)) / 1400);
        this.lastUpdate = now;
        if (this.bed) this.bed.gain.setTargetAtTime((0.12 + 0.38 * this.presence) * (1 + 0.8 * this.swell), sound.ctx.currentTime, 0.25);
    }
}
