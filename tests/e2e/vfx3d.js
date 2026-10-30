// Screenshots of the new card set's effects in the 3D client: a practice game is started, then the effects are
// replayed through the test hooks (legendary entrance, inferno, ward, venom, paralyze ice, grow, rally, shatter).
// Usage: node vfx3d.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'vfx3d';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const portrait = id => `/Content/Images/Card/Portraits/${id}.jpg`;
const race = id => ({ id, name: ['', 'Darkness', 'Vampiric', 'Lightbringer', 'Ferocious'][id], cardUrl: `/Content/Images/Card/Texture/${['', 'darkness', 'vampiric', 'lightbringer', 'ferocious'][id]}.png` });
let nextCid = 900000;
const card = (id, name, r, rarity, cost, attack, health, armor, ability, slotId, extra = {}) => ({
  cid: ++nextCid, id, name, race: race(r), rarity, cost, attack, health, maxHealth: health, armor, level: 1, slotId,
  portrait: portrait(id), flavor: extra.flavor || null, ward: !!extra.ward, paralyzed: false, taunt: !!extra.taunt, token: false,
  ability: ability ? { id: ability[0], name: ability[1], label: ability[2], text: ability[3], value: ability[4] || 0, activated: !!ability[5] } : null,
});

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(120000);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  const hook = expr => page.evaluate(`window.__souls3d.${expr}`);
  const play = events => page.evaluate(ev => { window.__vfx = window.__souls3d.playEvents(ev); }, events);
  const done = () => page.evaluate(() => window.__vfx);
  let shot = 0;
  const snap = async name => { await page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 80, timeout: 60000 }); console.log('shot', name); };

  const name = 'v' + Date.now().toString(36);
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name);
  await page.fill('#Form_Password', 'CorrectHorse9!');
  await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check('#type-3');
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]');
  await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name);
  await page.fill('#Password', 'CorrectHorse9!');
  await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  await page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sg-menu', { timeout: 120000 });
  await page.click('.sg-menu-row .s-seg button >> nth=0');
  await page.click('.sg-menu-btn >> nth=1');
  await page.waitForFunction(() => window.__souls3d && window.__souls3d.sync() && window.__souls3d.state().active, null, { timeout: 120000 });
  await page.click('.sg-mulligan-confirm');
  await sleep(9000);
  const ident = (await hook('state()')).ident;
  const enemy = 3 - ident;

  // Our side: a warded Templar, a Huldra (venom), a Lord Varga (grow), an Acolyte (rally) and a filler.
  const templar = card(43, 'Templar', 3, 1, 3, 2, 3, 0, [10, 'Ward', 'Ward', 'The first time it would take damage, the ward breaks instead.'], 1, { ward: true });
  const huldra = card(52, 'Huldra', 4, 2, 3, 2, 3, 0, [12, 'Venom', 'Venom', 'Destroys any card it damages.'], 2);
  const varga = card(37, 'Lord Varga', 2, 4, 6, 4, 5, 0, [17, 'Grow', 'Grow +1', 'At the start of your turn, gains +1 attack and +1 health.', 1], 3);
  const acolyte = card(40, 'Acolyte of Dawn', 3, 1, 1, 1, 1, 0, [13, 'Rally', 'Rally +1', 'When played, the cards next to it gain +1 attack.', 1], 4);
  const thrall = card(31, 'Blood Thrall', 2, 1, 2, 2, 3, 0, null, 5, { flavor: 'He serves the count. He no longer remembers why.' });
  for (const c of [templar, huldra, varga, acolyte, thrall]) await play([{ t: 'summon', src: 0, owner: ident, card: c }]);
  // Their side: two cards for the inferno to burn and the venom to kill.
  const rat = card(21, 'Grave Rat', 1, 1, 2, 1, 2, 0, [12, 'Venom', 'Venom', 'Destroys any card it damages.'], 2);
  const jotun = card(55, 'Frost Jotun', 4, 3, 8, 7, 7, 1, [3, 'Taunt', 'Taunt', 'Enemies must attack this card before anything else.'], 4, { taunt: true });
  for (const c of [rat, jotun]) await play([{ t: 'summon', src: 0, owner: enemy, card: c }]);
  await sleep(2500);
  await snap('board');

  // A legendary enters: The Pale Reaper for the opponent.
  const reaper = card(28, 'The Pale Reaper', 1, 4, 7, 6, 6, 0, [18, 'Drain', 'Drain 3', 'Deals 3 damage to an enemy card or hero and restores 3 health to your hero.', 3, true], 3);
  await page.evaluate(c => { window.__souls3d.useCard(c, true); }, reaper);
  await sleep(450);
  console.log('legendary banner:', await page.evaluate(() => { const b = document.querySelector('.sg-legend'); return b ? b.textContent : null; }));
  await snap('legendary-entrance');
  await sleep(3200);

  // Pesta's inferno over our line (the ward blocks it on the Templar).
  const pesta = card(27, 'Pesta', 1, 3, 6, 4, 5, 0, [15, 'Inferno', 'Inferno 2', 'When played, deals 2 damage to every enemy card.', 2], 5);
  await page.evaluate(c => window.__souls3d.useCard(c, true), pesta);
  await sleep(1500);
  const ref = c => ({ k: 'card', cid: c.cid });
  await play([
    { t: 'trigger', abilityId: 15, src: ref(pesta), label: 'Inferno 2' },
    { t: 'ward', to: ref(templar), on: false },
    { t: 'damage', to: ref(huldra), amount: 2, armorLost: 0, health: 1, armor: 0 },
    { t: 'damage', to: ref(varga), amount: 2, armorLost: 0, health: 3, armor: 0 },
    { t: 'damage', to: ref(acolyte), amount: 2, armorLost: 0, health: -1, armor: 0 },
    { t: 'damage', to: ref(thrall), amount: 2, armorLost: 0, health: 1, armor: 0 },
  ]);
  await sleep(700);
  await snap('inferno');
  await done();
  await play([{ t: 'death', cid: acolyte.cid, owner: ident }]);
  await sleep(350);
  await snap('shatter');
  await sleep(1500);

  // Venom: Huldra attacks the Frost Jotun.
  await play([
    { t: 'attack', src: ref(huldra), dst: ref(jotun) },
    { t: 'damage', to: ref(jotun), amount: 3, armorLost: 1, health: 5, armor: 0 },
    { t: 'venom', src: ref(huldra), to: ref(jotun) },
    { t: 'damage', to: ref(huldra), amount: 7, armorLost: 0, health: -6, armor: 0 },
  ]);
  await sleep(600);
  await snap('venom');
  await done();
  await play([{ t: 'death', cid: jotun.cid, owner: enemy }, { t: 'death', cid: huldra.cid, owner: ident }]);
  await sleep(2000);

  // Paralyze ice on Lord Varga, then Varga grows at the start of the turn.
  await play([{ t: 'ability', abilityId: 5, src: ref(rat), dst: ref(varga) }, { t: 'paralyze', cid: varga.cid, on: true }]);
  await sleep(500);
  await snap('paralyze');
  await done();
  await sleep(800);
  await play([{ t: 'paralyze', cid: varga.cid, on: false }, { t: 'trigger', abilityId: 17, src: ref(varga), label: 'Grow +1' },
    { t: 'buff', to: ref(varga), src: ref(varga), attack: 5, health: 4, maxHealth: 6, armor: 0 }]);
  await sleep(400);
  await snap('grow');
  await done();

  // Rally: a second Acolyte between the Templar and Varga.
  const acolyte2 = card(40, 'Acolyte of Dawn', 3, 1, 1, 1, 1, 0, [13, 'Rally', 'Rally +1', 'When played, the cards next to it gain +1 attack.', 1], 2);
  await play([{ t: 'summon', src: 0, owner: ident, card: acolyte2 }, { t: 'trigger', abilityId: 13, src: ref(acolyte2), label: 'Rally +1' },
    { t: 'buff', to: ref(templar), src: ref(acolyte2), attack: 3, health: 3, maxHealth: 3, armor: 0 },
    { t: 'buff', to: ref(varga), src: ref(acolyte2), attack: 6, health: 4, maxHealth: 6, armor: 0 }]);
  await sleep(300);
  await snap('rally');
  await done();
  await sleep(1500);

  // Drain from the Reaper to our hero.
  await play([{ t: 'ability', abilityId: 18, src: ref(reaper), dst: { k: 'hero', id: ident } },
    { t: 'damage', to: { k: 'hero', id: ident }, amount: 3, armorLost: 0, health: 19, armor: 0 },
    { t: 'lifesteal', src: { k: 'hero', id: ident }, to: { k: 'hero', id: enemy }, amount: 3, health: 22 }]);
  await sleep(450);
  await snap('drain');
  await done();
  await sleep(1500);

  // Tooltip of the legendary card.
  const at = await hook(`opponentCard(${reaper.cid})`);
  if (at) { await page.mouse.move(at.x, at.y, { steps: 4 }); await sleep(900); await snap('tooltip-legendary'); }
  console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
