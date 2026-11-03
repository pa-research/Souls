// The Discord Activity's channel room and Souls TV, in the 3D client.
// Two players whose Activity session names the same channel (sessionStorage, as the Activity's start page leaves it)
// open the game: no menu, and the channel's game starts by itself. A third player in the channel waits, watching that
// game; when it ends (a player leaves: give the server a short Souls__Matchmaker__ReconnectGracePeriod) the winner
// and the waiting player play the next one by themselves, without a reload. Then Souls TV plays finished games back,
// one after another, with nothing to pick.
// Usage: node channel_tv.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'channel_tv';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const render = process.env.E2E_NORENDER === '1' ? '&render=0' : '';

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = [];
  const problems = [];
  const step = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };

  const player = async (label, room) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(`${label}: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`));
    const name = label + Date.now().toString(36);
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
  const firstGame = await a.page.evaluate(() => window.__souls3d.state().gameId);
  const watching = await c.page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 60000 }).then(() => true, () => false);
  const banner = await c.page.textContent('.souls3d-banner').catch(() => '');
  step('meanwhile it watches the channel\'s game', watching && /next game/.test(banner || ''), banner || '');
  await c.page.screenshot({ path: `${out}/2b-watching.jpg`, type: 'jpeg', quality: 70 });

  // B leaves: A wins once the grace period ends, comes back to the room by itself and plays C, who was waiting.
  await b.page.close();
  const loads = await a.page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + performance.timeOrigin);
  const rematch = await Promise.all([a, c].map(p => p.page.waitForFunction(first => {
    const s = window.__souls3d && window.__souls3d.state();
    return s && s.active && !s.ended && s.gameId && s.gameId !== first ? s.gameId : null;
  }, firstGame, { timeout: 240000 }).then(h => h.jsonValue(), () => null)));
  step('after the game the winner and the waiting player play the next one by themselves', !!rematch[0] && rematch[0] === rematch[1], JSON.stringify({ firstGame, rematch }));
  step('without reloading the page', loads === await a.page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + performance.timeOrigin));
  await c.page.screenshot({ path: `${out}/2c-next.jpg`, type: 'jpeg', quality: 70 });

  // The menu (one click away from the room) has Souls TV; a player outside any game opens it (C plays A now, and
  // opening the game page takes C back into that game).
  const d = await player('cd', null);
  await d.page.goto(base + '/Game?mode=3d&menu=1' + render, { waitUntil: 'domcontentloaded' });
  await d.page.waitForSelector('.sg-menu', { timeout: 60000 });
  step('the menu has Souls TV', /Souls TV/.test(await d.page.textContent('.sg-menu')));

  // Souls TV: a finished game (the community's live games end and leave replays) plays without picking.
  let next = null;
  for (let i = 0; i < 60 && !next; i++) {
    next = await d.page.evaluate(() => fetch('/Game/TvNext').then(r => (r.status === 200 ? r.json() : null)));
    if (!next) await sleep(10000);
  }
  step('Souls TV has a game to show', !!next, JSON.stringify(next));
  await d.page.goto(base + '/Game/Tv' + render.replace('&', '?'), { waitUntil: 'domcontentloaded' });
  const playing = await d.page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 120000 }).then(() => true, () => false);
  step('Souls TV plays it back', playing);
  const badge = await d.page.textContent('.sg-live').catch(() => '');
  step('the banner says Souls TV', /Souls TV/.test(badge || ''), badge || '');
  await d.page.screenshot({ path: `${out}/3-tv.jpg`, type: 'jpeg', quality: 70 });
  // The transport's last button goes on to the next game.
  await d.page.click('.souls3d-replay .sg-icon-btn:last-child');
  await sleep(4000);
  step('Next goes on to another game', await d.page.evaluate(() => window.__souls3d.state().active));

  if (problems.length) console.log('problems: ' + problems.join(' | '));
  const ok = results.every(Boolean) && !problems.length;
  console.log(ok ? 'ALL PASS' : `${results.filter(r => !r).length} failures`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
