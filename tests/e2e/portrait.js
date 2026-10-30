// The 3D client on a phone held upright (412x915, touch), played to the end by touch against the Easy bot. The admin
// makes the two burn spells starter cards (and puts them back at the end) so they come up in the hand.
// Checks the portrait layout in every camera view and after turning the phone (hand cards wide enough, nothing over the
// board or the hand), then plays: creatures dragged onto slots, a spell tapped and then its target, a spell's arrow
// dragged from the hand, the hero power, attacks dragged onto the enemy, End Turn tapped; tooltips stay on screen.
// Usage: node portrait.js <base> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'portrait';
fs.mkdirSync(out, { recursive: true });
const adminPassword = process.env.SOULS_ADMIN_PASSWORD
  || fs.readFileSync(path.join(__dirname, '../../deploy/compose/secrets/Souls__Admin__Password'), 'utf8').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];
const SPELLS = [60, 63]; // Soul Rend, Blood Lance
const BURN = 8;
const PHONE = { width: 412, height: 915 };
// The card frame art fills about 0.82 of a card's width: 86 px cards show 70 px of card.
const MIN_CARD = 86;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const admin = await adminCtx.newPage();
  admin.setDefaultTimeout(120000);
  const login = async (page, name, password) => {
    await page.goto(base + '/Player/Login');
    await page.fill('#Name', name); await page.fill('#Password', password); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  };
  const setLevel = async (id, level) => {
    await admin.goto(`${base}/Admin/CardEditor/${id}`);
    await admin.fill('#Card_Level', String(level));
    await admin.click('#card-form button[type=submit]');
    await admin.waitForLoadState('domcontentloaded');
    return (await admin.textContent('body')).includes('Saved');
  };
  await login(admin, 'admin', adminPassword);
  let saved = true;
  for (const spell of SPELLS) saved = (await setLevel(spell, 1)) && saved;
  step('card editor saves spells as starter cards', saved);

  try {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    const problems = [];
    page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
    const frames = [];
    page.on('websocket', ws => {
      if (!ws.url().endsWith('/game')) return;
      ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'in', type: j.Type, p: j.Payload }); } catch (e) {} });
      ws.on('framesent', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'out', type: j.Type, p: j.Payload }); } catch (e) {} });
    });
    const waitFrame = async (pred, from = 0, timeout = 15000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { for (let i = from; i < frames.length; i++) if (pred(frames[i])) return frames[i]; await sleep(100); }
      return null;
    };
    let shot = 0;
    const snap = async name => {
      try { await page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 80, scale: 'css', timeout: 90000 }); } catch (e) { console.log('(screenshot skipped)'); }
    };
    const hook = expr => page.evaluate(`window.__souls3d.${expr}`);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : [] });
    const tap = p => page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
    // A finger from a to b; `before` runs while it is still down (screenshots of arrows), then it lifts.
    const drag = async (a, b, before) => {
      await touch('touchStart', a); await sleep(80);
      for (let i = 1; i <= 12; i++) { await touch('touchMove', { x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 }); await sleep(35); }
      await sleep(350);
      if (before) await before();
      await touch('touchEnd'); await sleep(250);
    };

    // Everything the layout check needs, measured in the page.
    const measure = () => page.evaluate(() => {
      const h = window.__souls3d;
      const rect = sel => {
        const e = document.querySelector(sel);
        if (!e || e.closest('[hidden]')) return null;
        const b = e.getBoundingClientRect();
        return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height, name: sel } : null;
      };
      const n = h.state().hand.length;
      return {
        layout: h.layout(),
        hand: Array.from({ length: n }, (_, i) => h.handRect(i)),
        heroes: [h.heroRect(false), h.heroRect(true)],
        slots: [0, 1, 2, 3, 4, 5, 6].map(i => h.slot(i)),
        endTurn: h.endTurn(),
        dom: ['.souls3d-log', '.souls3d-chat', '.souls3d-views', '.game-mode-switch', '.souls3d-status', '#souls3d .sg-fuse', '#souls3d .sg-power',
          '.souls3d-banner', '.souls3d-replay'].map(rect).filter(Boolean),
      };
    });
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const inside = (p, r, slack = 0) => p.x >= r.x - slack && p.x <= r.x + r.w + slack && p.y >= r.y - slack && p.y <= r.y + r.h + slack;
    /** The portrait layout: hand cards wide enough in their band, the board in its band, no controls over either. */
    const checkLayout = async label => {
      const m = await measure();
      const { bands, width, height } = m.layout;
      if (!m.layout.portrait || !bands) { step(`${label}: portrait layout`, false, JSON.stringify(m.layout)); return; }
      const board = { x: 0, y: bands.board[0], w: width, h: bands.board[1] - bands.board[0] };
      const handBand = { x: 0, y: bands.hand[0], w: width, h: bands.hand[1] - bands.hand[0] };
      const bad = [];
      for (const [i, r] of m.hand.entries()) {
        if (r.w < MIN_CARD) bad.push(`card ${i} is ${Math.round(r.w)} px wide`);
        if (!inside({ x: r.x, y: r.y }, handBand, 3) || !inside({ x: r.x + r.w, y: r.y + r.h }, handBand, 3)) bad.push(`card ${i} outside the hand band`);
      }
      for (const [i, r] of m.heroes.entries()) if (!inside({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, board)) bad.push(`hero ${i} outside the board band`);
      for (const [i, p] of m.slots.entries()) if (!inside(p, board)) bad.push(`slot ${i} outside the board band`);
      for (const d of m.dom) {
        const own = d.name === '#souls3d .sg-power';
        if (!own && overlap(d, board)) bad.push(`${d.name} over the board`);
        for (const [i, r] of m.hand.entries()) if (overlap(d, r)) bad.push(`${d.name} over hand card ${i}`);
        for (const [i, r] of m.heroes.entries()) if (overlap(d, { x: r.x + r.w * 0.2, y: r.y + r.h * 0.2, w: r.w * 0.6, h: r.h * 0.6 })) bad.push(`${d.name} over hero ${i}`);
        if (d.x < 0 || d.y < 0 || d.x + d.w > width + 1 || d.y + d.h > height + 1) bad.push(`${d.name} off the screen`);
      }
      if (!inside(m.endTurn, { x: 0, y: bands.action[0], w: width, h: bands.action[1] - bands.action[0] })) bad.push('End Turn outside its row');
      const widths = m.hand.map(r => Math.round(r.w)).join('/');
      step(`${label}: hand cards ${widths} px, board and hand clear of the controls`, bad.length === 0, bad.slice(0, 5).join('; '));
    };
    const tooltipOnScreen = () => page.evaluate(() => {
      const t = document.querySelector('.sg-tip');
      if (!t || t.hidden) return null;
      const b = t.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height, on: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight };
    });

    // ---- Into a practice game ----------------------------------------------------------------------------------
    const name = 'po' + Date.now().toString(36);
    await page.goto(base + '/Player/Register');
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check('#type-1');
    for (const id of SPELLS) await page.check(`#card-${id}`);
    for (const box of await page.$$('input.cards')) {
      if ((await page.$$('input.cards:checked')).length >= 5) break;
      if (!(await box.isChecked())) await box.check();
    }
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await login(page, name, 'CorrectHorse9!');
    await page.goto(`${base}/Game?mode=3d`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sg-menu', { timeout: 180000 });
    await sleep(800);
    await page.click('.sg-menu-row .s-seg button >> nth=0'); // Easy
    await page.click('.sg-menu-btn >> nth=1');
    const created = await waitFrame(f => f.dir === 'in' && f.type === 206, 0, 90000);
    const ident = created ? created.p.ident : 1;
    await page.waitForSelector('.sg-mulligan-confirm', { timeout: 60000 }); await sleep(1500);
    await snap('mulligan');
    await page.click('.sg-mulligan-confirm');

    const myTurn = async from => {
      const f = await waitFrame(x => x.dir === 'in' && ((x.type === 236 && x.p.current === ident) || RESULT.includes(x.type)), from, 240000);
      if (!f || f.type !== 236) return false;
      return page.waitForFunction(() => window.__souls3d.state().yourTurn, null, { timeout: 60000, polling: 300 }).then(() => true, () => false);
    };
    step('the first turn comes', await myTurn(0));
    await sleep(2500);
    for (const view of ['classic', 'arena', 'field', 'cinematic']) {
      await hook(`view('${view}')`); await sleep(2600);
      await snap(`view-${view}`);
      await checkLayout(`${view} view`);
    }
    await hook(`view('arena')`); await sleep(2200);

    // Turning the phone: the landscape layout, then the portrait one again.
    await page.setViewportSize({ width: PHONE.height, height: PHONE.width }); await sleep(1500);
    const turned = await hook('layout()');
    const sign = await hook('endTurn()');
    step('turned sideways: the landscape layout', !turned.portrait && turned.width === PHONE.height && sign.x > PHONE.height * 0.6, JSON.stringify({ portrait: turned.portrait, sign }));
    await snap('landscape');
    await page.setViewportSize(PHONE); await sleep(1500);
    await checkLayout('upright again');

    // A tap on a hand card zooms it, its rules above it; another tap closes it.
    {
      const st = await hook('state()');
      const i = st.hand.findIndex(c => !c.spell);
      if (i >= 0) {
        await tap(await hook(`handCard(${i})`)); await sleep(800);
        const zoomed = await hook('hoveredRect()');
        const tip = await tooltipOnScreen();
        step('tap a hand card: it zooms, on the screen, its rules above it', !!zoomed && zoomed.x >= 0 && zoomed.x + zoomed.w <= PHONE.width && zoomed.y >= 0
          && !!tip && tip.on && tip.y + tip.h <= zoomed.y + 2, JSON.stringify({ zoomed, tip }));
        await snap('card-zoom');
        await tap(await hook(`handCard(${i})`)); await sleep(600);
        step('another tap puts it back', (await hook('hovered()')) === null && !(await tooltipOnScreen()));
        // Held: zoomed while the finger is down.
        const at = await hook(`handCard(${i})`);
        await touch('touchStart', at); await sleep(700);
        const held = await hook('hoveredRect()');
        step('hold a hand card: it zooms on the screen', !!held && held.y >= 0 && held.y + held.h <= PHONE.height, JSON.stringify(held));
        await touch('touchEnd'); await sleep(500);
      }
    }
    // A tap on the enemy hero explains it, on the screen.
    await tap(await hook('opponentHero()')); await sleep(700);
    const heroTip = await tooltipOnScreen();
    step('tap the enemy hero: its tooltip is on the screen', !!heroTip && heroTip.on, JSON.stringify(heroTip));
    await tap({ x: PHONE.width / 2, y: (await hook('layout()')).bands.board[0] + 20 }); await sleep(400);

    // ---- Play by touch until the game ends ----------------------------------------------------------------------
    const done = { turns: 0, played: 0, tapCast: false, dragCast: false, power: false, attacks: 0, ended: null };
    let turnFrom = 0;
    for (let turn = 0; turn < 45; turn++) {
      if (turn > 0 && !(await myTurn(turnFrom))) break;
      done.turns++;
      await sleep(1800);
      // Spells: the first burn is tapped and then the enemy hero tapped; the next one's arrow is dragged from the hand.
      for (let k = 0; k < 2; k++) {
        const st = await hook('state()');
        const i = st.hand.findIndex(c => c.spell && c.ability === BURN && c.cost <= st.mana && !c.pending);
        if (i < 0 || (done.tapCast && done.dragCast)) break;
        const card = st.hand[i];
        const from = frames.length;
        if (!done.tapCast) {
          await tap(await hook(`handCard(${i})`)); await sleep(800);
          const hint = await page.$$eval('.sg-hint', e => e.map(x => x.textContent).join());
          await snap('spell-armed');
          await tap(await hook('opponentHero()')); await sleep(800);
          const cast = await waitFrame(f => f.dir === 'in' && f.type === 224 && f.p.card.cid === card.cid, from, 8000);
          done.tapCast = !!cast && cast.p.target && cast.p.target.k === 'hero';
          step('tap a spell, then the enemy hero: it is cast on the hero', done.tapCast && /pick a target/.test(hint), `hint "${hint}"`);
        } else {
          await drag(await hook(`handCard(${i})`), await hook('opponentHero()'), () => snap('spell-arrow'));
          const cast = await waitFrame(f => f.dir === 'in' && f.type === 224 && f.p.card.cid === card.cid, from, 8000);
          done.dragCast = !!cast && cast.p.target && cast.p.target.k === 'hero';
          step('drag a spell\'s arrow from the hand onto the enemy hero: it is cast', done.dragCast, cast ? JSON.stringify(cast.p.target) : 'no 224');
        }
        await sleep(1500);
      }
      // Creatures: dragged onto free slots while the mana lasts.
      for (let k = 0; k < 4; k++) {
        const st = await hook('state()');
        const i = st.hand.findIndex(c => !c.spell && c.cost <= st.mana && !c.pending);
        const used = new Set(st.board.map(c => c.slotId));
        const slot = [3, 2, 4, 1, 5, 0, 6].find(s => !used.has(s));
        if (i < 0 || slot === undefined) break;
        const from = frames.length;
        await drag(await hook(`handCard(${i})`), await hook(`slot(${slot})`), done.played === 0 ? () => snap('drag-card') : null);
        const ok = await waitFrame(f => f.dir === 'in' && f.type === 207, from, 8000);
        if (!ok) { step(`drag ${st.hand[i].name} onto slot ${slot}`, false); break; }
        done.played++;
        await sleep(1500);
      }
      // The hero power: tap the button, then the enemy hero (or an enemy card).
      const power = await hook('power()');
      if (!done.power && power && !power.disabled) {
        const from = frames.length;
        await tap(power); await sleep(700);
        await snap('power-armed');
        await tap(await hook('opponentHero()')); await sleep(700);
        let used = await waitFrame(f => f.dir === 'out' && f.type === 206, from, 2000);
        const enemy = (await hook('state()')).opponentBoard[0];
        if (!used && enemy) {
          await tap(await hook('power()')); await sleep(500);
          await tap(await hook(`opponentCard(${enemy.cid})`)); await sleep(700);
          used = await waitFrame(f => f.dir === 'out' && f.type === 206, from, 2000);
        }
        done.power = !!used;
        if (used) step('tap the hero power, then a target: it is used', true, JSON.stringify(used.p));
        await page.keyboard.press('Escape');
        await sleep(1200);
      }
      // Attacks: every board card is dragged onto a taunt card or the enemy hero (cards that cannot attack yet do nothing).
      for (const c of (await hook('state()')).board) {
        const st = await hook('state()');
        if (st.ended || !st.board.some(b => b.cid === c.cid)) continue;
        const taunt = st.opponentBoard.find(o => o.taunt);
        const target = taunt ? await hook(`opponentCard(${taunt.cid})`) : await hook('opponentHero()');
        const from = frames.length;
        await drag(await hook(`boardCard(${c.cid})`), target, done.attacks === 0 ? () => snap('attack') : null);
        if (await waitFrame(f => f.dir === 'out' && f.type === 200, from, 1500)) done.attacks++;
        await sleep(1300);
      }
      if (frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      turnFrom = frames.length;
      await tap(await hook('endTurn()'));
      if (!(await waitFrame(f => f.dir === 'out' && f.type === 226, turnFrom, 5000)) && !frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) {
        step(`tap End Turn (turn ${turn + 1})`, false);
        break;
      }
    }
    const result = frames.find(f => f.dir === 'in' && RESULT.includes(f.type));
    done.ended = result ? { 230: 'victory', 231: 'defeat', 233: 'draw' }[result.type] : null;
    step('creatures dragged from the hand onto the board', done.played > 0, `${done.played} played`);
    step('attacks dragged onto the enemy', done.attacks > 0, `${done.attacks} attacks`);
    step('the hero power was used by touch', done.power);
    step('a spell came up and was cast by touch', done.tapCast, done.dragCast ? 'tapped and dragged' : 'tapped');
    step('the game was played to the end upright', !!done.ended, `${done.ended || 'no result'} after ${done.turns} turns`);
    if (done.ended) {
      await page.waitForSelector('.souls3d-end', { timeout: 30000 }).catch(() => {});
      await sleep(3000);
      await snap('end');
    }
    step('no console errors', problems.length === 0, problems.slice(0, 4).join(' || '));

    // The replay upright: a spectator's layout (no End Turn; the replay controls and the spectator bar in their places).
    if (result && result.p.statistics) {
      problems.length = 0;
      await page.goto(`${base}/Game/Replay/${result.p.statistics}`, { waitUntil: 'domcontentloaded' });
      const replayed = await page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 90000 }).then(() => true, () => false);
      step('the replay starts upright', replayed);
      await sleep(8000);
      await snap('replay');
      if (replayed) await checkLayout('replay');
      step('no console errors in the replay', problems.length === 0, problems.slice(0, 4).join(' || '));
    }
  } finally {
    let restored = true;
    for (const spell of SPELLS) restored = (await setLevel(spell, 2)) && restored;
    step('card editor puts the spells back', restored);
  }
  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(s => s.ok).length}/${steps.length} passed`);
  await browser.close();
  process.exit(steps.every(s => s.ok) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
