// Screenshots of every website page (desktop + phone). Usage: node ui_capture.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'ui';
fs.mkdirSync(out, { recursive: true });
// The admin password from SOULS_ADMIN_PASSWORD, or the secret file that deploy/compose/init-secrets.sh writes.
const adminPassword = process.env.SOULS_ADMIN_PASSWORD
  || fs.readFileSync(require('path').join(__dirname, '../../deploy/compose/secrets/Souls__Admin__Password'), 'utf8').trim();
(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const [device, viewport] of [['desk', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true, deviceScaleFactor: device === 'phone' ? 2 : 1, isMobile: device === 'phone', hasTouch: device === 'phone' });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(`${device} ${page.url()}: ${e.message}`));
    // The 404 pages are visited on purpose; their status shows up as a console error.
    const deliberate404 = m => /status of 404/.test(m.text()) && /\/(nope|Status\/404)$/.test(page.url());
    page.on('console', m => { if (m.type() === 'error' && !/api\.github/.test(m.text()) && !deliberate404(m)) problems.push(`${device} ${page.url()}: ${m.text()}`); });
    const shot = async name => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${device}-${name}.jpg`, type: 'jpeg', quality: 70, fullPage: true, animations: 'disabled' }); };
    await page.goto(base + '/'); await shot('home-anon');
    await page.goto(base + '/Player/Login'); await shot('login');
    await page.goto(base + '/Player/Register'); await shot('register');
    // A player with some history.
    const name = (device[0]) + Date.now().toString(36).slice(-7);
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check('#type-3');
    for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
    await page.goto(base + '/'); await shot('home');
    await page.goto(base + '/Shop'); await shot('shop');
    await page.goto(base + '/Deck'); await shot('deck');
    const recent = await (await ctx.request.get(base + '/Home/GetGames')).json();
    if (recent.length) { await page.goto(`${base}/Game/Stats/${recent[0].gameId}`); await shot('stats'); }
    await page.goto(base + '/Home/Status/404').catch(() => {}); await page.goto(base + '/nope'); await shot('404');
    // Admin pages.
    await page.evaluate(() => { const f = document.querySelector('form[action*="Logout"]'); if (f) f.submit(); }); await page.waitForTimeout(1500);
    await page.goto(base + '/Player/Login');
    await page.fill('#Name', 'admin'); await page.fill('#Password', adminPassword); await page.click('main button[type=submit]');
    await page.waitForTimeout(1000);
    for (const p of ['Players', 'Games', 'CardEditor', 'NewsEditor']) { await page.goto(`${base}/Admin/${p}`); await shot('admin-' + p.toLowerCase()); }
    await ctx.close();
  }
  console.log('problems:', problems.length ? problems.slice(0, 10) : 'none');
  if (problems.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
