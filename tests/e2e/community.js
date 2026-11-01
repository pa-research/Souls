// The community of personas (docs/ranked-bots.md, phase 7): the home page shows players online, games to watch,
// players free for a challenge and the activity feed, on a desktop and a phone; personas are on the season table and
// have profiles like anyone's; a player watches a live game in 3D and challenges a free player from the home page, who
// accepts a friendly game. Needs the community on (the default).
// Usage: node community.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'community';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const step = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
let shot = 0;
const problems = [];

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.frames_ = [];
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/game')) return;
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); page.frames_.push({ type: j.Type, p: j.Payload }); } catch (e) { } });
  });
  return page;
}
async function waitFrame(page, pred, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames_.find(pred);
    if (f) return f;
    await sleep(100);
  }
  return null;
}
const snap = (page, name) => page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 80 }).catch(() => console.log(`(screenshot ${name} skipped)`));

async function register(page, name) {
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name);
  await page.fill('#Form_Password', 'CorrectHorse9!');
  await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check('#type-1');
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]');
  await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name);
  await page.fill('#Password', 'CorrectHorse9!');
  await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  try {
    // ---- The home page, signed out, on a desktop and a phone ----------------------------------------------------
    const home = await newPage(browser, { width: 1600, height: 900 });
    await home.goto(base + '/');
    await home.waitForSelector('#community-panel:not([hidden])');
    const online = await home.textContent('#community-online');
    step('home counts the players online', /^\d+ players online$/.test(online) && !/AI/.test(online), online);
    const live = await home.$$eval('#community-live a', as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent })));
    step('home lists games to watch', live.length > 0 && live.every(g => /^Watch .+ vs .+$/.test(g.text) && !/\(AI\)/.test(g.text)), JSON.stringify(live));
    const idle = await home.$$eval('#community-idle a', as => as.map(a => ({ href: a.getAttribute('href'), name: a.textContent })));
    step('home lists players to challenge', idle.length > 0 && idle.every(p => p.href.startsWith('/Game?challenge=')), idle.map(p => p.name).join(', '));
    const feed = await home.$$eval('#community-feed li', lis => lis.map(li => li.textContent));
    step('the feed has lines, none tagged AI', feed.length > 0 && feed.every(t => !/\bAI\b/.test(t)), feed.slice(0, 3).join(' | '));
    await home.locator('#community-panel').screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-home-panel.jpg`, type: 'jpeg', quality: 85 });
    await snap(home, 'home');
    const phone = await newPage(browser, { width: 412, height: 915 });
    await phone.goto(base + '/');
    await phone.waitForSelector('#community-panel:not([hidden])');
    step('home fits a phone', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await phone.locator('#community-panel').scrollIntoViewIfNeeded();
    await snap(phone, 'home-phone');

    // ---- The season table and a persona's profile ------------------------------------------------------------------
    await home.goto(base + '/Season');
    const table = await home.textContent('#season-standings').catch(() => '');
    step('personas are on the season table, not tagged', table.length > 0 && !/\bAI\b/.test(table));
    await snap(home, 'season');
    const persona = idle[0].name;
    await home.goto(`${base}/Player/Profile/${encodeURIComponent(persona)}`);
    const profile = await home.textContent('main');
    step('a persona\'s profile is a player\'s', profile.includes('Player profile') && !/\bAI\b/.test(profile), profile.replace(/\s+/g, ' ').slice(0, 200));
    await snap(home, 'profile');

    // ---- A player watches a live game in 3D -----------------------------------------------------------------------
    const player = await newPage(browser, { width: 1600, height: 900 });
    const name = 'cmP' + Date.now().toString(36).slice(-6);
    await register(player, name);
    const watch = live[0].href;
    await player.goto(base + watch, { waitUntil: 'domcontentloaded' });
    const spectating = await waitFrame(player, f => f.type >= 240 && f.type <= 243 || f.type === 206, 120000);
    step('a player watches a live game', !!spectating, spectating ? `type ${spectating.type}` : 'no spectate message');
    await sleep(8000);
    await snap(player, 'watching');

    // ---- The player challenges a free player from the home page; the persona accepts ---------------------------------
    player.frames_.length = 0;
    await player.goto(base + '/');
    await player.waitForSelector('#community-idle a');
    const target = await player.textContent('#community-idle a');
    await Promise.all([player.waitForURL(/\/Game\?challenge=/), player.click('#community-idle a')]);
    const sent = await waitFrame(player, f => f.type === 198 || f.type === 197, 180000);
    step('the challenge reaches the persona', sent?.type === 198 && sent.p.name === target, JSON.stringify(sent?.p));
    const started = await waitFrame(player, f => f.type === 206, 30000);
    step('the persona accepts: a friendly game starts', !!started);
    await sleep(8000);
    await snap(player, 'challenge-game');
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
