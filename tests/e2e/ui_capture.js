// Screenshots of every website page (desktop + phone), with their error, flash and empty states.
// Fails on a console error or on a page that scrolls sideways. Usage: node ui_capture.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'ui';
fs.mkdirSync(out, { recursive: true });
// The admin password from SOULS_ADMIN_PASSWORD, or the secret file that deploy/compose/init-secrets.sh writes.
const adminPassword = process.env.SOULS_ADMIN_PASSWORD
  || fs.readFileSync(require('path').join(__dirname, '../../deploy/compose/secrets/Souls__Admin__Password'), 'utf8').trim();
const SPELL = 60, CLASS_CARD = 70;
(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const [device, viewport] of [['desk', { width: 1600, height: 900 }], ['phone', { width: 412, height: 915 }]]) {
    const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true, deviceScaleFactor: device === 'phone' ? 2 : 1, isMobile: device === 'phone', hasTouch: device === 'phone' });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(`${device} ${page.url()}: ${e.message}`));
    // The 404 and 403 pages are visited on purpose; their status shows up as a console error.
    const deliberate = m => /status of 40[34]/.test(m.text()) && /\/(nope|Status\/404|AccessDenied.*)$/.test(page.url());
    page.on('console', m => { if (m.type() === 'error' && !/api\.github/.test(m.text()) && !deliberate(m)) problems.push(`${device} ${page.url()}: ${m.text()}`); });
    const shot = async (name, fullPage = true) => {
      // Card portraits load lazily and decode off the main thread (blank until decoded): a full-page shot loads and
      // decodes them all first.
      if (fullPage) {
        await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; i.decoding = 'sync'; }));
        await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 30000 }).catch(() => problems.push(`${device} ${name}: images still loading`));
      }
      await page.waitForTimeout(700);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) problems.push(`${device} ${name}: the page scrolls ${wide}px sideways`);
      await page.screenshot({ path: `${out}/${device}-${name}.jpg`, type: 'jpeg', quality: 70, fullPage, animations: 'disabled' });
    };
    const submit = async (selector = 'main button[type=submit]') => { await Promise.all([page.waitForNavigation(), page.click(selector)]); };
    await page.goto(base + '/'); await shot('home-anon');
    await page.goto(base + '/Season'); await shot('season-anon');
    await page.goto(base + '/Player/Login'); await shot('login');
    await page.fill('#Name', 'nobody' + Date.now().toString(36)); await page.fill('#Password', 'NotThePassword9!'); await submit(); await shot('login-error');
    await page.goto(base + '/Player/Register'); await shot('register');
    await submit(); await shot('register-error');
    if (!(await page.$('main .s-alert-error li'))) problems.push(`${device} register: no validation errors for an empty form`);
    await page.goto(base + '/Player/Register');
    // A player with some history.
    const name = (device[0]) + Date.now().toString(36).slice(-7);
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check('#type-3');
    for (const box of (await page.$$('input.cards:not(:checked)')).slice(0, 5 - (await page.$$('input.cards:checked')).length)) await box.check();
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
    await page.goto(base + '/'); await shot('home');
    await page.goto(base + '/Shop'); await shot('shop');
    // A new player has no soul coins: the pack's confirmation, then the error.
    await page.click('.s-pack-offer button[type=submit]'); await page.waitForSelector('#buy-confirm[open]'); await shot('shop-confirm', false);
    await submit('#buy-confirm button[value=ok]'); await shot('shop-error');
    await page.goto(base + '/Deck'); await shot('deck');
    await page.check('#power-form input[name=power]:not(:checked)'); await submit('#power-save'); await shot('deck-power');
    // The server checks the deck again: an empty deck is refused.
    await page.$$eval('.deck-count', inputs => inputs.forEach(i => { i.value = '0'; }));
    await page.$eval('#deck-save', b => { b.disabled = false; }); await submit('#deck-save'); await shot('deck-error');
    await page.goto(base + '/Season'); await shot('season');
    const recent = await (await ctx.request.get(base + '/Home/GetGames')).json();
    if (recent.length) { await page.goto(`${base}/Game/Stats/${recent[0].gameId}`); await shot('stats'); }
    await page.goto(base + '/Admin/Players'); await shot('403');
    await page.goto(base + '/Home/Status/404').catch(() => {}); await page.goto(base + '/nope'); await shot('404');
    // Admin pages.
    await page.evaluate(() => { const f = document.querySelector('form[action*="Logout"]'); if (f) f.submit(); }); await page.waitForTimeout(1500);
    await page.goto(base + '/Player/Login');
    await page.fill('#Name', 'admin'); await page.fill('#Password', adminPassword); await page.click('main button[type=submit]');
    await page.waitForTimeout(1000);
    for (const p of ['Players', 'Games', 'CardStatistics', 'Season', 'CardEditor', 'NewsEditor']) { await page.goto(`${base}/Admin/${p}`); await shot('admin-' + p.toLowerCase()); }
    await page.goto(`${base}/Admin/CardEditor`); await submit('#card-form button[type=submit]'); await shot('admin-cardeditor-error');
    await page.goto(`${base}/Admin/CardEditor/${SPELL}`); await shot('admin-cardeditor-spell');
    await page.goto(`${base}/Admin/CardEditor/${CLASS_CARD}`); await shot('admin-cardeditor-class');
    await ctx.close();
  }
  console.log('problems:', problems.length ? problems.slice(0, 20) : 'none');
  if (problems.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
