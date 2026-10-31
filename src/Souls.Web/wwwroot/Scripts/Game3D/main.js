// Entry point of the "Modern 3D" game client (three.js). Loaded by /js/game-mode.js instead of the classic client.
import { Stage, VIEWS } from './scene.js';
import { Arena } from './arena.js';
import { CrowdAudio } from './crowd.js';
import { preload, sound } from './assets.js';
import { UI } from './ui.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Interaction } from './interaction.js';
import { tweens } from './tween.js';

const config = JSON.parse(document.getElementById('souls-game-config').textContent);

function webgl2Available() {
    try {
        return !!document.createElement('canvas').getContext('webgl2');
    } catch (e) {
        return false;
    }
}

/** Takes over the page below the navbar, like the classic client does. */
function createHost() {
    const wrapper = document.querySelector('.page-wrapper');
    if (wrapper) wrapper.remove();
    const host = document.createElement('div');
    host.id = 'souls3d';
    document.body.appendChild(host);
    const fit = () => {
        const navbar = document.querySelector('.navbar');
        host.style.bottom = `${navbar ? navbar.offsetHeight : 0}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return host;
}

async function main() {
    const host = createHost();
    if (!webgl2Available()) {
        const message = document.createElement('div');
        message.className = 'souls3d-unsupported';
        message.textContent = 'Your browser does not support WebGL 2, which the 3D arena needs. Switch to the classic client (top left).';
        host.appendChild(message);
        return;
    }

    const stage = new Stage(host);
    await stage.init();
    const ui = new UI(host, config);
    const effects = new Effects(stage);
    const arena = new Arena(stage.scene, stage.quality, stage.backend);
    const crowd = new CrowdAudio();
    let game = null;
    let torches = null;

    // The stadium is up for the menu's cinematic orbit and in every view except the classic top-down one.
    arena.setStadium(true);
    stage.view = savedView();
    stage.onView(name => {
        arena.setStadium(VIEWS[name].stadium);
        ui.setView(name);
        if (VIEWS[name].key) storeView(name);
    });
    ui.onView = name => stage.setView(name);
    // The sound effects load in the background (the music when it plays); audio starts at the first gesture.
    sound.preload();

    let last = performance.now();
    const frame = now => {
        const dt = Math.min(50, now - last);
        last = now;
        tweens.update(now);
        stage.updateCamera(now);
        effects.applyShake(stage.camera);
        effects.update(dt);
        arena.update(now, dt);
        if (arena.stadium && arena.stadium.visible) effects.embers(torches || (torches = arena.torches), dt);
        crowd.presence = stage.viewInfo.stadium ? (stage.view === 'field' ? 1 : 0.7) : 0.25;
        crowd.update();
        if (game) game.update(now, dt);
        stage.render(now);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    await Promise.all([arena.build(), preload(config.cards, p => ui.setProgress(p))]);
    stage.watchFrameRate();

    // Replays, watch and challenge links start right away; after switching clients mid-game, go straight back into
    // the game.
    const resume = window.SoulsGameMode ? window.SoulsGameMode.resume() : null;
    const query = new URLSearchParams(location.search);
    let choice;
    if (config.replayUrl) {
        choice = { mode: 'replay' };
    } else if (config.watch || query.get('live')) {
        choice = { mode: 'watch' };
    } else if (resume) {
        choice = { mode: resume.normal ? 'normal' : 'practice', difficulty: ui.difficulty };
    } else if (query.get('challenge')) {
        choice = { mode: 'friendly', challenge: query.get('challenge') };
    } else {
        // The menu music plays on while looking for a match; the game crossfades to the battle music.
        sound.playMusic('music_menu');
        choice = await ui.showMenu();
    }

    game = new Game({ stage, ui, effects, arena, crowd, config, mode: choice.mode, difficulty: choice.difficulty ?? 1, challenge: choice.challenge });
    new Interaction(stage, game, effects);
    ui.setView(stage.view);
    ui.showViews(true, { chat: !game.spectator });
    exposeTestHooks(stage, game, ui);
    game.start();
}

function savedView() {
    try {
        const view = localStorage.getItem('souls.view');
        return VIEWS[view] && VIEWS[view].key ? view : 'arena';
    } catch (e) {
        return 'arena';
    }
}

function storeView(name) {
    try { localStorage.setItem('souls.view', name); } catch (e) { /* ignore */ }
}

/** Read-only helpers for the end-to-end tests: where things are on screen and what state the game is in. */
function exposeTestHooks(stage, game, ui) {
    // Cards and heroes are children of the game root, which sits at the origin.
    const screen = obj => (obj ? stage.toScreen(obj.center ? obj.center() : obj.position) : null);
    window.__souls3d = {
        state: () => ({
            active: game.active,
            ended: game.ended,
            yourTurn: game.yourTurn,
            gameId: game.gameId,
            mana: Number(game.player.hero.info.mana) || 0,
            playerHealth: game.player.hero.info.health,
            opponentHealth: game.opponent.hero.info.health,
            hand: [...game.player.hand.values()].map(c => ({ cid: c.cid, cost: Number(c.data.cost), pending: !!c.pending, spell: c.spell, name: c.data.name, ability: c.abilityId ?? null })),
            board: [...game.player.board.values()].map(c => ({ cid: c.cid, slotId: c.data.slotId, health: c.data.health, ability: c.abilityId ?? null })),
            opponentHand: game.opponent.hand.size,
            opponentBoard: [...game.opponent.board.values()].map(c => ({ cid: c.cid, slotId: c.data.slotId, health: c.data.health, taunt: !!c.data.taunt })),
            armor: Number(game.player.hero.info.armor) || 0,
            mode: game.mode,
            spectator: game.spectator,
            current: game.current,
            ident: game.ident,
        }),
        sync: () => game.lastSync,
        // The interface object, so tests can render states that take long to reach (end screens).
        ui,
        // Plays game events (as the server sends them) so tests can show effects that are rare in real games.
        playEvents: events => game.playEvents(events),
        // A card entering the arena as if a side played it (legendary entrances).
        useCard: (card, opponent = true) => game.onUseCard(opponent ? game.opponent : game.player, { card, pInfo: (opponent ? game.opponent : game.player).hero.info }),
        log: () => ui.logLines(),
        power: () => {
            const r = ui.power.getBoundingClientRect();
            const host = stage.renderer.domElement.getBoundingClientRect();
            return ui.power.hidden ? null : { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top, disabled: ui.power.disabled };
        },
        tooltip: () => (ui.tooltip.hidden ? null : ui.tooltip.textContent),
        timer: () => (ui.timer.hidden ? null : ui.timerLeft),
        // The visible strip of a hand card (the next card covers the rest of it, as in the classic client).
        handCard: index => game.handScreenPoint(index),
        // Screen rectangles of a hand card, the zoomed hand card and the heroes; the portrait bands (null in landscape).
        handRect: index => game.screenRect([...game.player.hand.values()][index]),
        hoveredRect: () => game.screenRect(game.hovered),
        heroRect: (opponent = false) => game.screenRect((opponent ? game.opponent : game.player).hero),
        layout: () => ({ portrait: stage.portrait, bands: stage.bands, width: stage.width, height: stage.height }),
        slot: slotId => stage.toScreen(game.slots[slotId].position),
        boardCard: cid => screen(game.player.board.get(cid)),
        opponentCard: cid => screen(game.opponent.board.get(cid)),
        hero: () => screen(game.player.hero),
        opponentHero: () => screen(game.opponent.hero),
        endTurn: () => { const at = game.signPoint(); return stage.classicToScreen(at.x, at.y); },
        signRect: () => game.screenRect(game.sign),
        view: name => (name ? stage.setView(name) : stage.view),
        hovered: () => (game.hovered ? game.hovered.cid : null),
        camera: () => stage.camera.position.toArray().map(v => Math.round(v)),
        quality: () => stage.quality,
        // 'webgpu', or 'webgl2' when the browser has no WebGPU (or with ?renderer=webgl), and the GPU it runs on.
        backend: () => stage.backend,
        gpu: () => stage.gpu,
    };
}

main().catch(err => {
    console.error('[Souls3D]', err);
});
