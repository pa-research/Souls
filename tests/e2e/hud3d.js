// Screenshots of the 3D client's interface states. Usage: node hud3d.js <base> <outDir> [width height]
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2], out = process.argv[3];
const W = Number(process.argv[4] || 1600), H = Number(process.argv[5] || 900);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const touch = W < H || H < 500;
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true, hasTouch: touch })).newPage();
  page.setDefaultTimeout(180000);
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
  page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) problems.push(m.text()); });
  let n = 0;
  const shot = async name => { try { await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 78, timeout: 120000 }); } catch (e) { console.log('(skip ' + name + ')'); } };
  const name = 'h' + Date.now().toString(36);
  await page.goto(base + '/Player/Register');
  await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
  await page.check('#type-1');
  for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
  await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
  await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/Player/Login'));
  await page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await shot('loading');
  await page.waitForSelector('.sg-menu', { timeout: 180000 });
  await sleep(2500);
  await shot('menu');
  await page.click('.sg-menu-btn >> nth=1');
  await sleep(1200);
  await shot('queue');
  await page.waitForFunction(() => window.__souls3d && window.__souls3d.state().active, null, { timeout: 120000 });
  await sleep(2500);
  await shot('versus');
  await page.waitForSelector('.sg-mulligan-confirm'); await sleep(1200); await shot('mulligan');
  await page.click('.sg-mulligan-confirm');
  await sleep(6000);
  await shot('game');
  // Tooltip over the first hand card, then the enemy hero.
  const card = await page.evaluate('window.__souls3d.handCard(0)');
  if (!touch) { await page.mouse.move(card.x, card.y, { steps: 3 }); await sleep(1200); await shot('tooltip-card'); }
  const hero = await page.evaluate('window.__souls3d.opponentHero()');
  if (!touch) { await page.mouse.move(hero.x, hero.y, { steps: 3 }); await sleep(900); await shot('tooltip-hero'); }
  await page.evaluate(() => window.__souls3d.ui.banner('Your turn', { sub: 'Turn 3' }));
  await sleep(500);
  await shot('banner');
  await page.evaluate(() => { window.__souls3d.ui.screenMessage('Not enough mana!'); window.__souls3d.ui.hint('Rabid Bite: pick a target'); });
  await sleep(300);
  await shot('toasts');
  await page.click('.souls3d-views .sg-icon-btn');
  await sleep(600);
  await shot('settings');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__souls3d.ui.showEnd('Victory!', { statistics: 1, text: 'You win against [BOT] Satan (Hard)!', coins: 5, rating: 1032, ratingChange: 16,
    quests: [{ text: 'Win 2 normal games', progress: 1, target: 2, reward: 4, done: false }, { text: 'Play 12 cards', progress: 12, target: 12, reward: 2, done: true }, { text: 'Deal 40 damage to enemy heroes', progress: 23, target: 40, reward: 3, done: false }] }, { redirect: false }));
  await sleep(3500);
  await shot('end');
  console.log('problems:', problems.length ? problems.slice(0, 6) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
