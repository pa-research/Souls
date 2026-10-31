// Classic client with the new interface: real practice game against the bot, screenshots of every state. The board
// keeps its 16:9 shape at any window size with the HUD over it, messages stay off the heroes and hero powers, and the
// leave dialog works (leave_dialog.js).
// Usage: node classic_ui.js <base> <outDir> [width height]
const { chromium } = require('playwright');
const fs = require('fs');
const { checkLeaveDialog, leaveWithEnter } = require('./leave_dialog');
const base = process.argv[2], out = process.argv[3];
const W = Number(process.argv[4] || 1600), H = Number(process.argv[5] || 900);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RESULT = [230, 231, 233];
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const LEAVE = { label: 'classic', settings: '.souls-classic-settings-btn', leave: '.souls-classic-settings .s-btn-danger' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const touch = H < 500;
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true, hasTouch: touch })).newPage();
  page.setDefaultTimeout(180000);
  const problems = [], frames = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) problems.push(m.text()); });
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/game')) return;
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'in', type: j.Type, p: j.Payload }); } catch (e) {} });
    ws.on('framesent', f => { try { const j = JSON.parse(f.payload); frames.push({ dir: 'out', type: j.Type, p: j.Payload }); } catch (e) {} });
  });
  const waitFrame = async (pred, from = 0, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { for (let i = from; i < frames.length; i++) if (pred(frames[i])) return frames[i]; await sleep(100); }
    return null;
  };
  let n = 0;
  const shot = async name => { try { await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 78, timeout: 120000 }); } catch (e) { console.log('(skip ' + name + ')'); } };
  const at = async (gx, gy) => { const box = await (await page.$('canvas')).boundingBox(); return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 }; };
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y); await sleep(300); await page.mouse.down(); await sleep(200);
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await sleep(400);
    await page.mouse.move(b.x, b.y, { steps: 8 }); await sleep(400); await page.mouse.up(); await sleep(300);
  };
  const name = 'c' + Date.now().toString(36);
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check('#type-1');
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  await page.goto(base + '/Game?mode=classic', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await shot('boot');
  await page.waitForSelector('.sg-menu', { timeout: 180000 });
  await sleep(1500);
  await shot('menu');
  await page.click('.sg-menu-row .s-seg button >> nth=2');
  await page.click('.sg-menu-btn >> nth=1');
  await sleep(1000);
  await shot('queue');
  const created = await waitFrame(f => f.dir === 'in' && f.type === 206, 0, 90000);
  console.log('created', !!created, created && created.p.opponent.info.name, 'difficulty sent', JSON.stringify(frames.find(f => f.dir === 'out' && f.type === 101)?.p));
  await waitFrame(f => f.dir === 'in' && f.type === 236, 0, 30000);
  await page.waitForSelector('.sg-mulligan-confirm', { timeout: 30000 }); await sleep(1500); await shot('mulligan');
  await page.click('.sg-mulligan-confirm');
  console.log('mulligan', JSON.stringify((await waitFrame(f => f.dir === 'in' && f.type === 227, 0, 15000))?.p.replaced));
  await sleep(8000);
  await shot('game');
  // The stage keeps 16:9 (bars beside or above it at other shapes) and the HUD lies exactly over it.
  const boxes = await page.evaluate(() => [document.querySelector('#game-window canvas'), document.querySelector('.souls-classic-hud')]
    .map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
  const [canvas, hud] = boxes;
  step('the board keeps its 16:9 shape, centred, with the HUD over it', Math.abs(canvas.w / canvas.h - 16 / 9) < 0.01
    && (canvas.w === W || canvas.h === H) && Math.abs(canvas.x * 2 + canvas.w - W) <= 2 && Math.abs(canvas.y * 2 + canvas.h - H) <= 2
    && JSON.stringify(canvas) === JSON.stringify(hud), JSON.stringify(boxes));
  // Messages go over the middle of the board, off both heroes (stage 960,955 and 960,125) and the hero powers.
  await page.evaluate(() => new Promise(done => window.require(['hud'], h => { h.Toast('Not enough mana!'); h.Toast('Not your turn!'); done(); })));
  await sleep(400);
  const placed = await page.evaluate(() => [...document.querySelectorAll('.souls-classic-hud .sg-toast, .souls-classic-hud .sg-power')]
    .map(e => { const r = e.getBoundingClientRect(); return { toast: e.classList.contains('sg-toast'), x: r.left, y: r.top, w: r.width, h: r.height }; }));
  const heroes = [];
  for (const y of [955, 125]) { const a = await at(960 - 150, y - 125), b = await at(960 + 150, y + 125); heroes.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }); }
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const toasts = placed.filter(r => r.toast);
  step('messages show over the middle of the board, off the heroes and hero powers', toasts.length === 2
    && !toasts.some(t => heroes.some(r => hit(t, r)) || placed.some(r => !r.toast && hit(t, r))), JSON.stringify(toasts.map(t => [Math.round(t.y), Math.round(t.h)])));
  await shot('toasts');
  const counts = { played: 0, powers: 0, attacks: 0 };
  for (let turn = 0; turn < 4; turn++) {
    const mine = await waitFrame(f => f.dir === 'in' && ((f.type === 236 && f.p.current === 1 && f.p.turn === turn * 2) || RESULT.includes(f.type)), 0, 180000);
    if (!mine || RESULT.includes(mine.type)) break;
    await sleep(2500);
    let from = frames.length;
    // Try the hand cards from the left until one is affordable (the visible strip of each card, as in the 3D hooks).
    const handSize = (frames.filter(f => f.dir === 'in' && f.type === 236).pop()?.p.heroes['1'].hand) ?? 1;
    for (let k = 0; k < handSize; k++) {
      from = frames.length;
      const last = k === handSize - 1;
      await drag(await at(165 + 60 * k + (last ? 0 : -45), 980), await at(520 + 147.7 * (3 + turn % 3), 700));
      const answer = await waitFrame(f => f.dir === 'in' && [207, 208, 213].includes(f.type), from, 6000);
      if (answer && answer.type === 207) { counts.played++; break; }
      await sleep(800);
    }
    await sleep(2500);
    const sync = frames.filter(f => f.dir === 'in' && f.type === 236).pop();
    if (sync && sync.p.heroes['1'].canUsePower) {
      from = frames.length;
      const power = await page.$('.sg-power');
      const box = power && await power.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(800);
        if (counts.powers === 0) await shot('power-armed');
        const target = await at(956, 141);
        await page.mouse.click(target.x, target.y);
        if (await waitFrame(f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t === 'heroPower'), from, 10000)) counts.powers++;
        await sleep(2500);
      }
    }
    from = frames.length;
    await drag(await at(956, 960), await at(956, 141));
    if (await waitFrame(f => f.dir === 'in' && f.type === 235 && f.p.events.some(e => e.t === 'attack'), from, 10000)) counts.attacks++;
    await sleep(3000);
    if (turn === 1) {
      if (!touch) { const h = await at(956, 141); await page.mouse.move(h.x, h.y, { steps: 3 }); await sleep(1200); await shot('tooltip'); }
      await page.click('.souls-classic-hud .sg-icon-btn').catch(() => {}); await sleep(800); await shot('settings');
      await page.click(LEAVE.leave); await sleep(600); await shot('leave-dialog');
      await page.keyboard.press('Escape'); await sleep(400); await page.keyboard.press('Escape'); await sleep(400);
      await checkLeaveDialog(page, step, LEAVE);
    }
    if (frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
    if (turn === 3) {
      // The last turn here: leave through the dialog with Enter (the hard bot may win soon after).
      await shot('later');
      await leaveWithEnter(page, step, LEAVE);
      await shot('left');
      break;
    }
    const end = await at(1608, 550);
    from = frames.length;
    await page.mouse.click(end.x, end.y);
    await waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
    await sleep(1200);
    if (turn === 0) await shot('banner');
  }
  console.log('counts', JSON.stringify(counts));
  console.log('problems:', problems.length ? problems.slice(0, 6) : 'none');
  if (problems.length || !created || !counts.played || steps.some(s => !s.ok)) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
