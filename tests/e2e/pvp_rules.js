// Ranked game between a 3D player (A) and a classic player (B), watched live by a 3D spectator (C).
// Usage: node pvp_rules.js <baseUrl> <outDir>
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'pvp-rules';
fs.mkdirSync(out, { recursive: true });
const { sleep, RESULT, steps, step, session, waitFrame, snap, register, hook, turn3d, turnClassic } = require('./helpers')(base, out);

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
    const live = f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t !== 'log');
    // Nothing happens until someone acts (turns are long with compose.ci.yaml), and only a fight is a live event: the
    // players play on until one comes.
    for (let k = 0; k < 8 && !C.frames.slice(from).some(live); k++) {
      const now = (await hook(A, 'sync()').catch(() => null))?.current;
      if (now === identA) await turn3d(A, identA, { power: true });
      else if (now === identB) await turnClassic(B, k);
      else await sleep(1000);
    }
    const lived = await waitFrame(C, live, from, 60000);
    step('spectator receives live events', !!lived, lived ? lived.p.events.map(e => e.t).join(',') : 'none');
    step('no console errors (Cwatch)', C.problems.length === 0, C.problems.slice(0, 4).join(' || '));
    await snap(C, 'watching');
    await C.browser.close();
    C.closed = true;
  }
  // (The end screens go on to the game's summary by themselves: read the season while it shows.)
  const [seasonPanelA, seasonPanelB] = [A, B].map(s => s.page.waitForSelector('.sg-end-season', { timeout: 900000 }).then(h => h.textContent()).catch(() => null));
  // Software rendering of three WebGL pages is slow: the top-down view is much cheaper.
  await hook(A, "view('classic')").catch(() => {});
  await hook(C, "view('classic')").catch(() => {});
  let result = null;
  const t0 = Date.now();
  for (let turn = 0; turn < 80 && !result; turn++) {
    if ([A, B].some(x => x.frames.some(f => f.dir === 'in' && RESULT.includes(f.type)))) break;
    const current = (await hook(A, 'sync()').catch(() => null))?.current;
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] loop ${turn}: current ${current}`);
    if (current === identA) await turn3d(A, identA, { power: true });
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
  const seasonOf = async (r, shown) => {
    const panel = await shown;
    const season = r && r.p.season;
    return { ok: !!season && season.after.rating === r.p.rating && season.before.rating === r.p.rating - r.p.ratingChange && !!panel && panel.includes(season.name) && panel.includes(season.after.tier), panel };
  };
  const [seasonA, seasonB] = [await seasonOf(resultA, seasonPanelA), await seasonOf(resultB, seasonPanelB)];
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
