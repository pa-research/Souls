// Hero choice end to end. A fresh Lurker picks its second hero power (Blood Gift) on the Deck page, finds only its own
// class's cards in the shop, and uses Blood Gift on its own card against the Easy bot: in the 3D client (watched by a
// spectator, who sees the power) and in the classic client. A Harrison sees Harrison's cards instead.
// Usage: node hero_choice.js <base> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'hero_choice';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const RESULT = [230, 231, 233];
const LURKER = 2, HARRISON = 3, DRAIN = 2, BLOOD_GIFT = 6;
const CLASS_CARDS = { [LURKER]: [72, 73], [HARRISON]: [74, 75] };
const ALL_CLASS_CARDS = [70, 71, 72, 73, 74, 75, 76, 77];
// Cheap starter cards, so a card is on the board from the first turn: Bobby, Gloom Imp, Acolyte of Dawn, Wolf Pup
// (1 mana) and Blood Thrall (2).
const CHEAP = [6, 20, 40, 50, 31];

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
    s.lastSync = () => s.frames.filter(f => f.dir === 'in' && f.type === 236).pop();
    return s;
  }

  async function login(page, name) {
    await page.goto(base + '/Player/Login');
    await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  }

  async function register(page, name, type, cards) {
    await page.goto(base + '/Player/Register');
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check(`#type-${type}`);
    for (const id of cards) await page.check(`#card-${id}`);
    for (const box of await page.$$('input.cards')) {
      if ((await page.$$('input.cards:checked')).length >= 5) break;
      if (!(await box.isChecked())) await box.check();
    }
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await login(page, name);
  }

  /** The class cards the shop offers (data-class on the tiles) and whether exactly the class's own are there. */
  async function shopClassCards(s, type) {
    await s.page.goto(base + '/Shop');
    const ids = await s.page.$$eval('.s-shop-grid article[data-class]:not([data-class=""]) .s-card', els => els.map(e => Number(e.id.replace('card_', ''))));
    const own = CLASS_CARDS[type];
    return { ids, ok: ids.length === own.length && own.every(id => ids.includes(id)) && ids.every(id => !ALL_CLASS_CARDS.filter(c => !own.includes(c)).includes(id)) };
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
    return created;
  }

  /** Waits for the player's turn, in the socket and in the client (it plays the messages with their animations and may lag behind). */
  async function myTurn(s, ident, turnFrom) {
    const f = await s.waitFrame(x => x.dir === 'in' && ((x.type === 236 && x.p.current === ident) || RESULT.includes(x.type)), turnFrom, 180000);
    if (!f || f.type !== 236) return false;
    return s.page.waitForFunction(() => window.__souls3d ? window.__souls3d.state().yourTurn : !!(window.gameEngine && window.gameEngine.myTurn),
      null, { timeout: 60000, polling: 300 }).then(() => true, () => false);
  }

  /** The heroPower event of a power use (and the buff it gave) after frame <from>. */
  function powerUse(s, from) {
    const events = s.frames.slice(from).filter(f => f.dir === 'in' && f.type === 235).flatMap(f => f.p.events);
    const used = events.find(e => e.t === 'heroPower');
    return { used, buff: used && events.find(e => e.t === 'buff' && used.dst && e.to.cid === used.dst.cid) };
  }

  const id = Date.now().toString(36);
  const name = 'hl' + id;

  // ---- Deck page: pick the second power ----------------------------------------------------------------------------
  const A = await session('3d');
  await register(A.page, name, LURKER, CHEAP);
  await A.page.goto(base + '/Deck');
  step('deck page offers the class\'s two powers, the old one picked',
    await A.page.isChecked(`#power-${DRAIN}`) && !!(await A.page.$(`#power-${BLOOD_GIFT}`)) && (await A.page.$$('#power-form input[name=power]')).length === 2);
  await A.page.check(`#power-${BLOOD_GIFT}`);
  await A.page.click('#power-save');
  await A.page.waitForLoadState('domcontentloaded');
  const deckText = await A.page.textContent('body');
  step('Blood Gift is saved as the hero power', await A.page.isChecked(`#power-${BLOOD_GIFT}`) && deckText.includes('You play with Blood Gift'));
  await A.snap('deck-power');

  const lurkerShop = await shopClassCards(A, LURKER);
  step('the shop shows the Lurker\'s class cards and no other class\'s', lurkerShop.ok, JSON.stringify(lurkerShop.ids));
  await (await A.page.$('article[data-class="Lurker"]')).scrollIntoViewIfNeeded();
  await A.snap('shop-lurker');

  // ---- 3D game, watched by a Harrison ----------------------------------------------------------------------------
  const created = await startPractice(A, '3d');
  const ident = created ? created.p.ident : 1;
  step('3D: the game starts with Blood Gift', !!created && created.p.player.info.power === BLOOD_GIFT, created && `power ${created.p.player.info.power}`);
  const hook = expr => A.page.evaluate(`window.__souls3d.${expr}`);
  step('3D: the power button shows Blood Gift', (await A.page.textContent('.sg-power-name').catch(() => '')) === 'Blood Gift');

  const C = await session('watch');
  await register(C.page, 'hh' + id, HARRISON, []);
  const harrisonShop = await shopClassCards(C, HARRISON);
  step('the shop shows a Harrison only Harrison\'s class cards and no other class\'s', harrisonShop.ok, JSON.stringify(harrisonShop.ids));
  await C.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
  await C.page.click('.sg-menu-btn:has-text("Watch live")');
  await C.page.waitForSelector('.sg-game button', { timeout: 60000 });
  for (const row of await C.page.$$('.sg-game')) {
    if ((await row.textContent()).includes(name)) { await (await row.$('button')).click(); break; }
  }
  const watching = await C.waitFrame(f => f.dir === 'in' && f.type === 241, 0, 30000);
  const watchedInfo = watching && [watching.p.player.info, watching.p.opponent.info].find(i => i.name === name);
  step('spectator joins and sees the Lurker\'s power', !!watchedInfo && watchedInfo.power === BLOOD_GIFT, watchedInfo && `power ${watchedInfo.power}`);

  const drag = async (from, to) => {
    await A.page.mouse.move(from.x, from.y, { steps: 3 }); await sleep(250);
    await A.page.mouse.down(); await sleep(200);
    await A.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
    await A.page.mouse.move(to.x, to.y, { steps: 8 }); await sleep(500);
    await A.page.mouse.up(); await sleep(700);
  };
  let used3d = false;
  for (let turn = 0, turnFrom = 0; turn < 8 && !used3d; turn++) {
    if (!(await myTurn(A, ident, turnFrom))) break;
    await sleep(1500);
    let st = await hook('state()');
    // A card on the board first (the cheapest one that fits the mana, leaving 2 for the power when there is a card).
    if (st.board.length === 0) {
      const index = st.hand.reduce((best, c, i) => (!c.spell && c.cost <= st.mana && (best < 0 || c.cost < st.hand[best].cost) ? i : best), -1);
      if (index >= 0) {
        const from = A.frames.length;
        await drag(await hook(`handCard(${index})`), await hook('slot(3)'));
        await A.waitFrame(f => f.dir === 'in' && f.type === 236, from, 10000);
        await sleep(1500);
        st = await hook('state()');
      }
    }
    const sync = A.lastSync();
    if (st.board.length > 0 && sync && sync.p.heroes[ident].canUsePower) {
      const power = await hook('power()');
      await A.page.mouse.move(power.x, power.y, { steps: 3 }); await sleep(900);
      const tip = await hook('tooltip()');
      step('3D: the power\'s tooltip explains Blood Gift', !!tip && tip.includes('Blood Gift') && tip.includes('friendly card'), (tip || '').slice(0, 120));
      const from = A.frames.length, fromWatch = C.frames.length;
      await A.page.mouse.click(power.x, power.y); await sleep(700);
      await A.snap('power-armed');
      const target = await hook(`boardCard(${st.board[0].cid})`);
      await A.page.mouse.click(target.x, target.y); await sleep(1200);
      await A.snap('power-used');
      await A.waitFrame(f => f.dir === 'in' && f.type === 236, from, 10000);
      const { used, buff } = powerUse(A, from);
      used3d = !!used && used.power === BLOOD_GIFT && !!buff;
      step('3D: Blood Gift buffs the own card', used3d, used ? `${used.name} on ${JSON.stringify(used.dst)}, buff ${buff ? `${buff.attack}/${buff.health}` : 'missing'}` : 'no heroPower event');
      const seen = await C.waitFrame(f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t === 'heroPower' && e.power === BLOOD_GIFT), fromWatch, 10000);
      step('spectator sees Blood Gift used', !!seen);
      await sleep(600);
      await C.snap('spectator-power');
      break;
    }
    if (A.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
    turnFrom = A.frames.length;
    const sign = await hook('endTurn()');
    await A.page.mouse.click(sign.x, sign.y);
    await A.waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
  }
  step('3D: Blood Gift was used', used3d);
  step('no console errors in the 3D game', A.problems.length === 0, A.problems.slice(0, 4).join(' || '));
  step('no console errors for the spectator', C.problems.length === 0, C.problems.slice(0, 4).join(' || '));
  await C.page.context().close();
  await A.page.context().close();

  // ---- Classic game, same player -------------------------------------------------------------------------------------
  const B = await session('classic');
  await login(B.page, name);
  const createdB = await startPractice(B, 'classic');
  const identB = createdB ? createdB.p.ident : 1;
  step('classic: the game starts with Blood Gift', !!createdB && createdB.p.player.info.power === BLOOD_GIFT);
  step('classic: the power button shows Blood Gift', (await B.page.textContent('.souls-classic-power-own .sg-power-name').catch(() => '')) === 'Blood Gift');
  const at = async (gx, gy) => { const box = await (await B.page.$('canvas')).boundingBox(); return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 }; };
  const boardCard = () => B.page.evaluate(() => {
    const c = Object.values(window.gameEngine.player.cardManager.board)[0];
    return c ? { cid: c.cid, x: c.x, y: c.y } : null;
  });
  let usedClassic = false;
  for (let turn = 0, turnFrom = 0; turn < 8 && !usedClassic; turn++) {
    if (!(await myTurn(B, identB, turnFrom))) break;
    await sleep(2500);
    if (!(await boardCard())) {
      // Overlapping hand cards: try them from the left until one is played.
      const handSize = B.lastSync()?.p.heroes[identB].hand ?? 1;
      for (let k = 0; k < handSize; k++) {
        const from = B.frames.length;
        const last = k === handSize - 1;
        const a = await at(165 + 60 * k + (last ? 0 : -45), 980), b = await at(520 + 147.7 * 3, 700);
        await B.page.mouse.move(a.x, a.y); await sleep(300); await B.page.mouse.down(); await sleep(200);
        await B.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await sleep(400);
        await B.page.mouse.move(b.x, b.y, { steps: 8 }); await sleep(400); await B.page.mouse.up(); await sleep(300);
        const answer = await B.waitFrame(f => f.dir === 'in' && [207, 208, 213, 224].includes(f.type), from, 6000);
        if (answer && answer.type === 207) break;
        await sleep(800);
      }
      await B.waitFrame(f => f.dir === 'in' && f.type === 236, B.frames.length - 1, 8000);
      await sleep(2500);
    }
    const card = await boardCard();
    const sync = B.lastSync();
    if (card && sync && sync.p.heroes[identB].canUsePower) {
      const from = B.frames.length;
      const power = await (await B.page.$('.souls-classic-power-own')).boundingBox();
      await B.page.mouse.click(power.x + power.width / 2, power.y + power.height / 2); await sleep(900);
      await B.snap('power-armed');
      const target = await at(card.x, card.y);
      await B.page.mouse.click(target.x, target.y); await sleep(1500);
      await B.snap('power-used');
      await B.waitFrame(f => f.dir === 'in' && f.type === 236, from, 10000);
      const { used, buff } = powerUse(B, from);
      usedClassic = !!used && used.power === BLOOD_GIFT && !!buff && used.dst.cid === card.cid;
      step('classic: Blood Gift buffs the own card', usedClassic, used ? `${used.name} on ${JSON.stringify(used.dst)}` : 'no heroPower event');
      break;
    }
    if (B.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
    turnFrom = B.frames.length;
    const end = await at(1608, 550);
    await B.page.mouse.click(end.x, end.y);
    await B.waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
  }
  step('classic: Blood Gift was used', usedClassic);
  if (!usedClassic) await B.snap('end-classic');
  step('no console errors in the classic game', B.problems.length === 0, B.problems.slice(0, 4).join(' || '));

  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(s => s.ok).length}/${steps.length} passed`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
