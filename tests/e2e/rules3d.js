// End-to-end test of the new rules in the 3D client: practice game against the bot (difficulty from argv),
// hero power, abilities, Taunt-aware attacks, battle log, timer, tooltips, rewards, stats page and replay; the
// targeting hint off the heroes, hero power, hand and End Turn, and the leave dialog (leave_dialog.js).
// Usage: node rules3d.js <baseUrl> <outDir> [difficulty] [class id, default 1 Rabid Soul]
const { chromium } = require('playwright');
const fs = require('fs');
const { checkLeaveDialog } = require('./leave_dialog');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'rules3d';
const difficulty = Number(process.argv[4] ?? 2);
const playerType = Number(process.argv[5] ?? 1);
// Fader's default power (Fade) needs no target: it is used on the click, without a targeting hint.
const untargetedPower = playerType === 4;
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  // Every animation frame: two full-screen layers (matchmaking, VS splash, mulligan, end screen) at once, or a centre
  // banner, legendary name or tooltip over one of them, is a transition that overlaps.
  await page.addInitScript(() => {
    const overlaps = window.__overlaps = [];
    const LAYERS = ['.souls3d-overlay', '.souls3d-versus', '.sg-mulligan', '.souls3d-end'];
    const OVER = ['.sg-banner', '.sg-legend', '.sg-tip'];
    const seen = e => {
      for (let n = e, o = 1; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || (o *= Number(cs.opacity)) < 0.05) return false;
      }
      return true;
    };
    const t0 = performance.now();
    const tick = () => {
      const up = s => [...document.querySelectorAll(s)].some(seen);
      const layers = LAYERS.filter(up);
      const over = OVER.filter(up);
      if ((layers.length > 1 || (layers.length && over.length) || over.filter(s => s !== '.sg-tip').length > 1) && overlaps.length < 20) {
        overlaps.push(`${Math.round(performance.now() - t0)} ms: ${[...layers, ...over].join(' + ')}`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const problems = [];
  const frames = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/game')) return;
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'in', type: j.Type, p: j.Payload, t: Date.now() }); } catch (e) {} });
    ws.on('framesent', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'out', type: j.Type, p: j.Payload, t: Date.now() }); } catch (e) {} });
  });
  const waitFrame = async (pred, from, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (let i = from; i < frames.length; i++) if (pred(frames[i])) return frames[i];
      await sleep(100);
    }
    return null;
  };
  let shot = 0;
  const snap = async name => {
    try { await page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 75, timeout: 60000 }); } catch (e) { console.log('(screenshot skipped)'); }
  };
  // null once the page has left the game (the end screen moves on to the statistics page by itself).
  const hook = expr => page.evaluate(`window.__souls3d ? window.__souls3d.${expr} : null`);
  const drag = async (from, to, button = 'left') => {
    if (!from || !to) { console.log('drag skipped: a target is not on screen yet'); await sleep(800); return; }
    await page.mouse.move(from.x, from.y, { steps: 3 }); await sleep(250);
    await page.mouse.down({ button }); await sleep(200);
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
    await page.mouse.move(to.x, to.y, { steps: 6 }); await sleep(400);
    await page.mouse.up({ button }); await sleep(300);
  };

  // Register and log in.
  const name = 'r' + Date.now().toString(36);
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name);
  await page.fill('#Form_Password', 'CorrectHorse9!');
  await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check(`#type-${playerType}`);
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]');
  await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name);
  await page.fill('#Password', 'CorrectHorse9!');
  await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  step('register and log in', true, name);

  await page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sg-menu', { timeout: 120000 });
  await page.click(`.sg-menu-row .s-seg button >> nth=${difficulty}`);
  await page.click('.sg-menu-btn >> nth=1');
  const queued = await waitFrame(f => f.dir === 'out' && f.type === 101, 0, 20000);
  step('practice queue sends the difficulty', queued && queued.p.difficulty === difficulty, JSON.stringify(queued && queued.p));
  const created = await waitFrame(f => f.dir === 'in' && f.type === 206, 0, 60000);
  step('game created', !!created, created ? `ident ${created.p.ident}, opponent ${created.p.opponent.info.name}` : 'no 206');
  const ident = created ? created.p.ident : 1;
  await waitFrame(f => f.dir === 'in' && f.type === 236, 0, 20000);
  await sleep(5000);
  await snap('start');
  // Mulligan: replace the first starting card; the game then starts with the same hand size. Its hint speaks of clicks.
  const mulliganHint = await page.$eval('.sg-mulligan-box p', e => e.textContent);
  step('the mulligan hint speaks of clicks with a mouse', /^Click the cards/.test(mulliganHint), mulliganHint);
  await page.click('.sg-mulligan-card >> nth=0');
  await snap('mulligan');
  const mulliganFrom = frames.length;
  await page.click('.sg-mulligan-confirm');
  const mulligan = await waitFrame(f => f.dir === 'in' && f.type === 227, mulliganFrom, 15000);
  await waitFrame(f => f.dir === 'in' && f.type === 226, mulliganFrom, 45000);
  await sleep(2500);
  const handAfter = (await hook('state()')).hand.length;
  step('mulligan replaces a card and keeps the hand size', !!mulligan && mulligan.p.replaced === 1 && mulligan.p.hand.length === 3 && handAfter === (ident === 1 ? 3 : 4), `replaced ${mulligan && mulligan.p.replaced}, hand ${handAfter}`);

  const counts = { played: 0, attacks: 0, abilities: 0, powers: 0, refused: 0 };
  let result = null;
  for (let turn = 0; turn < 45 && !result; turn++) {
    // Wait for our turn (or the end).
    const mine = await page.waitForFunction(id => {
      const s = window.__souls3d.sync();
      return s && (s.current === id) && !window.__souls3d.state().ended ? true : (window.__souls3d.state().ended ? 'ended' : false);
    }, ident, { timeout: 150000, polling: 300 }).then(h => h.jsonValue()).catch(() => null);
    const ended = frames.find(f => f.dir === 'in' && RESULT.includes(f.type));
    if (ended || mine === 'ended') { result = ended; break; }
    if (!mine) { step('my turn comes', false, `turn ${turn}`); break; }
    await sleep(1200);
    if (turn === 1) {
      const timer = await hook('timer()');
      const limit = ((await hook('sync()'))?.turnTime ?? 75000) / 1000;
      step('turn timer is shown', timer !== null && Number(timer) > 0 && Number(timer) <= limit, `${timer}s left of ${limit}`);
      await checkLeaveDialog(page, step, { label: '3D', settings: '.souls3d-views [aria-label=Settings]', leave: '.souls3d-settings .s-btn-danger' });
    }

    let sync;
    // Hero power (Rabid Bite: an enemy) when there is mana.
    const usePower = async () => {
      sync = await hook('sync()');
      if (sync && sync.heroes[ident].canUsePower) {
        const power = await hook('power()');
        if (power && !power.disabled) {
          const from = frames.length;
          await page.mouse.click(power.x, power.y); await sleep(500);
          if (counts.powers === 0) await snap('power-armed');
          // The hint (and any message) is over the middle of the board, off the heroes, the hero power, the hand and End Turn.
          // An untargeted power (Fade) shows no hint, so there is nothing to place.
          if (counts.powers === 0 && !untargetedPower) {
            const st = await hook('state()');
            const keep = { 'own hero': await hook('heroRect(false)'), 'enemy hero': await hook('heroRect(true)'), 'End Turn': await hook('signRect()') };
            for (let i = 0; i < st.hand.length; i++) keep[`hand card ${i}`] = await hook(`handRect(${i})`);
            const rects = await page.$$eval('.sg-toast, .sg-power', e => e.map(x => { const r = x.getBoundingClientRect(); return { power: x.classList.contains('sg-power'), x: r.left, y: r.top, w: r.width, h: r.height }; }));
            keep['hero power'] = rects.find(r => r.power);
            const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            const toasts = rects.filter(r => !r.power);
            const covered = Object.keys(keep).filter(k => toasts.some(t => hit(t, keep[k])));
            step('the targeting hint shows over the board, off the heroes, the hero power, the hand and End Turn', toasts.length > 0 && covered.length === 0,
              covered.join(', ') || toasts.map(t => `${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.w)}x${Math.round(t.h)}`).join(' '));
          }
          const target = await hook('opponentHero()');
          await page.mouse.move(target.x, target.y, { steps: 4 }); await sleep(300);
          const armed = await page.$$eval('.sg-hint', e => e.map(x => x.textContent).join());
          await page.mouse.click(target.x, target.y);
          const ev = await waitFrame(f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t === 'heroPower'), from, 6000);
          if (ev) counts.powers++; else counts.refused++;
          await waitFrame(f => f.dir === 'in' && f.type === 236, from, 6000);
          await sleep(800);
          if (counts.powers === 1 && ev) {
            const left = await page.$$eval('.sg-hint', e => e.length);
            if (untargetedPower) step('the untargeted power is used without a targeting hint', !/pick a target/.test(armed) && left === 0, `hint: "${armed}", after: ${left}`);
            else step('the targeting hint shows while the power is armed and goes with the use', /pick a target/.test(armed) && left === 0, `armed: "${armed}", after: ${left}`);
          }
        }
      }
    };
    // Play affordable cards.
    const playCards = async () => {
      for (let k = 0; k < 4; k++) {
        const st = await hook('state()');
        if (!st || st.ended) break;
        const taken = new Set(st.board.map(b => b.slotId));
        const slot = [3, 2, 4, 1, 5, 0, 6].find(i => !taken.has(i));
        const pick = st.hand.findIndex(c => c.cost <= st.mana && !c.pending);
        if (pick < 0 || slot === undefined) break;
        const from = frames.length;
        await drag(await hook(`handCard(${pick})`), await hook(`slot(${slot})`));
        const used = await waitFrame(f => f.dir === 'in' && [207, 208, 202, 213, 232].includes(f.type), from, 6000);
        if (used && used.type === 207) counts.played++; else { counts.refused++; console.log('card refused:', JSON.stringify(used && { type: used.type, p: used.p }), JSON.stringify(st.hand), 'mana', st.mana); break; }
        await waitFrame(f => f.dir === 'in' && f.type === 236, from, 6000);
        await sleep(900);
        if (frames.slice(from).some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      }
    };
    // Until a card has been played, cards go first and the hero power gets the mana left (a strong bot can
    // end the game before the script ever plays a card otherwise).
    if (counts.played === 0) { await playCards(); await usePower(); } else { await usePower(); await playCards(); }

    // Cards act: abilities on sensible targets, the rest attack (Taunt first).
    for (let k = 0; k < 8; k++) {
      sync = await hook('sync()');
      const st = await hook('state()');
      if (!sync || !st || st.ended || sync.current !== ident) break;
      const ready = (sync.board[ident] || []).filter(c => c.canAct);
      if (ready.length === 0) break;
      const card = ready[0];
      const enemy = sync.board[3 - ident] || [];
      const taunts = enemy.filter(c => c.taunt);
      const from = frames.length;
      const source = await hook(`boardCard(${card.cid})`);
      if (!source) break;
      const ability = card.ability && card.ability.id;
      let target = null, button = 'left';
      if ([1, 7].includes(ability)) { target = await hook('hero()'); button = 'right'; }
      else if (ability === 2) { const other = (sync.board[ident] || []).find(c => c.cid !== card.cid); if (other) { target = await hook(`boardCard(${other.cid})`); button = 'right'; } }
      else if (ability === 5 && enemy.length) { target = await hook(`opponentCard(${enemy[0].cid})`); button = 'right'; }
      else if (ability === 8 || ability === 18) { target = await hook('opponentHero()'); button = 'right'; }
      if (!target) target = taunts.length ? await hook(`opponentCard(${taunts[0].cid})`) : await hook('opponentHero()');
      if (counts.attacks === 0 && button === 'left') {
        await page.mouse.move(source.x, source.y, { steps: 3 }); await sleep(250);
        await page.mouse.down(); await sleep(200);
        await page.mouse.move(target.x, target.y, { steps: 10 }); await sleep(600);
        await snap('attack-arrow');
        await page.mouse.up(); await sleep(300);
      } else {
        await drag(source, target, button);
      }
      const ev = await waitFrame(f => f.dir === 'in' && (f.type === 232 || (f.type === 235 && f.p.events.some(e => ['attack', 'ability'].includes(e.t)))), from, 6000);
      if (ev && ev.type === 235) { if (button === 'right') counts.abilities++; else counts.attacks++; }
      else { counts.refused++; break; }
      await waitFrame(f => f.dir === 'in' && f.type === 236, from, 6000);
      await sleep(1600);
      if (frames.slice(from).some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
    }
    result = frames.find(f => f.dir === 'in' && RESULT.includes(f.type));
    if (result || !(await hook('state()'))) break;

    // Hero attack, then end the turn.
    sync = await hook('sync()');
    if (sync && sync.heroes[ident].canAttack && sync.current === ident) {
      const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
      const weak = (sync.board[3 - ident] || []).filter(c => c.attack <= 2);
      const target = taunts.length ? await hook(`opponentCard(${taunts[0].cid})`) : weak.length ? await hook(`opponentCard(${weak[0].cid})`) : await hook('opponentHero()');
      const from = frames.length;
      await drag(await hook('hero()'), target);
      const ev = await waitFrame(f => f.dir === 'in' && (f.type === 232 || f.type === 235), from, 6000);
      if (ev && ev.type === 235) counts.attacks++;
      await sleep(1500);
    }
    result = frames.find(f => f.dir === 'in' && RESULT.includes(f.type));
    if (result) break;
    if (turn === 2) {
      // Tooltip over the enemy hero.
      const h = await hook('opponentHero()');
      await page.mouse.move(h.x, h.y, { steps: 3 }); await sleep(700);
      const tip = await hook('tooltip()');
      step('tooltip explains the enemy hero', !!tip && /Hero power/.test(tip), (tip || '').slice(0, 90));
      await snap('tooltip');
    }
    const from = frames.length;
    const sign = await hook('endTurn()');
    await page.mouse.click(sign.x, sign.y);
    await waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 8000);
    if (turn === 3) await snap('mid-game');
  }

  result = result || await waitFrame(f => f.dir === 'in' && RESULT.includes(f.type), 0, 60000);
  step('game ends with a result', !!result, result ? `${{ 230: 'Victory', 231: 'Defeat', 233: 'Draw' }[result.type]}: ${JSON.stringify(result.p).slice(0, 300)}` : 'none');
  step('result has rewards and quests', !!result && typeof result.p.coins === 'number' && Array.isArray(result.p.quests) && result.p.quests.length === 3);
  console.log('counts', JSON.stringify(counts));
  step('played cards, attacked, used the hero power', counts.played > 0 && counts.attacks > 0 && counts.powers > 0, JSON.stringify(counts));
  const evTypes = new Set(frames.filter(f => f.dir === 'in' && f.type === 235).flatMap(f => f.p.events.map(e => e.t)));
  console.log('event types seen:', [...evTypes].join(', '));
  const log = await hook('log()').catch(() => []);
  step('battle log has lines', log.length > 5, `${log.length} lines, last: ${log.slice(-2).join(' | ')}`);
  // Read the overlap record now: the end screen moves on to the statistics page by itself after a countdown.
  const overlaps = await page.evaluate(() => window.__overlaps).catch(() => null) || [];
  await sleep(2500);
  await snap('end');
  step('transitions never overlap (one full-screen layer at a time, no banner or tooltip over one)', overlaps.length === 0, overlaps.slice(0, 4).join(' | '));
  step('no console errors in the game', problems.length === 0, problems.slice(0, 5).join(' || '));

  if (result && result.p.statistics) {
    const id = result.p.statistics;
    await page.goto(`${base}/Game/Stats/${id}`).catch(() => {}); await sleep(1500);
    const statsText = await page.textContent('body');
    step('stats page shows the game and a replay link', /Practice game/.test(statsText) && (await page.$('a[href*="/Game/Replay/"]')) !== null);
    await snap('stats');
    problems.length = 0;
    await page.goto(`${base}/Game/Replay/${id}`, { waitUntil: 'domcontentloaded' });
    const replayed = await page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 90000 }).then(() => true).catch(() => false);
    step('replay starts in 3D', replayed);
    await sleep(8000);
    await snap('replay');
    const rs = await hook('state()').catch(() => null);
    step('replay shows both boards as a spectator', !!rs && rs.spectator && rs.mode === 'replay', JSON.stringify(rs && { board: rs.board.length, opp: rs.opponentBoard.length, hand: rs.hand.length }));
    step('no console errors in the replay', problems.length === 0, problems.slice(0, 5).join(' || '));
  }

  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(s => s.ok).length}/${steps.length} passed`);
  if (steps.some(s => !s.ok)) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
