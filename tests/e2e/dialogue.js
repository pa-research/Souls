// The heroes' dialogue in the 3D client: the intro exchange at the start of a practice game (the opponent speaks first,
// the player's hero answers, each line in its speech bubble), and a reaction when a hero power is used.
// Usage: node dialogue.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'dialogue';
fs.mkdirSync(out, { recursive: true });
const { sleep, LAUNCH, steps, step, register } = require('./helpers')(base, out);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(120000);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const bubbles = () => page.$$eval('.sg-bubble', e => e.map(b => ({ mine: b.classList.contains('mine'), text: b.textContent })));

  const name = 'd' + Date.now().toString(36);
  await register(page, name, 3);
  // (E2E_NORENDER=1: the 3D client draws nothing, which spares a runner without a GPU; the screenshots are then blank.)
  await page.goto(base + '/Game?mode=3d' + (process.env.E2E_NORENDER === '1' ? '&render=0' : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sg-menu', { timeout: 120000 });
  await page.click('.sg-menu-row .s-seg button >> nth=0');
  await page.click('.sg-menu-btn >> nth=1');

  // The intro exchange: the opponent's line, then the player's answer.
  const seen = [];
  for (let i = 0; i < 40 && !(seen.some(b => !b.mine) && seen.some(b => b.mine)); i++) {
    for (const b of await bubbles()) if (!seen.some(s => s.text === b.text && s.mine === b.mine)) seen.push(b);
    await sleep(250);
  }
  const first = seen[0];
  step('the opponent speaks first at the start', !!first && !first.mine, JSON.stringify(seen));
  step('the player\'s hero answers', seen.some(b => b.mine), JSON.stringify(seen));
  await page.screenshot({ path: `${out}/intro.jpg`, type: 'jpeg', quality: 80 });

  await page.waitForFunction(() => window.__souls3d && window.__souls3d.sync() && window.__souls3d.state().active, null, { timeout: 120000 });
  await page.click('.sg-mulligan-confirm').catch(() => {});
  await sleep(6000);
  const ident = (await page.evaluate(() => window.__souls3d.state())).ident;

  // A reaction: the player's hero uses its power and says its line (rationed: the bot's turn may have used the allowance).
  await page.evaluate(() => window.__souls3d.resetReactions());
  await page.evaluate(id => window.__souls3d.playEvents([{ t: 'heroPower', id, power: 3, name: 'Holy Light', dst: null }]), ident);
  await sleep(600);
  const after = await bubbles();
  step('using the hero power, the hero says its line', after.some(b => b.mine && b.text.length > 0), JSON.stringify(after));
  await page.screenshot({ path: `${out}/power.jpg`, type: 'jpeg', quality: 80 });

  if (problems.length) console.log('problems: ' + problems.join(' | '));
  const ok = steps.every(s => s.ok) && !problems.length;
  console.log(ok ? 'ALL PASS' : `${steps.filter(s => !s.ok).length} failures`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
