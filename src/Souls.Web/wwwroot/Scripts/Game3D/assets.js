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

export const Sounds = {
    CARD_PICKUP: SND + 'fjopp.ogg',
    CARD_MOUNT: SND + 'card_mount.ogg',
    END_TURN: SND + 'scroll.ogg',
    ATTACK: SND + 'attack_1.ogg',
    DEFEND: SND + 'defend_1.ogg',
    CHAT_MESSAGE: SND + 'chat_message.ogg',
    GAME_MUSIC: SND + 'background-music.ogg',
    MENU: SND + 'menu.ogg',
    ABILITY_SACRIFICE: SND + 'ability_sacrifice.ogg',
    ABILITY_HEAL: SND + 'ability_heal.ogg',
};

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

/** Sound effects and music with a global mute switch (remembered per browser). */
class SoundBoard {
    constructor() {
        this.muted = false;
        try { this.muted = localStorage.getItem('souls.muted') === '1'; } catch (e) { /* storage unavailable */ }
        this.music = null;
    }

    play(name, volume = 0.5) {
        if (this.muted || !Sounds[name]) return;
        const audio = new Audio(Sounds[name]);
        audio.volume = volume;
        audio.play().catch(() => { /* autoplay blocked until the first click */ });
    }

    playMusic(name, volume = 0.1) {
        if (this.music && this.music.dataset.name === name) return;
        this.stopMusic();
        const audio = new Audio(Sounds[name]);
        audio.dataset.name = name;
        audio.loop = true;
        audio.volume = volume;
        this.music = audio;
        if (!this.muted) audio.play().catch(() => {});
    }

    stopMusic() {
        if (this.music) { this.music.pause(); this.music = null; }
    }

    toggle() {
        this.muted = !this.muted;
        try { localStorage.setItem('souls.muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (this.music) {
            if (this.muted) this.music.pause(); else this.music.play().catch(() => {});
        }
        return this.muted;
    }
}

export const sound = new SoundBoard();
