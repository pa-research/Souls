// Running games survive a restart of the game server (saved in the database, restored by the next instance).
// 1. A 3D practice game against the bot: restarted during the mulligan and during the bot's turn.
// 2. A ranked game between a 3D player (A) and a classic player (B), watched by a 3D spectator (C): restarted in the
//    middle of A's turn, then stopped and started again (redeploy) during B's turn.
// Every client reconnects by itself, the game chat works after a restart, the games finish with a winner, the rating
// changes once, the replays are complete, and a finished game is not resumed by a later restart.
// Usage: node restart.js <baseUrl> <outDir> [restart command] [redeploy command]
//   restart command:  default $SOULS_RESTART_CMD, else "docker compose restart server"
//   redeploy command: default $SOULS_REDEPLOY_CMD, else the restart command; for example
//                     "docker compose stop server && docker compose up -d --build --force-recreate --no-deps server"
const { chromium } = require('playwright');
const { exec } = require('child_process');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'restart';
const restartCmd = process.argv[4] || process.env.SOULS_RESTART_CMD || 'docker compose restart server';
const redeployCmd = process.argv[5] || process.env.SOULS_REDEPLOY_CMD || restartCmd;
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
// While the server restarts, the browser logs the failed reconnection attempts: expected here.
const EXPECTED = /GL Driver|GPU stall|api\.github|WebSocket connection to .* failed/;
let shot = 0;

async function session(label) {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const s = { label, browser, page, frames: [], chat: [], problems: [], sockets: 0, closes: 0 };
  page.on('console', m => { if (m.type() === 'error' && !EXPECTED.test(m.text())) s.problems.push(m.text()); });
  page.on('pageerror', e => s.problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  page.on('websocket', ws => {
    if (ws.url().endsWith('/chat')) {
      ws.on('framereceived', f => { try { s.chat.push(JSON.parse(f.payload)); } catch (e) {} });
      return;
    }
    if (!ws.url().endsWith('/game')) return;
    s.sockets++;
    ws.on('close', () => s.closes++);
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'in', type: j.Type, p: j.Payload }); } catch (e) {} });
    ws.on('framesent', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'out', type: j.Type, p: j.Payload }); } catch (e) {} });
  });
  return s;
}
async function waitFrame(s, pred, from = 0, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = from; i < s.frames.length; i++) if (pred(s.frames[i])) return s.frames[i];
    await sleep(100);
  }
  return null;
}
const last = (s, pred) => [...s.frames].reverse().find(pred);
async function waitChat(s, pred, from = 0, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = from; i < s.chat.length; i++) if (pred(s.chat[i])) return s.chat[i];
    await sleep(100);
  }
  return null;
}
async function snap(s, name) {
  try { await s.page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${s.label}-${name}.jpg`, type: 'jpeg', quality: 75, timeout: 90000 }); } catch (e) { console.log(`(screenshot ${name} skipped)`); }
}
async function register(s, name, type) {
  const p = s.page;
  await p.goto(base + '/Player/Register');
  await p.fill('#Form_Username', name);
  await p.fill('#Form_Password', 'CorrectHorse9!');
  await p.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await p.check(`#type-${type}`);
  for (const box of (await p.$$('input.cards')).slice(0, 5)) await box.check();
  await p.click('main button[type=submit]');
  await p.waitForURL(/Player\/Login/);
  await p.fill('#Name', name);
  await p.fill('#Password', 'CorrectHorse9!');
  await p.click('main button[type=submit]');
  await p.waitForURL(u => !u.toString().includes('/Player/Login'));
}
const hook = (s, expr) => s.page.evaluate(`window.__souls3d && window.__souls3d.${expr}`);
async function drag(s, from, to) {
  if (!from || !to) { console.log('drag skipped: a target is not on screen yet'); await sleep(800); return; }
  const m = s.page.mouse;
  await m.move(from.x, from.y, { steps: 3 }); await sleep(250);
  await m.down(); await sleep(200);
  await m.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
  await m.move(to.x, to.y, { steps: 6 }); await sleep(400);
  await m.up(); await sleep(300);
}
// Classic: stage coordinates (1920x1080) to page coordinates.
async function at(s, gx, gy) {
  const canvas = await s.page.$('canvas');
  if (!canvas) throw new Error(`${s.label}: classic canvas gone`);
  const box = await canvas.boundingBox();
  return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 };
}
async function classicDrag(s, from, to) {
  const a = await at(s, from[0], from[1]); const b = await at(s, to[0], to[1]);
  await s.page.mouse.move(a.x, a.y); await sleep(150);
  await s.page.mouse.down(); await sleep(150);
  await s.page.mouse.move(b.x, b.y, { steps: 25 }); await sleep(300);
  await s.page.mouse.up(); await sleep(400);
}
const ended = s => s.frames.some(f => f.dir === 'in' && RESULT.includes(f.type));

