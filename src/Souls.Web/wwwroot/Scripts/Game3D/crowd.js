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

    update() {
        if (!this.ctx) return;
        this.sfx.gain.setTargetAtTime(sound.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
        if (this.ctx.state === 'suspended' && !sound.muted) this.ctx.resume().catch(() => { });
        const target = sound.muted ? 0 : 0.05 + 0.13 * this.presence;
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }
}
