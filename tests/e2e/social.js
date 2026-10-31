// Friendly challenges and emotes between a 3D player (A) and a classic player (B).
// Round 1: A challenges B from the Friendly lobby, B accepts; both see the unranked game; A emotes and B sees it,
// B emotes and A sees it; B mutes A and A's next emote does not reach B; B resigns; nobody's rating moves.
// Round 2: B opens a challenge link (/Game?challenge=A) in the classic client, A declines in 3D.
// Usage: node social.js <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'social';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const step = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
let shot = 0;

async function session(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const s = { label, page, frames: [], problems: [] };
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) s.problems.push(m.text()); });
  page.on('pageerror', e => s.problems.push('pageerror: ' + e.message));
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/game')) return;
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'in', type: j.Type, p: j.Payload }); } catch (e) { } });
    ws.on('framesent', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'out', type: j.Type, p: j.Payload }); } catch (e) { } });
  });
  return s;
}
async function waitFrame(s, pred, from = 0, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = from; i < s.frames.length; i++) if (pred(s.frames[i])) return s.frames[i];
    await sleep(100);
  }
  return null;
}
async function snap(s, name) {
  try { await s.page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${s.label}-${name}.jpg`, type: 'jpeg', quality: 80 }); } catch (e) { console.log(`(screenshot ${name} skipped)`); }
}
async function register(s, name, type) {
  const p = s.page;
  await p.goto(base + '/Player/Register');
  await p.fill('#Form_Username', name);
  await p.fill('#Form_Password', 'CorrectHorse9!');
  await p.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await p.check(`#type-${type}`);
  for (const box of (await p.$$('input.cards')).slice(0, 5)) await box.check();
  await p.click('main button[type=submit]');
  await p.waitForURL(/Player\/Login/);
  await p.fill('#Name', name);
  await p.fill('#Password', 'CorrectHorse9!');
  await p.click('main button[type=submit]');
  await p.waitForURL(u => !u.toString().includes('/Player/Login'));
}
/** Opens the game page in a client and returns the player's rating from the page config. */
async function openGame(s, query) {
  await s.page.goto(`${base}/Game?${query}`, { waitUntil: 'domcontentloaded' });
  return s.page.evaluate(() => JSON.parse(document.getElementById('souls-game-config').textContent).profile.rating);
}
async function friendlyLobby(s) {
  await s.page.waitForSelector('.sg-menu', { timeout: 180000 });
  const from = s.frames.length;
  await s.page.click('.sg-menu-btn:has-text("Friendly")');
  await s.page.waitForSelector('.sg-challenge input');
  return !!(await waitFrame(s, f => f.dir === 'in' && f.type === 10, from));
}
const bubble = (s, cls) => s.page.$eval(`.sg-bubble.${cls}`, e => e.textContent).catch(() => null);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const A = await session(browser, 'A-3d');
  const B = await session(browser, 'B-classic');
  const id = Date.now().toString(36).slice(-6);
  const nameA = 'emA' + id, nameB = 'emB' + id;
  await register(A, nameA, 1);
  await register(B, nameB, 3);

  // ---- Round 1: A challenges B, B accepts ------------------------------------------------------------------------
  const ratingB = await openGame(B, 'mode=classic');
  step('B waits in the classic Friendly lobby', await friendlyLobby(B));
  const ratingA = await openGame(A, 'mode=3d');
  step('A opens the 3D Friendly lobby', await friendlyLobby(A));

  let from = A.frames.length;
  await A.page.fill('.sg-challenge input', nameB);
  await A.page.click('.sg-challenge button[type=submit]');
  step('A: challenge sent', !!(await waitFrame(A, f => f.dir === 'in' && f.type === 198, from)));
  await B.page.waitForSelector('.sg-invite', { timeout: 15000 }).catch(() => null);
  const invite = await B.page.$eval('.sg-invite', e => e.textContent).catch(() => '');
  step('B: the invitation names A', invite.includes(`${nameA} challenges you`), invite);
  await snap(A, 'waiting');
  await snap(B, 'invite');

  const fromA = A.frames.length, fromB = B.frames.length;
  await B.page.click('.sg-invite button:has-text("Accept")');
  const createA = await waitFrame(A, f => f.dir === 'in' && f.type === 206, fromA);
  const createB = await waitFrame(B, f => f.dir === 'in' && f.type === 206, fromB);
  step('Both get the game', !!createA && !!createB);
  await A.page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 30000 }).catch(() => null);
  await sleep(5000); // the versus splash
  // Both keep their starting hand (the mulligan screen covers the emote buttons).
  await A.page.click('.sg-mulligan-confirm'); await B.page.click('.sg-mulligan-confirm');
  await waitFrame(A, f => f.dir === 'in' && f.type === 226, fromA, 30000);
  await sleep(2000);
  await snap(A, 'game');
  await snap(B, 'game');

  // ---- Emotes ----------------------------------------------------------------------------------------------------
  from = B.frames.length;
  await A.page.click('.souls3d-views [aria-label="Emotes"]');
  await snap(A, 'emote-panel');
  await A.page.click('.souls3d-emotes button:has-text("Well played!")');
  const got = await waitFrame(B, f => f.dir === 'in' && f.type === 299, from, 8000);
  step('B receives A\'s emote', !!got && got.p.text === 'Well played!');
  await sleep(400);
  step('A sees its own bubble', (await bubble(A, 'mine')) === 'Well played!');
  step('B (classic) shows A\'s bubble', (await bubble(B, 'theirs')) === 'Well played!');
  await snap(A, 'emote-sent');
  await snap(B, 'emote-received');

  await sleep(3000);
  await B.page.click('.souls-classic-emotes-btn');
  await B.page.click('.souls-classic-emotes button:has-text("Greetings!")');
  await sleep(600);
  step('A (3D) shows B\'s bubble', (await bubble(A, 'theirs')) === 'Greetings!');
  await snap(A, 'emote-from-classic');

  await sleep(3000);
  from = B.frames.length;
  await B.page.click('.souls-classic-emotes-btn');
  await B.page.click('.souls-classic-emotes button:has-text("Mute opponent")');
  step('B mutes A', !!(await waitFrame(B, f => f.dir === 'out' && f.type === 298 && f.p.muted === true, from, 5000)));
  await B.page.keyboard.press('Escape');
  await sleep(1000);
  from = B.frames.length;
  const fromEcho = A.frames.length;
  await A.page.click('.souls3d-views [aria-label="Emotes"]');
  await A.page.click('.souls3d-emotes button:has-text("Thanks!")');
  step('A still sees its own emote', !!(await waitFrame(A, f => f.dir === 'in' && f.type === 299 && f.p.emote === 2, fromEcho, 5000)));
  await sleep(2000);
  step('B no longer receives A\'s emotes', !B.frames.slice(from).some(f => f.dir === 'in' && f.type === 299));
  step('B shows no bubble from A', (await bubble(B, 'theirs')) === null);
  await snap(B, 'muted');

  // ---- B resigns (a second socket logs in and logs out, which forfeits at once) -----------------------------------
  const fromEnd = A.frames.length;
  await B.page.evaluate(() => new Promise(resolve => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/game`);
    ws.onopen = () => { ws.send(JSON.stringify({ Type: 0, Payload: {} })); ws.send(JSON.stringify({ Type: 1, Payload: {} })); };
    ws.onmessage = e => { if (JSON.parse(e.data).Type === 1) { ws.close(); resolve(); } };
    setTimeout(resolve, 8000);
  }));
  const end = await waitFrame(A, f => f.dir === 'in' && [230, 231, 233].includes(f.type), fromEnd, 20000);
  // B's page never saw the end of the game: forget it, or the next game page would resume it.
  await B.page.goto(base + '/');
  await B.page.evaluate(() => sessionStorage.clear());
  step('A wins when B resigns', !!end && end.type === 230);
  step('A friendly game earns nothing', !!end && end.p.friendly === true && end.p.coins === 0 && end.p.ratingChange === null && !end.p.quests && !end.p.season,
    end && JSON.stringify({ friendly: end.p.friendly, coins: end.p.coins, ratingChange: end.p.ratingChange, quests: end.p.quests, season: end.p.season }));
  await sleep(2500);
  const reward = await A.page.$$eval('.sg-reward span', els => els.map(e => e.textContent).join(' | ')).catch(() => '');
  step('A\'s end screen says a friendly game has no rewards', reward === 'Friendly game: no rewards', reward);
  await snap(A, 'end');
  if (end && end.p.statistics) {
    await A.page.goto(`${base}/Game/Stats/${end.p.statistics}`);
    const html = await A.page.content();
    step('Stats page: friendly game with a Challenge button', html.includes('Friendly game') && (await A.page.$(`a[href*="challenge=${nameB}"]`)) !== null);
    await snap(A, 'stats');
  }

  const afterA = await openGame(A, 'mode=3d');
  const afterB = await openGame(B, 'mode=classic');
  step('Ratings unchanged', afterA === ratingA && afterB === ratingB, `A ${ratingA}->${afterA}, B ${ratingB}->${afterB}`);

  // ---- Round 2: B challenges A from a link, A declines -----------------------------------------------------------
  step('A waits in the 3D Friendly lobby', await friendlyLobby(A));
  from = B.frames.length;
  await B.page.goto(`${base}/Game?challenge=${encodeURIComponent(nameA)}`, { waitUntil: 'domcontentloaded' });
  step('B: challenge link sends the challenge', !!(await waitFrame(B, f => f.dir === 'in' && f.type === 198, from, 60000)));
  await A.page.waitForSelector('.sg-invite', { timeout: 15000 }).catch(() => null);
  await snap(A, 'invite');
  await snap(B, 'waiting');
  from = B.frames.length;
  await A.page.click('.sg-invite button:has-text("Decline")');
  const closed = await waitFrame(B, f => f.dir === 'in' && f.type === 197, from, 10000);
  step('B is told A declined', !!closed && closed.p === `${nameA} declined your challenge.`, closed && closed.p);
  await sleep(500);
  const lobby = await B.page.$eval('.sg-queue p', e => e.textContent).catch(() => '');
  step('B\'s lobby shows it', lobby.includes('declined'), lobby);
  await snap(B, 'declined');

  for (const s of [A, B]) step(`${s.label}: no console errors`, s.problems.length === 0, s.problems.slice(0, 5).join(' / '));
  await browser.close();
  console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
