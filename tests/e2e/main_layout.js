// The main game screen's layout in the 3D client: a practice game with both rows full and a full hand, in every view
// and on desktop and phone screens. Fails where the hand is too small to read, where the hand, a hero's plaque, the
// hero power, a status pill or the End Turn sign covers a card on the board (or each other), or where anything but the
// hand covers a hero's figure; where the chat, the open battle log or the player's plaque covers the hand or a zoomed
// hand card, where touching a card on a phone held upright leaves the battle log open over the hand, where a message
// covers the opponent's plaque on a phone, and where orbiting the camera takes it into the stands or shows a tooltip.
// Usage: node main_layout.js <baseUrl> <outDir> (LAYOUT_FULL=1: every screen in every view; otherwise the ones CI checks,
// which software rendering on a small runner draws slowly).
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'main_layout';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const portrait = id => `/Content/Images/Card/Portraits/${id}.jpg`;
const race = id => ({ id, name: ['', 'Darkness', 'Vampiric', 'Lightbringer', 'Ferocious'][id], cardUrl: `/Content/Images/Card/Texture/${['', 'darkness', 'vampiric', 'lightbringer', 'ferocious'][id]}.png` });
let nextCid = 900000;
const card = (id, name, r, cost, attack, health, slotId) => ({
  cid: ++nextCid, id, name, race: race(r), rarity: 1, cost, attack, health, maxHealth: health, armor: 0, level: 1, slotId,
  portrait: portrait(id), flavor: null, ward: false, paralyzed: false, taunt: false, token: false, ability: null,
});
const CARDS = [[43, 'Templar', 3], [52, 'Huldra', 4], [37, 'Lord Varga', 2], [40, 'Acolyte of Dawn', 3], [31, 'Blood Thrall', 2], [21, 'Grave Rat', 1], [55, 'Frost Jotun', 4]];

// Screens: desktop sizes, a phone held sideways and upright.
const SCREENS = [
  { name: 'desk', width: 1600, height: 900 },
  { name: 'hd', width: 1920, height: 1080 },
  { name: 'small', width: 1280, height: 720 },
  { name: 'wide', width: 2560, height: 1080 },
  { name: 'phone-land', width: 915, height: 412, mobile: true },
  { name: 'phone', width: 412, height: 915, mobile: true },
];
const VIEWS = ['classic', 'arena', 'field', 'cinematic'];
const FULL = process.env.LAYOUT_FULL === '1';
const QUICK = new Set(['desk-arena', 'desk-field', 'desk-cinematic', 'phone-land-arena', 'phone-arena']);

// Overlap of two rectangles beyond a few pixels of slack.
const SLACK = 4;
const overlaps = (a, b) => a && b && a.x + SLACK < b.x + b.w && b.x + SLACK < a.x + a.w && a.y + SLACK < b.y + b.h && b.y + SLACK < a.y + a.h;

