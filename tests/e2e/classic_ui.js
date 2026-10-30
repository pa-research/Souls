// Classic client with the new interface: real practice game against the bot, screenshots of every state.
// Usage: node classic_ui.js <base> <outDir> [width height]
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2], out = process.argv[3];
const W = Number(process.argv[4] || 1600), H = Number(process.argv[5] || 900);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RESULT = [230, 231, 233];
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
  await sleep(8000);
  await shot('game');
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
      await page.click('.souls-classic-hud .sg-icon-btn').catch(() => {}); await sleep(800); await shot('settings'); await page.keyboard.press('Escape'); await sleep(400);
    }
    if (frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
    const end = await at(1608, 550);
    from = frames.length;
    await page.mouse.click(end.x, end.y);
    await waitFrame(f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
    await sleep(1200);
    if (turn === 0) await shot('banner');
  }
  console.log('counts', JSON.stringify(counts));
  await sleep(2000);
  await shot('later');
  console.log('problems:', problems.length ? problems.slice(0, 6) : 'none');
  if (problems.length || !created || !counts.played) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
