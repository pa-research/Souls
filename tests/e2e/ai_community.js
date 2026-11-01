// The AI community (docs/ranked-bots.md, phase 7): the home page counts players and AI apart and lists AI games to
// watch, AI players free for a challenge and the AI activity feed; the AI ladder and a persona's profile tag every AI
// player; a player watches a live AI game in 3D and challenges a persona, who accepts a friendly game.
// Needs the community on (the default) and some persona online by its clock.
// Usage: node ai_community.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'ai_community';
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
    step('home counts players and AI apart', /players online · \d+ AI online/.test(online), online);
    const live = await home.$$eval('#community-live a', as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent })));
    step('home lists AI games to watch, tagged AI', live.length > 0 && live.every(g => /\(AI\) vs .+\(AI\)/.test(g.text)), JSON.stringify(live));
    const idle = await home.$$eval('#community-idle a', as => as.map(a => a.textContent));
    step('home lists AI players to challenge, tagged AI', idle.length > 0 && idle.every(t => t.endsWith(' (AI)')), idle.join(', '));
    await home.locator('#community-panel').screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-home-panel.jpg`, type: 'jpeg', quality: 85 });
    await snap(home, 'home');
    const phone = await newPage(browser, { width: 412, height: 915 });
    await phone.goto(base + '/');
    await phone.waitForSelector('#community-panel:not([hidden])');
    step('home fits a phone', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await phone.locator('#community-panel').scrollIntoViewIfNeeded();
    await snap(phone, 'home-phone');

    // ---- The AI ladder and a persona's profile --------------------------------------------------------------------
    await home.goto(base + '/Season/Ai');
    const rows = await home.$$('#ai-standings tbody tr');
    const tagged = await home.$$eval('#ai-standings tbody tr', trs => trs.every(tr => /\bAI\b/.test(tr.textContent)));
    step('the AI ladder tags every row', rows.length === 0 || tagged, `${rows.length} rows`);
    await snap(home, 'ai-ladder');
    const persona = idle[0].replace(/ \(AI\)$/, '');
    await home.goto(`${base}/Player/Profile/${encodeURIComponent(persona)}`);
    const profile = await home.textContent('main');
    const tag = await home.getAttribute('.s-profile-head-meta .s-chip', 'title');
    step('a persona\'s profile says it is AI', profile.includes('AI player') && /not a person/.test(tag) && /Usually online/.test(profile), `${tag} | ${profile.replace(/\s+/g, ' ').slice(0, 300)}`);
    await snap(home, 'ai-profile');

    // ---- A player watches a live AI game in 3D --------------------------------------------------------------------
    const player = await newPage(browser, { width: 1600, height: 900 });
    const name = 'aiP' + Date.now().toString(36).slice(-6);
    await register(player, name);
    const watch = live[0].href;
    await player.goto(base + watch, { waitUntil: 'domcontentloaded' });
    const spectating = await waitFrame(player, f => f.type >= 240 && f.type <= 243 || f.type === 206, 120000);
    step('a player watches a live AI game', !!spectating, spectating ? `type ${spectating.type}` : 'no spectate message');
    await sleep(8000);
    await snap(player, 'watching');

    // ---- The player challenges a persona from its profile; it accepts ---------------------------------------------
    player.frames_.length = 0;
    await player.goto(`${base}/Player/Profile/${encodeURIComponent(persona)}`);
    await Promise.all([player.waitForURL(/\/Game\?challenge=/), player.click('a:has-text("Challenge")')]);
    const sent = await waitFrame(player, f => f.type === 198 || f.type === 197, 180000);
    step('the challenge reaches the persona', sent?.type === 198 && sent.p.name === persona + ' (AI)', JSON.stringify(sent?.p));
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
