// Loads the classic game's artwork and sounds (shared by both clients).
import * as THREE from '/lib/three/three.webgpu.js';

const IMG = '/Content/Images/';
const SND = '/Content/Sound/';

export const Images = {
    arena: IMG + 'arena.jpg',
    queue: IMG + 'queue.jpg',
    logo: IMG + 'logo.png',
    cardBack: IMG + 'Card/cardback.png',
    cardSlot: IMG + 'Card/cardslot.png',
    cardError: IMG + 'Card/Texture/card_error.png',
    cardUnknown: IMG + 'Card/Portraits/0.png',
    raceTextures: {
        1: IMG + 'Card/Texture/darkness.png',
        2: IMG + 'Card/Texture/vampiric.png',
        3: IMG + 'Card/Texture/lightbringer.png',
        4: IMG + 'Card/Texture/ferocious.png',
    },
    playerFrame: IMG + 'Player/player_frame.png',
    opponentFrame: IMG + 'Player/opponent_frame.png',
    playerNone: IMG + 'Player/player_none.png',
    mana: IMG + 'Player/player_mana.png',
    endTurn: IMG + 'endturn.png',
    endTurnDisabled: IMG + 'endturn_disabled.png',
    target: IMG + 'target.png',
    particle: IMG + 'particle.png',
    practice: IMG + 'practice_game.png',
    practiceFocus: IMG + 'practice_game_focus.png',
    normal: IMG + 'normal_game.png',
    normalFocus: IMG + 'normal_game_focus.png',
    audioOn: IMG + 'audio_on.png',
    audioOff: IMG + 'audio_off.png',
    heroPortrait: type => IMG + `Player/Portraits/${type}.png`,
};

// The game's sounds (Content/Sound/CREDITS.md), Ogg Opus. The effects are fetched and decoded at start; the two music
// tracks stream when they play. pack_open and rare_reveal belong to the shop (js/shop.js).
const EFFECTS = [
    'ui_click', 'emote', 'card_pickup', 'card_play', 'card_draw', 'card_shuffle', 'end_turn', 'turn_start', 'timer_warning',
    'attack', 'hero_hit', 'block', 'card_death', 'taunt', 'hero_power', 'fatigue', 'spell_whoosh', 'fire', 'ice', 'ward',
    'shatter', 'venom', 'rally', 'insight', 'drain', 'grow', 'heal', 'summon', 'curse', 'legendary', 'versus', 'victory',
    'defeat', 'crowd_loop', 'crowd_cheer', 'crowd_gasp', 'fireworks', 'coins', 'quest_complete',
];
export const Sounds = Object.fromEntries([...EFFECTS, 'music_menu', 'music_battle'].map(name => [name, `${SND}${name}.ogg`]));

const imageCache = new Map();

/** Loads an image (cached). Missing images resolve to null instead of failing the game. */
export function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!imageCache.has(url)) {
        imageCache.set(url, new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
        }));
    }
    return imageCache.get(url);
}

export function textureFrom(image, { repeat = false } = {}) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}

/** Preloads everything the arena needs; `onProgress` receives 0..1. */
export async function preload(cardPortraits, onProgress) {
    const urls = [
        Images.arena, Images.cardBack, Images.cardSlot, Images.cardError, Images.playerFrame, Images.opponentFrame,
        Images.playerNone, Images.mana, Images.endTurn, Images.endTurnDisabled, Images.target, Images.particle,
        ...Object.values(Images.raceTextures),
        ...[0, 1, 2, 3, 4, 5, 6].map(Images.heroPortrait),
        ...cardPortraits.map(c => c.portrait),
    ];
    let done = 0;
    await Promise.all(urls.map(u => loadImage(u).then(() => onProgress(++done / urls.length))));
}

/** Test hook: the e2e instrumentation exposes window.__soundTrace(event, name) to count what played and decoded. */
const trace = (event, name) => { try { window.__soundTrace?.(event, name); } catch (e) { /* tests only */ } };

// iOS lets a media element play without a gesture once it has played in one: at the first tap the music player that
// has nothing to play yet plays this (silent) clip, so the battle music can take over from the menu music later.
const SILENCE = 'data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=';

/**
 * Sound effects and music on one Web Audio graph with a global mute switch (remembered per browser, shared with the
 * classic client): effects are decoded buffers (overlapping, no latency), the music streams through two media elements
 * that crossfade. Browsers allow audio only after a user gesture: until then effects are skipped and the music waits.
 */
