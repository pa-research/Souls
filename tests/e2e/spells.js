// Spells end to end. The admin makes four spells starter cards in the card editor (and puts them back at the end); fresh
// players pick them, find them in the shop and the deck builder, and cast them from the hand against the Easy bot:
// in the 3D client (an arrow from the hand onto the enemy hero, a spell without a target dropped over the board)
// watched by a spectator, in the classic client, and on a phone (tap the spell, then tap the target).
// Usage: node spells.js <base> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'spells';
fs.mkdirSync(out, { recursive: true });
const adminPassword = process.env.SOULS_ADMIN_PASSWORD
  || fs.readFileSync(path.join(__dirname, '../../deploy/compose/secrets/Souls__Admin__Password'), 'utf8').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];
// Soul Rend and Blood Lance burn an enemy card or hero, Revelation draws (no target), Sacred Shield is in the deck too.
const SPELLS = [60, 63, 66, 67];
const BURN = 8, INSIGHT = 14;

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let shot = 0;

  async function session(label, options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, ...options });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    const s = { label, page, frames: [], problems: [] };
    page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) s.problems.push(m.text()); });
    page.on('pageerror', e => s.problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
    page.on('websocket', ws => {
      if (!ws.url().endsWith('/game')) return;
      ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'in', type: j.Type, p: j.Payload }); } catch (e) {} });
      ws.on('framesent', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'out', type: j.Type, p: j.Payload }); } catch (e) {} });
    });
    s.waitFrame = async (pred, from = 0, timeout = 15000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { for (let i = from; i < s.frames.length; i++) if (pred(s.frames[i])) return s.frames[i]; await sleep(100); }
      return null;
    };
    s.snap = async name => {
      try { await page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${label}-${name}.jpg`, type: 'jpeg', quality: 78, timeout: 90000 }); } catch (e) { console.log('(screenshot skipped)'); }
    };
    return s;
  }

  async function login(page, name, password) {
    await page.goto(base + '/Player/Login');
    await page.fill('#Name', name); await page.fill('#Password', password); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  }

  async function register(page, name, spells) {
    await page.goto(base + '/Player/Register');
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check('#type-1');
    for (const id of spells) await page.check(`#card-${id}`);
    for (const box of await page.$$('input.cards')) {
      if ((await page.$$('input.cards:checked')).length >= 5) break;
      if (!(await box.isChecked())) await box.check();
    }
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await login(page, name, 'CorrectHorse9!');
  }

  /** Starter cards are level 1 in the card editor. */
  async function setLevel(page, id, level) {
    await page.goto(`${base}/Admin/CardEditor/${id}`);
    await page.fill('#Card_Level', String(level));
    await page.click('#card-form button[type=submit]');
    await page.waitForLoadState('domcontentloaded');
    return (await page.textContent('body')).includes('Saved');
  }

  async function startPractice(s, mode) {
    await s.page.goto(`${base}/Game?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await s.page.waitForSelector('.sg-menu', { timeout: 180000 });
    await sleep(800);
    await s.page.click('.sg-menu-row .s-seg button >> nth=0'); // Easy
    await s.page.click('.sg-menu-btn >> nth=1');
    const created = await s.waitFrame(f => f.dir === 'in' && f.type === 206, 0, 90000);
    await s.page.waitForSelector('.sg-mulligan-confirm', { timeout: 60000 }); await sleep(1500);
    await s.page.click('.sg-mulligan-confirm');
    await s.waitFrame(f => f.dir === 'in' && f.type === 226, 0, 60000);
    await sleep(3000);
    return created ? created.p.ident : 1;
  }

  /** Waits for the player's turn; false when the game ended or it never came. */
  async function myTurn(s, ident, turnFrom) {
    const f = await s.waitFrame(x => x.dir === 'in' && ((x.type === 236 && x.p.current === ident) || RESULT.includes(x.type)), turnFrom, 180000);
    return !!f && f.type === 236;
  }

  /** The cast (224) of a spell and its events: the ability (or trigger) event comes from the spell's cid. */
  function castOf(s, from, cid) {
    const cast = s.frames.slice(from).find(f => f.dir === 'in' && f.type === 224 && f.p.card.cid === cid);
    const events = s.frames.slice(from).filter(f => f.dir === 'in' && f.type === 235).flatMap(f => f.p.events);
    return { cast, effect: events.find(e => ['ability', 'trigger'].includes(e.t) && e.src && e.src.cid === cid) };
  }

  // ---- The admin makes the two spells starter cards --------------------------------------------------------------
  const admin = await session('admin');
  await login(admin.page, 'admin', adminPassword);
  let saved = true;
  for (const spell of SPELLS) saved = (await setLevel(admin.page, spell, 1)) && saved;
  step('card editor saves spells as starter cards', saved);
  await admin.page.goto(`${base}/Admin/CardEditor/${SPELLS[0]}`);
  step('card editor shows the spell kind', (await admin.page.inputValue('#Card_Kind')) === '1');
  await admin.snap('card-editor');

  try {
    // ---- Shop and deck builder ---------------------------------------------------------------------------------
    const id = Date.now().toString(36);
    const A = await session('3d');
    await register(A.page, 'sa' + id, SPELLS);
    await A.page.goto(base + '/Shop');
    const shopSpells = await A.page.$$eval('.s-card.spell', els => els.length);
    step('the shop shows the spells with a spell frame', shopSpells >= 10 && (await A.page.$$eval('.s-card.spell .s-card-attack', e => e.length)) === 0, `${shopSpells} spell tiles`);
    await (await A.page.$('.s-card.spell')).scrollIntoViewIfNeeded();
    await A.snap('shop');
    await A.page.goto(base + '/Deck');
    const deckSpells = await A.page.$$eval('.s-card.spell', els => els.length);
    step('the deck builder shows the owned spells', deckSpells === SPELLS.length, `${deckSpells} spell tiles`);
    await A.snap('deck');

    // ---- 3D: cast both spells, watched by a spectator ------------------------------------------------------------
    const ident = await startPractice(A, '3d');
    const hook = expr => A.page.evaluate(`window.__souls3d.${expr}`);
    const C = await session('watch');
    await register(C.page, 'sc' + id, []);
    await C.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
    await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
    await C.page.click('.sg-menu-btn >> nth=2');
    await C.page.waitForSelector('.sg-game button', { timeout: 60000 });
    for (const row of await C.page.$$('.sg-game')) {
      if ((await row.textContent()).includes('sa' + id)) { await (await row.$('button')).click(); break; }
    }
    step('spectator joins the 3D game', !!(await C.waitFrame(f => f.dir === 'in' && f.type === 241, 0, 30000)));

    const drag = async (from, to) => {
      const page = A.page;
      await page.mouse.move(from.x, from.y, { steps: 3 }); await sleep(250);
      await page.mouse.down(); await sleep(200);
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
      await page.mouse.move(to.x, to.y, { steps: 8 }); await sleep(500);
    };
    const cast3d = {};
    let tooltip = false;
    for (let turn = 0, turnFrom = 0; turn < 10 && !(cast3d.burn && cast3d.insight); turn++) {
      if (!(await myTurn(A, ident, turnFrom))) break;
      await sleep(1500);
      for (let k = 0; k < 3; k++) {
        const st = await hook('state()');
        const index = st.hand.findIndex(c => c.spell && c.cost <= st.mana && !c.pending && (c.ability === BURN ? !cast3d.burn : c.ability === INSIGHT && !cast3d.insight));
        if (index < 0) break;
        const card = st.hand[index];
        if (!tooltip) {
          const at = await hook(`handCard(${index})`);
          await A.page.mouse.move(at.x, at.y, { steps: 3 }); await sleep(900);
          const tip = await hook('tooltip()');
          tooltip = true;
          step('a spell in the hand explains itself', !!tip && /Spell/.test(tip) && !/Attack/.test(tip), (tip || '').slice(0, 100));
          await A.snap('hand-spell');
        }
        const from = A.frames.length;
        const fromWatch = C.frames.length;
        // Burn: an arrow from the hand onto the enemy hero (it lights up); Insight: the card dropped over the board.
        await drag(await hook(`handCard(${index})`), card.ability === BURN ? await hook('opponentHero()') : await hook('slot(3)'));
        if (card.ability === BURN) await A.snap('targeting');
        await A.page.mouse.up(); await sleep(700);
        await A.snap(card.ability === BURN ? 'cast-burn' : 'cast-insight');
        await A.waitFrame(f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast, effect } = castOf(A, from, card.cid);
        const ok = !!cast && !!effect && (card.ability === BURN ? cast.p.target && cast.p.target.k === 'hero' : cast.p.target === null);
        step(`3D: ${card.name} is cast from the hand`, ok, cast ? `target ${JSON.stringify(cast.p.target)}, ${effect ? effect.t : 'no effect event'}` : 'no 224');
        if (card.ability === BURN) cast3d.burn = ok; else cast3d.insight = ok;
        const seen = await C.waitFrame(f => f.dir === 'in' && f.type === 224 && f.p.card.cid === card.cid, fromWatch, 8000);
        step(`spectator sees ${card.name} cast`, !!seen);
        if (seen && !cast3d.watched) { cast3d.watched = true; await sleep(300); await C.snap('spectator-cast'); }
        await sleep(1200);
        const st2 = await hook('state()');
        step(`3D: ${card.name} left the hand and the board`, !st2.hand.some(c => c.cid === card.cid) && !st2.board.some(c => c.cid === card.cid));
      }
      if (A.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      turnFrom = A.frames.length;
      const sign = await hook('endTurn()');
      await A.page.mouse.click(sign.x, sign.y);
      await A.waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    step('3D: both spells were cast', !!cast3d.burn && !!cast3d.insight);
    const botSpells = A.frames.filter(f => f.dir === 'in' && f.type === 225).map(f => f.p.card.name);
    console.log('bot spells seen in the 3D game:', botSpells.join(', ') || 'none');
    step('no console errors in the 3D game', A.problems.length === 0, A.problems.slice(0, 4).join(' || '));
    step('no console errors for the spectator', C.problems.length === 0, C.problems.slice(0, 4).join(' || '));
    await C.page.context().close();
    await A.page.context().close();

    // ---- Classic: drag the spells from the hand ---------------------------------------------------------------------
    const B = await session('classic');
    await register(B.page, 'sb' + id, SPELLS);
    const identB = await startPractice(B, 'classic');
    const at = async (gx, gy) => { const box = await (await B.page.$('canvas')).boundingBox(); return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 }; };
    const castClassic = {};
    for (let turn = 0, turnFrom = 0; turn < 10 && !(castClassic.burn && castClassic.insight); turn++) {
      if (!(await myTurn(B, identB, turnFrom))) break;
      await sleep(2500);
      for (let k = 0; k < 3; k++) {
        const sync = B.frames.filter(f => f.dir === 'in' && f.type === 236).pop();
        const mana = Number(sync.p.heroes[identB].mana);
        const spell = await B.page.evaluate(({ mana, done }) => {
          const hand = Object.values(window.gameEngine.player.cardManager.hand);
          const card = hand.find(c => c.spell && Number(c.cost) <= mana && [8, 14].includes(c.abilityId) && !done.includes(c.abilityId));
          // The next card covers all but the left strip of a hand card (as in classic_ui.js).
          const last = card && hand.every(c => c.position.originX <= card.position.originX);
          return card ? { cid: card.cid, ability: card.abilityId, name: card.name, x: card.position.originX - (last ? 0 : 45), y: card.position.originY } : null;
        }, { mana, done: [castClassic.burn ? BURN : -1, castClassic.insight ? INSIGHT : -1] });
        if (!spell) break;
        const from = B.frames.length;
        const a = await at(spell.x, spell.y), b = spell.ability === BURN ? await at(956, 141) : await at(960, 540);
        await B.page.mouse.move(a.x, a.y); await sleep(300); await B.page.mouse.down(); await sleep(200);
        await B.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await sleep(400);
        await B.page.mouse.move(b.x, b.y, { steps: 8 }); await sleep(500);
        if (spell.ability === BURN) await B.snap('targeting');
        await B.page.mouse.up(); await sleep(900);
        await B.snap(spell.ability === BURN ? 'cast-burn' : 'cast-insight');
        await B.waitFrame(f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast, effect } = castOf(B, from, spell.cid);
        const ok = !!cast && !!effect;
        step(`classic: ${spell.name || 'a spell'} is cast from the hand`, ok, cast ? `target ${JSON.stringify(cast.p.target)}` : 'no 224');
        if (spell.ability === BURN) castClassic.burn = ok; else castClassic.insight = ok;
        await sleep(1500);
      }
      if (B.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      turnFrom = B.frames.length;
      const end = await at(1608, 550);
      await B.page.mouse.click(end.x, end.y);
      await B.waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    step('classic: both spells were cast', !!castClassic.burn && !!castClassic.insight);
    step('no console errors in the classic game', B.problems.length === 0, B.problems.slice(0, 4).join(' || '));
    await B.page.context().close();

    // ---- Phone: tap the spell, then tap the target ----------------------------------------------------------------
    const D = await session('phone', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await register(D.page, 'sd' + id, SPELLS);
    const identD = await startPractice(D, '3d');
    const hookD = expr => D.page.evaluate(`window.__souls3d.${expr}`);
    let tapped = false;
    for (let turn = 0, turnFrom = 0; turn < 10 && !tapped; turn++) {
      if (!(await myTurn(D, identD, turnFrom))) break;
      await sleep(1500);
      const st = await hookD('state()');
      const index = st.hand.findIndex(c => c.spell && c.ability === BURN && c.cost <= st.mana);
      if (index >= 0) {
        const card = st.hand[index];
        const from = D.frames.length;
        const h = await hookD(`handCard(${index})`);
        await D.page.touchscreen.tap(h.x, h.y); await sleep(900);
        await D.snap('spell-armed');
        const target = await hookD('opponentHero()');
        await D.page.touchscreen.tap(target.x, target.y); await sleep(900);
        await D.snap('spell-cast');
        await D.waitFrame(f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast } = castOf(D, from, card.cid);
        tapped = true;
        step('phone: tap the spell, then the enemy hero, casts it', !!cast && cast.p.target && cast.p.target.k === 'hero', cast ? JSON.stringify(cast.p.target) : 'no 224');
        break;
      }
      turnFrom = D.frames.length;
      const sign = await hookD('endTurn()');
      await D.page.touchscreen.tap(sign.x, sign.y);
      await D.waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    step('phone: a spell came up to tap', tapped);
    step('no console errors on the phone', D.problems.length === 0, D.problems.slice(0, 4).join(' || '));
  } finally {
    // Spells are not starter cards.
    let restored = true;
    for (const spell of SPELLS) restored = (await setLevel(admin.page, spell, 2)) && restored;
    step('card editor puts the spells back', restored);
  }

  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(s => s.ok).length}/${steps.length} passed`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