const problems = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const hook = expr => page.evaluate(`window.__souls3d.${expr}`);
  const play = events => page.evaluate(ev => window.__souls3d.playEvents(ev), events);

  const name = 'l' + Date.now().toString(36);
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name);
  await page.fill('#Form_Password', 'CorrectHorse9!');
  await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check('#type-' + (process.env.HERO || 3));
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]');
  await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name);
  await page.fill('#Password', 'CorrectHorse9!');
  await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  // (E2E_NORENDER=1: the 3D client draws nothing, which spares a runner without a GPU; the screenshots are then blank.)
  await page.goto(base + '/Game?mode=3d' + (process.env.E2E_NORENDER === '1' ? '&render=0' : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sg-menu', { timeout: 120000 });
  await page.click('.sg-menu-row .s-seg button >> nth=0');
  await page.click('.sg-menu-btn >> nth=1');
  await page.waitForFunction(() => window.__souls3d && window.__souls3d.sync() && window.__souls3d.state().active, null, { timeout: 120000 });
  await page.click('.sg-mulligan-confirm');
  await sleep(9000);
  const ident = (await hook('state()')).ident;

  // Both rows full, and the hand topped up to ten cards.
  for (let slot = 0; slot < 7; slot++) {
    const [id, n, r] = CARDS[slot];
    await play([{ t: 'summon', src: 0, owner: ident, card: card(id, n, r, 3, 2, 3, slot) }]);
    await play([{ t: 'summon', src: 0, owner: 3 - ident, card: card(id, n, r, 3, 2, 3, slot) }]);
  }
  const held = (await hook('state()')).hand.length;
  await page.evaluate(cards => window.__souls3d.addHand(cards), CARDS.concat(CARDS).slice(0, Math.max(0, 10 - held)).map(([id, n, r], i) => card(id, n, r, 1 + (i % 8), 2, 3, 0)));
  // Lay the hand out from the classic view, so the first view checked moves to its layout like the rest.
  await hook("view('classic')");
  await sleep(2500);

  const failures = [];
  const report = [];
  for (const screen of SCREENS) {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    // A phone starts with the battle log folded (ui.js); the desktop screens before left it open.
    await page.evaluate(mobile => {
      const log = document.querySelector('.sg-log');
      if (log && log.classList.contains('collapsed') !== mobile) log.querySelector('.sg-log-head').click();
    }, !!screen.mobile);
    for (const view of VIEWS) {
      const tag = `${screen.name}-${view}`;
      if (!FULL && !QUICK.has(tag)) continue;
      await hook(`view('${view}')`);
      await page.mouse.move(2, 2);
      await sleep(2200); // the camera's move to a view takes 1.7 s
      await page.screenshot({ path: `${out}/${tag}.jpg`, type: 'jpeg', quality: 80, timeout: 60000 });
      const r = await hook('layoutRects()');
      const fail = msg => failures.push(`${tag}: ${msg}`);
      const hand = r.hand.filter(Boolean);
      // The hand: every card on the screen, tall enough to read, and enough of each showing (the next card covers the rest).
      const minHeight = screen.mobile ? 0.17 * Math.min(screen.width, screen.height) : 0.17 * screen.height;
      const shown = hand.map((c, i) => (i + 1 < hand.length ? Math.max(0, Math.min(c.w, hand[i + 1].x - c.x)) : c.w));
      const cardH = hand.length ? Math.min(...hand.map(c => c.h)) : 0;
      const strip = Math.min(...shown);
      report.push(`${tag}: hand ${hand.length} cards ${Math.round(hand[0]?.w ?? 0)}x${Math.round(cardH)} strip ${Math.round(strip)}`);
      if (view !== 'classic' && screen.name !== 'phone') {
        if (cardH < minHeight) fail(`hand cards ${Math.round(cardH)}px tall (want >= ${Math.round(minHeight)})`);
        if (strip < 0.32 * (hand[0]?.w ?? 0)) fail(`a hand card shows only ${Math.round(strip)}px`);
      }
      for (const c of hand) if (c.x < -2 || c.x + c.w > screen.width + 2 || c.y < -2) fail(`hand card off screen ${JSON.stringify(c)}`);
      const named = { 'your plaque': r.plate, power: r.power, status: r.status, sign: r.sign };
      for (const [k, box] of Object.entries(named)) {
        for (const b of r.board) if (overlaps(box, b)) { fail(`${k} covers a card on your board`); break; }
      }
      for (const c of hand) for (const b of r.board) if (overlaps(c, b)) { fail('the hand covers a card on your board'); break; }
      for (const b of r.opponentBoard) {
        if (overlaps(r.opponentPlate, b)) { fail("the opponent's plaque covers a card on its board"); break; }
      }
      for (const b of r.opponentBoard) {
        if (overlaps(r.opponentStatus, b)) { fail("the opponent's status pill covers a card on its board"); break; }
      }
      // The heroes' figures: nothing of the HUD on them but the hand (which may cover the player's feet).
      for (const [k, box] of Object.entries({ 'your plaque': r.plate, "the opponent's plaque": r.opponentPlate, 'the hero power': r.power, 'End Turn': r.sign })) {
        if (view === 'classic') break;
        if (overlaps(box, r.figure)) fail(`${k} covers your hero's figure`);
        if (overlaps(box, r.opponentFigure)) fail(`${k} covers the opponent's figure`);
      }
      // (Not the cinematic view: its camera sways, so a wing may graze the front row for a moment.)
      if (view !== 'classic' && view !== 'cinematic') for (const b of r.board) if (overlaps(r.figure, b)) { fail("your hero's figure covers a card on your board"); break; }
      if (r.figure && hand.length) {
        const covered = Math.max(0, r.figure.y + r.figure.h - Math.min(...hand.map(c => c.y)));
        report.push(`${tag}: the hand covers the bottom ${Math.round(100 * Math.min(1, covered / r.figure.h))}% of your figure`);
      }
      if (overlaps(r.power, r.sign)) fail('the hero power covers End Turn');
      if (overlaps(r.status, r.power)) fail('the status pill and the hero power overlap');
      for (const c of hand) if (overlaps(c, r.power) || overlaps(c, r.sign)) { fail('the hand covers the hero power or End Turn'); break; }
      if (view === 'classic') continue;
      // The hand and a zoomed card clear of the chat, the open battle log and (landscape) the player's plaque.
      const landscape = screen.width > screen.height;
      for (const [k, box] of Object.entries({ 'the chat': r.chat, 'the battle log': r.log, 'your plaque': landscape ? r.plate : null })) {
        const c = hand.find(c => overlaps(c, box));
        if (c) fail(`${k} covers the hand (${JSON.stringify(box)} over ${JSON.stringify(c)})`);
      }
      if (screen.name === 'phone') await page.evaluate(() => { const log = document.querySelector('.sg-log'); if (log.classList.contains('collapsed')) log.querySelector('.sg-log-head').click(); });
      const last = await hook(`handCard(${hand.length - 1})`);
      await page.mouse.move(last.x, last.y);
      await sleep(700);
      const z = await hook('layoutRects()');
      await page.screenshot({ path: `${out}/${tag}-zoom.jpg`, type: 'jpeg', quality: 80, timeout: 60000 });
      if (!z.hovered) fail('pointing at the last hand card zooms nothing');
      else for (const [k, box] of Object.entries({ 'the chat': z.chat, 'the battle log': z.log, 'your plaque': landscape ? z.plate : null })) {
        if (overlaps(z.hovered, box)) fail(`${k} covers the zoomed hand card`);
      }
      if (screen.name === 'phone' && !z.logFolded) fail('touching a hand card leaves the battle log open over the hand');
      await page.mouse.move(2, 2);
      if (screen.mobile) {
        await hook("message('Not enough mana')");
        await sleep(400);
        const m = await hook('layoutRects()');
        if (overlaps(m.toasts, m.opponentPlate)) fail("a message covers the opponent's plaque");
      }
    }
  }

  // Orbiting the camera (dragging with the right button, then zooming out): no tooltip while it turns, and the camera
  // stays above the stands (they rise TIER_RISE every TIER_DEPTH from STANDS_IN, stadium.js) instead of sinking in.
  await page.setViewportSize({ width: 1600, height: 900 });
  await hook("view('arena')");
  await sleep(2200);
  const card3 = await hook('slot(3)');
  await page.mouse.move(card3.x, card3.y);
  await sleep(1200);
  await page.mouse.down({ button: 'right' });
  let tipWhileOrbiting = null;
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(card3.x + i * 25, card3.y - i * 14);
    tipWhileOrbiting = tipWhileOrbiting || (await hook('tooltip()'));
  }
  await page.mouse.up({ button: 'right' });
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await sleep(1500);
  await page.screenshot({ path: `${out}/orbit.jpg`, type: 'jpeg', quality: 80, timeout: 60000 });
  const [cx, cy, cz] = await hook('camera()');
  const out_ = Math.hypot(cx, cz);
  const seats = out_ < 747 ? 0 : 74 + (Math.min(out_, 1675) - 747) * 30 / 58;
  report.push(`orbit: camera at ${out_ | 0} out, ${cy} up (the stands there ${seats | 0})`);
  if (tipWhileOrbiting) failures.push(`orbit: a tooltip shows while the camera turns (${tipWhileOrbiting.slice(0, 40)})`);
  if (cy < seats + 40) failures.push(`orbit: the camera sinks into the stands (${out_ | 0} out, ${cy} up)`);
  console.log(report.join('\n'));
  for (const f of failures) console.log('FAIL ' + f);
  if (problems.length) console.log('problems: ' + problems.join(' | '));
  console.log(failures.length || problems.length ? `${failures.length} layout failures` : 'ALL PASS');
  await browser.close();
  process.exit(failures.length || problems.length ? 1 : 0);
})().catch(e => { console.error(e); if (problems.length) console.error('problems: ' + problems.join(' | ')); process.exit(1); });