/** Runs the restart (or redeploy) command while the browsers keep running; returns when it is done. */
async function restartServer(label, cmd, watchers) {
  console.log(`--- ${label}: ${cmd}`);
  const t0 = Date.now();
  const done = new Promise((resolve, reject) => exec(cmd, { shell: '/bin/sh' }, (err, stdout, stderr) => {
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.log(stderr.trim().split('\n').slice(-4).join('\n'));
    if (err) reject(err); else resolve();
  }));
  await sleep(1500);
  for (const s of watchers) await snap(s, `${label}-reconnecting`);
  await done;
  console.log(`--- ${label} done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

// A's turn in 3D (also the practice player's): play up to `cards` cards, attack with ready cards and the hero, end
// the turn unless `keep` (the turn stays open for a restart).
async function turn3d(s, ident, { cards = 3, keep = false } = {}) {
  for (let k = 0; k < cards; k++) {
    const st = await hook(s, 'state()');
    if (!st) return;
    const taken = new Set(st.board.map(b => b.slotId));
    const slot = [3, 2, 4, 1, 5, 0, 6].find(i => !taken.has(i));
    const pick = st.hand.findIndex(c => c.cost <= st.mana && !c.pending && !c.spell);
    if (pick < 0 || slot === undefined) break;
    const from = s.frames.length;
    await drag(s, await hook(s, `handCard(${pick})`), await hook(s, `slot(${slot})`));
    await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232 || f.type === 213), from, 8000);
    await sleep(800);
  }
  if (keep) return;
  for (let k = 0; k < 6; k++) {
    const sync = await hook(s, 'sync()');
    if (!sync || sync.current !== ident || (await hook(s, 'state()')).ended) return;
    const ready = (sync.board[ident] || []).filter(c => c.canAct && c.attack > 0);
    if (!ready.length) break;
    const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
    const from = s.frames.length;
    const src = await hook(s, `boardCard(${ready[0].cid})`);
    const dst = taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()');
    if (!src || !dst) break;
    await drag(s, src, dst);
    const ev = await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
    if (!ev || ev.type === 232) break;
    await sleep(1400);
  }
  const sync = await hook(s, 'sync()');
  if (sync && sync.current === ident && sync.heroes[ident].canAttack) {
    const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
    const from = s.frames.length;
    await drag(s, await hook(s, 'hero()'), taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()'));
    await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
    await sleep(1400);
  }
  if (ended(s)) return;
  await endTurn3d(s);
}
async function endTurn3d(s) {
  const sign = await hook(s, 'endTurn()');
  const from = s.frames.length;
  await s.page.mouse.click(sign.x, sign.y);
  await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
}
// The 3D client shows its own turn (it may lag behind the socket under load).
async function waitTurn3d(s, ident, timeout = 150000) {
  return s.page.waitForFunction(id => {
    const h = window.__souls3d;
    if (!h || !h.state().active) return false;
    if (h.state().ended) return 'ended';
    const sync = h.sync();
    return sync && sync.current === id && h.state().yourTurn ? true : false;
  }, ident, { timeout, polling: 300 }).then(h => h.jsonValue()).catch(() => null);
}

// B's turn in the classic client: play the first hand card, hero attacks the enemy hero, end turn.
async function turnClassic(s, turn, { keep = false } = {}) {
  await classicDrag(s, [175, 980], [520 + 147.7 * (3 + (turn % 3)), 700]);
  await sleep(1500);
  if (keep) return;
  await classicDrag(s, [956, 960], [956, 141]);
  await sleep(2500);
  if (ended(s)) return;
  const from = s.frames.length;
  const p = await at(s, 1608, 550);
  await s.page.mouse.click(p.x, p.y);
  await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
}

async function replayTypes(s, gameId) {
  const res = await s.page.request.get(`${base}/Game/ReplayData/${gameId}`);
  if (!res.ok()) return null;
  return (await res.json()).map(r => r.m.Type);
}

// ---- 1. Practice game against the bot -----------------------------------------------------------------------------
async function practice(id) {
  const P = await session('P3d');
  await register(P, `pat${id}`, 1);
  await P.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await P.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await P.page.click('.sg-menu-row .s-seg button >> nth=1');
  await P.page.click('.sg-menu-btn >> nth=1');
  const created = await waitFrame(P, f => f.dir === 'in' && f.type === 206, 0, 60000);
  step('practice: game created', !!created, created ? `game ${created.p.gameId} vs ${created.p.opponent.info.name}` : 'no 206');
  if (!created) return P;
  const ident = created.p.ident;
  await P.page.waitForSelector('.sg-mulligan-confirm', { timeout: 30000 });
  await sleep(1500);
  await snap(P, 'mulligan');

  // Restart while the mulligan screen is open: the client comes back to the same starting hand, still undecided.
  let from = P.frames.length;
  await restartServer('practice-restart-mulligan', restartCmd, [P]);
  const back = await waitFrame(P, f => f.dir === 'in' && f.type === 206, from, 90000);
  const hand = p => Object.keys(p.player.hand).join(',');
  step('practice: back in the mulligan after a restart', !!back && back.p.gameId === created.p.gameId && hand(back.p) === hand(created.p) && back.p.mulligan && back.p.mulligan.done === false,
    back ? `game ${back.p.gameId}, hand ${hand(back.p)}, mulligan ${JSON.stringify(back.p.mulligan)}` : 'no 206 after the restart');
  await P.page.waitForSelector('.sg-mulligan-confirm', { timeout: 30000 });
  await sleep(1500);
  await snap(P, 'mulligan-after-restart');
  from = P.frames.length;
  await P.page.click('.sg-mulligan-confirm');
  step('practice: the game starts after the mulligan', !!(await waitFrame(P, f => f.dir === 'in' && f.type === 226, from, 60000)));

  // Play; right after the first end of turn, restart during the bot's turn.
  let restartedBotTurn = false;
  let botTries = 0;
  for (let turn = 0; turn < 50 && !ended(P); turn++) {
    const mine = await waitTurn3d(P, ident);
    if (mine === 'ended' || ended(P)) break;
    if (!mine) { step('practice: my turn comes', false, `turn ${turn}`); break; }
    await sleep(1000);
    if (!restartedBotTurn && turn >= 1) {
      await turn3d(P, ident, { cards: 1, keep: true });
      if (ended(P)) break;
      from = P.frames.length;
      await endTurn3d(P);
      // Restart as soon as the bot has made its first move (the socket is ahead of the animations).
      const botSync = await waitFrame(P, f => f.dir === 'in' && f.type === 236 && f.p.current !== ident, from, 10000);
      const botMove = await waitFrame(P, f => f.dir === 'in' && (f.type === 211 || f.type === 225 || (f.type === 235 && f.p.events.some(e => e.t === 'attack'))), from, 6000);
      const botTurn = botSync ? botSync.p.turn : -1;
      from = P.frames.length;
      await restartServer('practice-restart-bot-turn', restartCmd, [P]);
      const again = await waitFrame(P, f => f.dir === 'in' && f.type === 206, from, 90000);
      const finishedBefore = P.frames.slice(0, from).some(f => f.dir === 'in' && f.type === 236 && f.p.turn > botTurn);
      const restored = again && await waitFrame(P, f => f.dir === 'in' && f.type === 236, from, 30000);
      // The bot finishes its turn on the new server (maybe before this client is back): my next turn comes.
      const mineAgain = again && await waitFrame(P, f => f.dir === 'in' && f.type === 236 && f.p.turn === botTurn + 1 && f.p.current === ident, from, 90000);
      // On a fast host the bot can end its turn before the restart lands: then try again on a later bot turn.
      if (finishedBefore && ++botTries < 3) {
        console.log(`the bot's turn ${botTurn} was over before the restart; trying again on a later turn`);
        await snap(P, `bot-turn-after-restart-try${botTries}`);
        continue;
      }
      restartedBotTurn = true;
      step('practice: the bot plays on after a restart during its turn', !!botMove && !finishedBefore && !!again && !!mineAgain,
        again ? `bot moved before the restart: ${botMove ? botMove.type : 'no'}, its turn ${botTurn} was over before the restart: ${finishedBefore}; back in game ${again.p.gameId} at turn ${restored && restored.p.turn}, my turn ${botTurn + 1} came: ${!!mineAgain}` : 'no 206 after the restart');
      await snap(P, 'bot-turn-after-restart');
      continue;
    }
    await turn3d(P, ident);
  }
  const result = await waitFrame(P, f => f.dir === 'in' && RESULT.includes(f.type), 0, 120000);
  step('practice: the game ends with a result', !!result && result.p.statistics > 0, result ? `${result.type} game ${result.p.statistics}` : 'no result');
  if (result) {
    await sleep(3000);
    await snap(P, 'end');
    const types = await replayTypes(P, result.p.statistics);
    const turns = last(P, f => f.dir === 'in' && f.type === 236).p.turn + 1;
    step('practice: the replay is complete', !!types && types[0] === 241 && types[types.length - 1] === 242 && types.filter(t => t === 226).length === turns && types.includes(227),
      types ? `${types.length} messages, ${types.filter(t => t === 226).length} turn starts (game had ${turns}), ${types.filter(t => t === 241).length} full states` : 'no replay');
  }
  step('practice: the client reconnected by itself', P.sockets >= 3, `${P.sockets} game connections`);
  return P;
}

