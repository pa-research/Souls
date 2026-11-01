// Hero figures (Content/Models/Heroes): a practice game as the given class; screenshots of the heroes in every camera
// view, the figure loaded and animating (its idle moves between two frames), no console errors.
// Usage: node hero_figures.js <baseUrl> <outDir> [class]
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'hero_figures';
const type = Number(process.argv[4] || 2);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const step = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  page.setDefaultTimeout(120000);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  try {
    const name = 'hf' + Date.now().toString(36).slice(-7);
    await page.goto(base + '/Player/Register');
    await page.fill('#Form_Username', name);
    await page.fill('#Form_Password', 'CorrectHorse9!');
    await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check(`#type-${type}`);
    for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
    await page.click('main button[type=submit]');
    await page.waitForURL(/Player\/Login/);
    await page.fill('#Name', name);
    await page.fill('#Password', 'CorrectHorse9!');
    await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));

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
  } catch (e) {
    step('script', false, e.stack);
  } finally {
    await browser.close();
  }
  step('no console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  const failed = results.filter(r => !r).length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