class SoundBoard {
    constructor() {
        this.muted = false;
        try { this.muted = localStorage.getItem('souls.muted') === '1'; } catch (e) { /* storage unavailable */ }
        this.ctx = null;
        this.buffers = new Map(); // name -> AudioBuffer
        this.failed = new Set(); // effects that cannot play at all (crowd.js falls back to synthesized spells)
        this.elementOnly = new Set(); // effects Web Audio cannot decode, played by a media element instead
        this.last = new Map(); // name -> when it last started (performance.now())
        this.wanted = null; // {name, volume}: the music that should play
        this.current = null; // the music player that is playing it
        this.unlock = this.unlock.bind(this);
        this.gestures = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
        for (const type of this.gestures) window.addEventListener(type, this.unlock, true);
        // A hidden tab goes quiet; the sounds of what happens meanwhile are skipped, not saved up.
        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            (document.hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => { });
        });
    }

    get running() {
        return !!this.ctx && this.ctx.state === 'running';
    }

    /** Fetches and decodes the effects (not the music) in the background; never blocks the game. */
    preload() {
        if (this.loading) return this.loading;
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        // Decoding needs no gesture in an offline context; its buffers play in the real one.
        const decoder = Offline ? new Offline(1, 1, 48000) : null;
        const ogg = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '';
        this.loading = Promise.all(EFFECTS.map(name => fetch(Sounds[name])
            .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
            .then(bytes => {
                if (!decoder) throw new Error('no Web Audio');
                return decoder.decodeAudioData(bytes).then(buffer => {
                    this.buffers.set(name, buffer);
                    trace('decoded', name);
                }, () => {
                    // Web Audio cannot decode Ogg Opus here, the <audio> element may still play it.
                    (ogg ? this.elementOnly : this.failed).add(name);
                    trace(ogg ? 'element' : 'failed', name);
                });
            })
            .catch(() => { this.failed.add(name); trace('failed', name); })));
        return this.loading;
    }

    /** The first user gestures start the audio (and the music waiting for it). */
    unlock() {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        if (!this.ctx) {
            const ctx = this.ctx = new Context();
            this.master = ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 1;
            this.master.connect(ctx.destination);
            this.sfx = ctx.createGain();
            this.sfx.connect(this.master);
            this.decks = [0, 1].map(() => {
                const el = new Audio();
                el.loop = true;
                el.preload = 'auto';
                const gain = ctx.createGain();
                gain.gain.value = 0;
                ctx.createMediaElementSource(el).connect(gain).connect(this.master);
                return { el, gain, name: null };
            });
            this.preload();
        }
        if (this.ctx.state !== 'running' && !document.hidden) {
            this.ctx.resume().then(() => {
                if (this.ctx.state === 'running') for (const type of this.gestures) window.removeEventListener(type, this.unlock, true);
            }, () => { });
        }
        this.syncMusic();
        for (const deck of this.decks) {
            if (deck.name || deck.primed) continue;
            deck.primed = true;
            deck.el.src = SILENCE;
            deck.el.play().then(() => { if (!deck.name) deck.el.pause(); }, () => { });
        }
    }

    /** Whether an effect will never play (it did not load); still loading counts as playable. */
    unavailable(name) {
        return this.failed.has(name);
    }

    /**
     * Plays an effect at `volume` (0..1). `gap`: skipped if the same effect started less than that many ms ago (the
     * same hit from two events); `rate`: playback speed (and pitch). Returns whether it plays.
     */
    play(name, volume = 0.6, { gap = 60, rate = 1 } = {}) {
        if (this.muted || !this.running) return false;
        const now = performance.now();
        if (now - (this.last.get(name) ?? -Infinity) < gap) return false;
        const buffer = this.buffers.get(name);
        if (buffer) {
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = rate;
            const gain = this.ctx.createGain();
            gain.gain.value = volume;
            source.connect(gain).connect(this.sfx);
            source.start();
        } else if (this.elementOnly.has(name)) {
            const audio = new Audio(Sounds[name]);
            audio.volume = Math.min(1, volume);
            audio.play().catch(() => { });
        } else {
            return false;
        }
        this.last.set(name, now);
        trace('play', name);
        return true;
    }

    /** Crossfades to a music track ('music_menu', 'music_battle'); it starts with the audio if that is still locked. */
    playMusic(name, volume = 0.42) {
        this.wanted = { name, volume };
        this.syncMusic();
    }

    stopMusic(fade = 1.5) {
        this.wanted = null;
        this.syncMusic(fade);
    }

    /** Makes the music players match `wanted` (nothing while muted): the old track fades out as the new one fades in. */
    syncMusic(fade = 1.5) {
        if (!this.ctx) return;
        const want = this.muted ? null : this.wanted;
        const t = this.ctx.currentTime;
        const ramp = (deck, to) => {
            const g = deck.gain.gain;
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(to, t + fade);
        };
        const old = this.current;
        if (want && old && old.name === want.name) {
            ramp(old, want.volume);
            if (old.el.paused) old.el.play().catch(() => { });
            return;
        }
        if (old) {
            ramp(old, 0);
            setTimeout(() => { if (this.current !== old) old.el.pause(); }, fade * 1000 + 100);
        }
        this.current = null;
        if (!want) return;
        const deck = this.decks.find(d => d !== old);
        if (deck.name !== want.name) {
            deck.name = want.name;
            deck.el.src = Sounds[want.name];
        }
        ramp(deck, want.volume);
        deck.el.play().catch(() => { /* waits for the next gesture */ });
        this.current = deck;
        trace('music', want.name);
    }

    toggle() {
        this.muted = !this.muted;
        try { localStorage.setItem('souls.muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
        this.syncMusic(0.4);
        return this.muted;
    }
}

export const sound = new SoundBoard();