// ---- 2. Ranked game 3D vs classic with a spectator ----------------------------------------------------------------
async function ranked(id) {
  const A = await session('A3d'), B = await session('Bclassic'), C = await session('Cwatch');
  await register(A, `ann${id}`, 1);
  await register(B, `ben${id}`, 4);
  await register(C, `cat${id}`, 2);
  await A.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await A.page.click('.sg-menu-btn >> nth=0');
  await B.page.goto(base + '/Game?mode=classic', { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('.sg-menu', { timeout: 180000 });
  await sleep(1500);
  await B.page.click('.sg-menu-btn >> nth=0');
  const createdA = await waitFrame(A, f => f.dir === 'in' && f.type === 206, 0, 90000);
  const createdB = await waitFrame(B, f => f.dir === 'in' && f.type === 206, 0, 30000);
  step('ranked: game created for both clients', !!createdA && !!createdB, createdA ? `game ${createdA.p.gameId}, A ident ${createdA.p.ident}` : 'no game');
  if (!createdA || !createdB) return [A, B, C];
  const gameId = createdA.p.gameId, identA = createdA.p.ident, identB = createdB.p.ident;
  await A.page.click('.sg-mulligan-confirm'); await B.page.click('.sg-mulligan-confirm');
  step('ranked: mulligan confirmed', !!(await waitFrame(A, f => f.dir === 'in' && f.type === 226, 0, 60000)));

  await C.page.goto(base + `/Game?mode=3d`, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await C.page.click('.sg-menu-btn:has-text("Watch live")');
  await C.page.waitForSelector('.sg-game button', { timeout: 60000 });
  for (const row of await C.page.$$('.sg-game')) {
    if ((await row.textContent()).includes(`ann${id}`)) { await (await row.$('button')).click(); break; }
  }
  step('ranked: the spectator watches', !!(await waitFrame(C, f => f.dir === 'in' && f.type === 241, 0, 30000)));

  let restarts = 0;
  for (let turn = 0; turn < 80 && !ended(A); turn++) {
    const current = (await hook(A, 'sync()').catch(() => null))?.current;
    if (current === identA) {
      if (!(await waitTurn3d(A, identA, 30000))) { await sleep(500); continue; }
      if (restarts === 0 && turn >= 2) {
        // 1st restart in the middle of A's turn: A has played a card and still has its turn.
        await turn3d(A, identA, { cards: 1, keep: true });
        if (ended(A)) break;
        await sleep(1500);
        const before = await hook(A, 'sync()');
        const handBefore = (await hook(A, 'state()')).hand.map(c => c.cid).sort().join(',');
        const marks = [A.frames.length, B.frames.length, C.frames.length];
        await restartServer('ranked-restart-mid-turn', restartCmd, [A, B, C]);
        restarts++;
        const [a, b, c] = await Promise.all([
          waitFrame(A, f => f.dir === 'in' && f.type === 206, marks[0], 90000),
          waitFrame(B, f => f.dir === 'in' && f.type === 206, marks[1], 90000),
          waitFrame(C, f => f.dir === 'in' && f.type === 241, marks[2], 90000)]);
        const syncA = await waitFrame(A, f => f.dir === 'in' && f.type === 236, marks[0], 30000);
        const board = sync => JSON.stringify(sync && [sync.turn, sync.current, sync.board, sync.heroes[identA].mana, sync.heroes[identA].heroPowerUsed, sync.heroes[identB].health]);
        step('ranked: both players and the spectator are back after a restart mid-turn', !!a && !!b && !!c && a.p.gameId === gameId && a.p.yourTurn === true && b.p.yourTurn === false,
          `A ${!!a}, B ${!!b}, C ${!!c}`);
        step('ranked: the game continues from the same state', !!syncA && board(syncA.p) === board(before) && Object.keys(a.p.player.hand).sort().join(',') === handBefore,
          syncA ? `turn ${syncA.p.turn}, ${syncA.p.turnEndsIn} ms left of the turn` : 'no sync');
        await sleep(3000);
        // The game's chat room is back: a line A types in 3D reaches B's classic chat.
        const line = `still here ${id}`;
        const chatMark = B.chat.length;
        try {
          await A.page.click('.souls3d-chat-header', { timeout: 10000 });
          await A.page.fill('.souls3d-chat-input', line, { timeout: 10000 });
          await A.page.press('.souls3d-chat-input', 'Enter');
        } catch (e) { console.log('chat input: ' + e.message.split('\n')[0]); }
        const heard = await waitChat(B, m => m.Type === 1003 && m.Payload.message === line, chatMark, 15000);
        await sleep(800);
        const shown = await B.page.$eval('.souls-classic-chat .sg-log-list', e => e.textContent).catch(() => '');
        step('ranked: a chat line after the restart arrives', !!heard && shown.includes(line), heard ? `room ${heard.Payload.room}, shown in B's chat: ${shown.includes(line)}` : 'no ChatMessage for B');
        await snap(A, 'after-restart'); await snap(B, 'after-restart'); await snap(C, 'after-restart');
        await A.page.click('.souls3d-chat-header', { timeout: 10000 }).catch(() => {});
        await turn3d(A, identA);
        continue;
      }
      await turn3d(A, identA);
    } else if (current === identB) {
      if (restarts === 1 && turn >= 4) {
        // 2nd: stop and start again (a redeploy) in the middle of B's turn.
        await turnClassic(B, turn, { keep: true });
        if (ended(A)) break;
        const marks = [A.frames.length, B.frames.length, C.frames.length];
        await restartServer('ranked-redeploy-classic-turn', redeployCmd, [A, B, C]);
        restarts++;
        const [a, b, c] = await Promise.all([
          waitFrame(A, f => f.dir === 'in' && f.type === 206, marks[0], 120000),
          waitFrame(B, f => f.dir === 'in' && f.type === 206, marks[1], 120000),
          waitFrame(C, f => f.dir === 'in' && f.type === 241, marks[2], 120000)]);
        step('ranked: everyone is back after a redeploy during the classic turn', !!a && !!b && !!c && b.p.yourTurn === true, `A ${!!a}, B ${!!b}, C ${!!c}`);
        await sleep(4000);
        await snap(B, 'after-redeploy'); await snap(C, 'after-redeploy');
        await turnClassic(B, turn + 1);
        continue;
      }
      await turnClassic(B, turn);
    } else await sleep(1000);
  }
  const resultA = await waitFrame(A, f => f.dir === 'in' && RESULT.includes(f.type), 0, 120000);
  const resultB = await waitFrame(B, f => f.dir === 'in' && RESULT.includes(f.type), 0, 30000);
  const end = await waitFrame(C, f => f.dir === 'in' && f.type === 242, 0, 30000);
  const name = t => ({ 230: 'Victory', 231: 'Defeat', 233: 'Draw' })[t];
  step('ranked: the game ends for both players and the spectator', !!resultA && !!resultB && !!end, resultA && resultB ? `A ${name(resultA.type)}, B ${name(resultB.type)}` : 'not ended');
  step('ranked: the server was restarted twice during the game', restarts === 2, `${restarts} restarts`);
  if (resultA && resultB) {
    const once = (r, created) => r.p.rating === created.p.player.info.rating + r.p.ratingChange;
    step('ranked: each rating changes once', typeof resultA.p.ratingChange === 'number' && resultA.p.ratingChange !== 0 && once(resultA, createdA) && once(resultB, createdB),
      `A ${createdA.p.player.info.rating} -> ${resultA.p.rating} (${resultA.p.ratingChange}), B ${createdB.p.player.info.rating} -> ${resultB.p.rating} (${resultB.p.ratingChange})`);
    const types = await replayTypes(A, resultA.p.statistics);
    const turns = last(A, f => f.dir === 'in' && f.type === 236).p.turn + 1;
    step('ranked: the replay is complete', !!types && types[0] === 241 && types[types.length - 1] === 242 && types.filter(t => t === 226).length === turns,
      types ? `${types.length} messages, ${types.filter(t => t === 226).length} turn starts (game had ${turns})` : 'no replay');
  }
  await sleep(3000);
  await snap(A, 'end'); await snap(B, 'end'); await snap(C, 'end');
  return [A, B, C];
}

(async () => {
  const id = Date.now().toString(36).slice(-6);
  const sessions = [];
  try {
    sessions.push(await practice(id));
    sessions.push(...await ranked(id));

    // A finished game stays finished: after another restart it is not listed or resumed.
    const C = sessions.find(s => s.label === 'Cwatch');
    if (C) {
      await restartServer('restart-after-the-games', restartCmd, []);
      const mark = C.frames.length;
      await C.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
      await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
      await C.page.click('.sg-menu-btn:has-text("Watch live")');
      const list = await waitFrame(C, f => f.dir === 'in' && f.type === 240, mark, 30000);
      await sleep(1500);
      const names = list ? list.p.games.flatMap(g => g.players.map(p => p.name)) : null;
      step('finished games are not resumed by a later restart', !!names && !names.some(n => n.endsWith(id)), names ? `${names.length / 2} live games` : 'no list');
      await snap(C, 'live-after-restart');
    }
  } catch (e) {
    step('script ran to the end', false, e.stack || String(e));
  }
  for (const s of sessions) step(`no console errors (${s.label})`, s.problems.length === 0, s.problems.slice(0, 4).join(' || '));
  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(x => x.ok).length}/${steps.length} passed`);
  for (const s of sessions) await s.browser.close();
  process.exitCode = steps.every(x => x.ok) ? 0 : 1;
})();
