// The Discord Activity's channel room and Souls TV, in the 3D client.
// Two players whose Activity session names the same channel (sessionStorage, as the Activity's start page leaves it)
// open the game: no menu, and the channel's game starts by itself. A third player in the channel waits and is told
// who is playing. Then Souls TV plays finished games back, one after another, with nothing to pick.
// Usage: node channel_tv.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'channel_tv';
fs.mkdirSync(out, { recursive: true });
const { sleep, LAUNCH, steps, step, register } = require('./helpers')(base, out);
const render = process.env.E2E_NORENDER === '1' ? '&render=0' : '';

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const problems = [];

  const player = async (label, room) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(`${label}: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`));
    const name = label + Date.now().toString(36);
    await register(page, name);
    if (room) {
      // What the Activity's start page leaves for the game (the SDK cannot connect outside Discord: the game goes on without it).
      await page.addInitScript(r => sessionStorage.setItem('souls.discord', JSON.stringify({ clientId: '1', query: `?instance_id=${r}&frame_id=f`, accessToken: 'x' })), room);
    }
    return { page, name };
  };

  const room = 'e2e' + Date.now().toString(36);
  const a = await player('ca', room);
  const b = await player('cb', room);
  await a.page.goto(base + '/Game?mode=3d' + render, { waitUntil: 'domcontentloaded' });
  await a.page.waitForFunction(() => document.querySelector('.sg-queue') || document.querySelector('.sg-menu'), null, { timeout: 120000 });
  step('the Activity opens on the channel room, not the menu', !(await a.page.$('.sg-menu')) && !!(await a.page.$('.sg-queue')));
  await a.page.screenshot({ path: `${out}/1-waiting.jpg`, type: 'jpeg', quality: 70 });

  await b.page.goto(base + '/Game?mode=3d' + render, { waitUntil: 'domcontentloaded' });
  const started = await Promise.all([a, b].map(p => p.page.waitForFunction(() => window.__souls3d && window.__souls3d.sync() && window.__souls3d.state().active, null, { timeout: 120000 }).then(() => true, () => false)));
  step('the second player in the channel starts the game for both, with no challenge', started.every(Boolean));
  const modes = await Promise.all([a, b].map(p => p.page.evaluate(() => window.__souls3d.state().mode)));
  step('both play in the room', modes.every(m => m === 'room'), JSON.stringify(modes));
  await b.page.screenshot({ path: `${out}/2-playing.jpg`, type: 'jpeg', quality: 70 });

  const c = await player('cc', room);
  await c.page.goto(base + '/Game?mode=3d' + render, { waitUntil: 'domcontentloaded' });
  await c.page.waitForSelector('.sg-queue');
  const told = await c.page.waitForFunction(names => { const t = document.querySelector('.sg-queue p')?.textContent || ''; return names.every(n => t.includes(n)) ? t : null; }, [a.name, b.name], { timeout: 30000 })
    .then(h => h.jsonValue(), () => null);
  step('a third player waits and sees who is playing', !!told, told || '');

  // "Back" leaves the room for the menu on purpose.
  await c.page.click('.sg-queue .s-btn-ghost');
  await c.page.waitForSelector('.sg-menu', { timeout: 60000 });
  step('the menu is one click away, with Souls TV in it', /Souls TV/.test(await c.page.textContent('.sg-menu')));

  // Souls TV: a finished game (the community's live games end and leave replays) plays without picking.
  let next = null;
  for (let i = 0; i < 60 && !next; i++) {
    next = await c.page.evaluate(() => fetch('/Game/TvNext').then(r => (r.status === 200 ? r.json() : null)));
    if (!next) await sleep(10000);
  }
  step('Souls TV has a game to show', !!next, JSON.stringify(next));
  await c.page.goto(base + '/Game/Tv' + render.replace('&', '?'), { waitUntil: 'domcontentloaded' });
  const playing = await c.page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 120000 }).then(() => true, () => false);
  step('Souls TV plays it back', playing);
  const badge = await c.page.textContent('.sg-live').catch(() => '');
  step('the banner says Souls TV', /Souls TV/.test(badge || ''), badge || '');
  await c.page.screenshot({ path: `${out}/3-tv.jpg`, type: 'jpeg', quality: 70 });
  // The transport's last button goes on to the next game.
  await c.page.click('.souls3d-replay .sg-icon-btn:last-child');
  await sleep(4000);
  step('Next goes on to another game', await c.page.evaluate(() => window.__souls3d.state().active));

  if (problems.length) console.log('problems: ' + problems.join(' | '));
  const ok = steps.every(s => s.ok) && !problems.length;
  console.log(ok ? 'ALL PASS' : `${steps.filter(s => !s.ok).length} failures`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
