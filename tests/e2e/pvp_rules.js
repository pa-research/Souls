// Ranked game between a 3D player (A) and a classic player (B), watched live by a 3D spectator (C).
// Usage: node pvp_rules.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'pvp-rules';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
let shot = 0;

async function session(label) {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const s = { label, browser, page, frames: [], problems: [] };
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) s.problems.push(m.text()); });
  page.on('pageerror', e => s.problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/game')) return;
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
async function drag(s, from, to, button = 'left') {
  if (!from || !to) { console.log('drag skipped: a target is not on screen yet'); await sleep(800); return; }
  const m = s.page.mouse;
  await m.move(from.x, from.y, { steps: 3 }); await sleep(250);
  await m.down({ button }); await sleep(200);
  await m.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
  await m.move(to.x, to.y, { steps: 6 }); await sleep(400);
  await m.up({ button }); await sleep(300);
}
// Classic: stage coordinates (1920x1080) to page coordinates.
async function at(s, gx, gy) {
  let canvas = await s.page.$('canvas');
  if (!canvas) {
    console.log('no canvas: url', s.page.url(), 'problems', s.problems.slice(0, 5), 'frames', s.frames.slice(-15).map(f => `${f.dir}${f.type}`).join(' '));
    console.log('body:', (await s.page.evaluate(() => document.body.innerHTML.slice(0, 600))));
    await snap(s, 'no-canvas');
    throw new Error('classic canvas gone');
  }
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

// A's turn in 3D: play cards, hero power, card attacks / abilities, hero attack, end turn.
async function turn3d(s, ident) {
  for (let k = 0; k < 3; k++) {
    const st = await hook(s, 'state()');
    if (!st) return;
    const taken = new Set(st.board.map(b => b.slotId));
    const slot = [3, 2, 4, 1, 5, 0, 6].find(i => !taken.has(i));
    const pick = st.hand.findIndex(c => c.cost <= st.mana && !c.pending);
    if (pick < 0 || slot === undefined) break;
    const from = s.frames.length;
    await drag(s, await hook(s, `handCard(${pick})`), await hook(s, `slot(${slot})`));
    await waitFrame(s, f => f.dir === 'in' && f.type === 236, from, 8000);
    await sleep(800);
  }
  let sync = await hook(s, 'sync()');
  if (sync && sync.heroes[ident].canUsePower) {
    const power = await hook(s, 'power()');
    if (power && !power.disabled) {
      const from = s.frames.length;
      await s.page.mouse.click(power.x, power.y); await sleep(400);
      const t = await hook(s, 'opponentHero()');
      await s.page.mouse.move(t.x, t.y, { steps: 3 }); await sleep(200);
      await s.page.mouse.click(t.x, t.y);
      await waitFrame(s, f => f.dir === 'in' && f.type === 236, from, 8000);
      await sleep(800);
    }
  }
  for (let k = 0; k < 6; k++) {
    sync = await hook(s, 'sync()');
    if (!sync || sync.current !== ident || (await hook(s, 'state()')).ended) return;
    const ready = (sync.board[ident] || []).filter(c => c.canAct && c.attack > 0);
    if (!ready.length) break;
    const enemy = sync.board[3 - ident] || [];
    const taunts = enemy.filter(c => c.taunt);
    const from = s.frames.length;
    const src = await hook(s, `boardCard(${ready[0].cid})`);
    const dst = taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()');
    if (!src || !dst) break;
    await drag(s, src, dst);
    const ev = await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
    if (!ev || ev.type === 232) break;
    await sleep(1400);
  }
  sync = await hook(s, 'sync()');
  if (sync && sync.current === ident && sync.heroes[ident].canAttack) {
    const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
    const from = s.frames.length;
    await drag(s, await hook(s, 'hero()'), taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()'));
    await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
    await sleep(1400);
  }
  if (s.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) return;
  const sign = await hook(s, 'endTurn()');
  const from = s.frames.length;
  await s.page.mouse.click(sign.x, sign.y);
  await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
}

// B's turn in the classic client: play the first hand card, hero attacks the enemy hero, end turn.
async function turnClassic(s, turn) {
  await classicDrag(s, [175, 965], [520 + 147.7 * (3 + (turn % 3)), 700]);
  await sleep(1500);
  await classicDrag(s, [956, 960], [956, 141]);
  await sleep(2500);
  if (s.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) return;
  const from = s.frames.length;
  const p = await at(s, 1608, 550);
  await s.page.mouse.click(p.x, p.y);
  await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
}

(async () => {
  const id = Date.now().toString(36).slice(-6);
  const A = await session('A3d'), B = await session('Bclassic'), C = await session('Cwatch');
  await register(A, `ann${id}`, 1);
  await register(B, `ben${id}`, 4);
  await register(C, `cat${id}`, 2);
  step('three players registered', true);

  // A queues for a normal game in 3D, B in classic.
  await A.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await A.page.click('.sg-menu-btn >> nth=0');
  await B.page.goto(base + '/Game?mode=classic', { waitUntil: 'domcontentloaded' });
  try { await B.page.waitForSelector('.sg-menu', { timeout: 180000 }); }
  catch (e) {
    await snap(B, 'no-menu');
    console.log('B problems', JSON.stringify(B.problems.slice(0, 6)), 'B frames', JSON.stringify(B.frames.map(f => [f.dir, f.type]).slice(0, 20)));
    console.log('B dom', await B.page.evaluate(() => document.body.className + ' | ' + [...document.querySelectorAll('.sg-layer, .sg-root')].map(e => e.className + (e.hidden ? '(hidden)' : '')).join(', ')));
    throw e;
  }
  await sleep(1500);
  await snap(B, 'menu');
  await B.page.click('.sg-menu-btn >> nth=0');
  const createdA = await waitFrame(A, f => f.dir === 'in' && f.type === 206, 0, 90000);
  const createdB = await waitFrame(B, f => f.dir === 'in' && f.type === 206, 0, 30000);
  step('ranked game created for both clients', !!createdA && !!createdB, createdA ? `A ident ${createdA.p.ident} vs ${createdA.p.opponent.info.name}` : 'no game');
  if (!createdA || !createdB) { await finish(); return; }
  const identA = createdA.p.ident, identB = createdB.p.ident;
  // Both keep their starting hand on the mulligan screen.
  await A.page.click('.sg-mulligan-confirm'); await B.page.click('.sg-mulligan-confirm');
  step('mulligan confirmed in both clients', !!(await waitFrame(A, f => f.dir === 'in' && f.type === 226, 0, 30000)));

  // C watches from the live games list.
  await C.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await C.page.click('.sg-menu-btn:has-text("Watch live")');
  await C.page.waitForSelector('.sg-game button', { timeout: 60000 });
  const listed = await C.page.textContent('.sg-games');
  step('live games list shows the game', listed.includes(`ann${id}`) && listed.includes(`ben${id}`), listed.replace(/\s+/g, ' ').slice(0, 160));
  await snap(C, 'live-list');
  const rows = await C.page.$$('.sg-game');
  for (const row of rows) {
    if ((await row.textContent()).includes(`ann${id}`)) { await (await row.$('button')).click(); break; }
  }
  const watching = await waitFrame(C, f => f.dir === 'in' && f.type === 241, 0, 30000);
  step('spectator receives the game', !!watching && watching.p.spectator === true && Array.isArray(watching.p.player.hand) && watching.p.player.hand.every(c => Object.keys(c).length === 1),
    watching ? `${watching.p.player.info.name} vs ${watching.p.opponent.info.name}` : 'no 241');

  await sleep(4000);
  await snap(C, 'watching-start');
  // The spectator stays until it has seen live events, then leaves so the players' browsers get the CPU.
  const keepC = process.argv[4] === 'keep';
  if (!keepC) {
    const from = C.frames.length;
    const livedP = waitFrame(C, f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t !== 'log'), from, 240000);
    // Nothing happens until someone acts (turns are long with compose.ci.yaml): the player on turn plays it now.
    const now = (await hook(A, 'sync()').catch(() => null))?.current;
    if (now === identA) await turn3d(A, identA);
    else if (now === identB) await turnClassic(B, 0);
    const lived = await livedP;
    step('spectator receives live events', !!lived, lived ? lived.p.events.map(e => e.t).join(',') : 'none');
    step('no console errors (Cwatch)', C.problems.length === 0, C.problems.slice(0, 4).join(' || '));
    await snap(C, 'watching');
    await C.browser.close();
    C.closed = true;
  }
  // Software rendering of three WebGL pages is slow: the top-down view is much cheaper.
  await hook(A, "view('classic')").catch(() => {});
  await hook(C, "view('classic')").catch(() => {});
  let result = null;
  const t0 = Date.now();
  for (let turn = 0; turn < 80 && !result; turn++) {
    if ([A, B].some(x => x.frames.some(f => f.dir === 'in' && RESULT.includes(f.type)))) break;
    const current = (await hook(A, 'sync()').catch(() => null))?.current;
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] loop ${turn}: current ${current}`);
    if (current === identA) await turn3d(A, identA);
    else if (current === identB) {
      const canvases = await B.page.$$eval('canvas', c => c.length).catch(e => 'err ' + e.message);
      if (!canvases) {
        console.log('B lost its canvas at', B.page.url(), 'problems:', B.problems.slice(0, 5));
        console.log('B frames:', B.frames.slice(-12).map(f => `${f.dir}${f.type}`).join(' '));
        await snap(B, 'no-canvas');
        break;
      }
      await turnClassic(B, turn);
    }
    else await sleep(1000);
    if (turn === 3) { await snap(A, 'midgame'); await snap(B, 'midgame'); }
    result = A.frames.find(f => f.dir === 'in' && RESULT.includes(f.type));
  }
  const resultA = await waitFrame(A, f => f.dir === 'in' && RESULT.includes(f.type), 0, 120000);
  const resultB = await waitFrame(B, f => f.dir === 'in' && RESULT.includes(f.type), 0, 30000);
  const name = t => ({ 230: 'Victory', 231: 'Defeat', 233: 'Draw' })[t];
  step('game ends for both', !!resultA && !!resultB, resultA && resultB ? `A ${name(resultA.type)}, B ${name(resultB.type)}` : 'not ended');
  step('ranked game changes ratings', !!resultA && typeof resultA.p.ratingChange === 'number' && typeof resultB.p.ratingChange === 'number',
    resultA && resultB ? `A ${resultA.p.rating} (${resultA.p.ratingChange}), B ${resultB.p.rating} (${resultB.p.ratingChange})` : '');
  if (!C.closed) {
    const end = await waitFrame(C, f => f.dir === 'in' && f.type === 242, 0, 30000);
    step('spectator sees the end', !!end, end ? JSON.stringify(end.p) : 'no 242');
  }
  const classicEvents = B.frames.filter(f => f.dir === 'in' && f.type === 235).length;
  step('classic client got events and syncs', classicEvents > 3 && B.frames.some(f => f.dir === 'in' && f.type === 236), `${classicEvents} event batches`);
  await sleep(3000);
  // Both end screens show the season: the rank before and after (the rating the season goes by).
  const seasonOf = async (s, r) => {
    const panel = await s.page.$eval('.sg-end-season', e => e.textContent).catch(() => null);
    const season = r && r.p.season;
    return { ok: !!season && season.after.rating === r.p.rating && season.before.rating === r.p.rating - r.p.ratingChange && !!panel && panel.includes(season.name) && panel.includes(season.after.tier), panel };
  };
  const [seasonA, seasonB] = [await seasonOf(A, resultA), await seasonOf(B, resultB)];
  step('ranked end screens show the season', seasonA.ok && seasonB.ok, `3D: ${seasonA.panel} | classic: ${seasonB.panel}`);
  await snap(A, 'end'); await snap(B, 'end');
  for (const s of [A, B, C].filter(x => !x.closed)) step(`no console errors (${s.label})`, s.problems.length === 0, s.problems.slice(0, 4).join(' || '));
  if (resultA && resultA.p.statistics) {
    await sleep(2000);
    await B.page.goto(`${base}/Game/Stats/${resultA.p.statistics}`).catch(() => {});
    await sleep(1500);
    const text = await B.page.textContent('body');
    step('stats page shows a ranked game with rating changes', /Ranked game/.test(text) && /Rating: \d+ \([+-]\d+\)/.test(text));
    await snap(B, 'stats');
  }
  await finish();

  async function finish() {
    fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
    console.log(`${steps.filter(x => x.ok).length}/${steps.length} passed`);
    for (const s of [A, B, C].filter(x => !x.closed)) await s.browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
