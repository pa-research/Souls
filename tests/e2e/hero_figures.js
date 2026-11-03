// Hero figures (Content/Models/Heroes): a practice game as the given class; screenshots of the heroes in every camera
// view, the figure loaded and animating (its idle moves between two frames); in the stadium views the figures are the
// heroes (figure mode, nameplates instead of medallions), the pointer on the opponent's figure shows its tooltip, a hero
// attack lunges and hits (screenshot mid-blow); no console errors.
// Usage: node hero_figures.js <baseUrl> <outDir> [class]
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'hero_figures';
const type = Number(process.argv[4] || 2);
fs.mkdirSync(out, { recursive: true });
const { sleep, LAUNCH, steps, step, register } = require('./helpers')(base, out);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(120000);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  try {
    const name = 'hf' + Date.now().toString(36).slice(-7);
    await register(page, name, type);

    const glb = page.waitForResponse(r => r.url().includes(`/Content/Models/Heroes/${type}.glb`), { timeout: 120000 }).catch(() => null);
    await page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sg-menu');
    await page.click('.sg-menu-btn >> nth=1');
    await page.waitForSelector('.sg-mulligan-confirm');
    await page.click('.sg-mulligan-confirm');
    const response = await glb;
    step('the figure of the class loads', response?.status() === 200, response ? `${response.status()} ${response.url()}` : 'no request');
    await sleep(6000);

    for (const [key, view] of [['2', 'arena'], ['3', 'field'], ['4', 'cinematic'], ['1', 'classic']]) {
      await page.keyboard.press(key);
      await sleep(3500);
      await page.screenshot({ path: `${out}/${view}.jpg`, type: 'jpeg', quality: 85 });
    }
    await page.keyboard.press('2');
    await sleep(3000);
    const a = await page.screenshot({ type: 'png' });
    await sleep(700);
    const b = await page.screenshot({ type: 'png' });
    step('the arena moves (the figures animate)', !a.equals(b));

    const figures = await page.evaluate(() => window.__souls3d.figures());
    step('in the arena both heroes are figures with nameplates', figures.every(f => f.mode), JSON.stringify(figures));
    const enemy = figures[1];
    // Between its chest and its nameplate: the figure's body (its head may be under the top bar in the arena view).
    await page.mouse.move(enemy.chest.x, (enemy.chest.y + enemy.plate.y) / 2, { steps: 3 });
    await sleep(1200);
    const tip = await page.evaluate(() => window.__souls3d.tooltip());
    step('the pointer on the opponent figure shows its tooltip', !!tip && /Hero power/.test(tip), tip && tip.slice(0, 80));
    await page.screenshot({ path: `${out}/hover.jpg`, type: 'jpeg', quality: 85 });
    await page.mouse.move(5, 450);

    // A scripted blow: the opponent's hero attacks the player's (the figures lunge, flinch and flash).
    const me = figures[0].ident, them = figures[1].ident;
    page.evaluate(([me, them]) => window.__souls3d.playEvents([
      { t: 'attack', src: { k: 'hero', id: them }, dst: { k: 'hero', id: me } },
      { t: 'damage', to: { k: 'hero', id: me }, amount: 2, health: 20 },
    ]), [me, them]).catch(() => {});
    await sleep(330);
    await page.screenshot({ path: `${out}/attack.jpg`, type: 'jpeg', quality: 85 });
    await sleep(2500);
    const after = await page.evaluate(() => window.__souls3d.state().playerHealth);
    step('the blow lands on the player\'s figure', String(after) === '20', `health ${after}`);
  } catch (e) {
    step('script', false, e.stack);
  } finally {
    await browser.close();
  }
  step('no console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  const failed = steps.filter(s => !s.ok).length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
