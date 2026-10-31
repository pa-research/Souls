// Both game clients in a language: a 3D and a classic practice game, on desktop and on a phone, with screenshots of
// the menu, matchmaking, mulligan, the game with its battle log, tooltips, settings and the end screen, then the
// game's summary page. Fails on English text or a raw key left in the interface (the text, labels and titles of the
// HTML interface; what the canvases draw is in the screenshots), and on console errors.
// Usage: node l10n_games.js <base> <outDir> [lang, default nb]
const { chromium } = require('playwright');
const fs = require('fs');
const { englishPhrases, leftovers, pickLanguage, locale } = require('./l10n');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'l10n-games';
const lang = process.argv[4] || 'nb';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const phrases = englishPhrases(lang);
const RESULT = [230, 231, 233];

const RUNS = [
  { client: '3d', device: 'desk', viewport: { width: 1600, height: 900 } },
  { client: '3d', device: 'phone', viewport: { width: 412, height: 915 }, touch: true },
  { client: 'classic', device: 'desk', viewport: { width: 1600, height: 900 } },
  { client: 'classic', device: 'phone', viewport: { width: 915, height: 412 }, touch: true },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];
  for (const run of RUNS) {
    const label = `${run.client}-${run.device}`;
    const ctx = await browser.newContext({ viewport: run.viewport, ignoreHTTPSErrors: true, hasTouch: !!run.touch, isMobile: !!run.touch, locale: locale(lang) });
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/GL Driver|GPU stall|api\.github/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
    const frames = [];
    page.on('websocket', ws => {
      if (!ws.url().endsWith('/game')) return;
      ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); frames.push({ type: j.Type, p: j.Payload }); } catch (e) { /* not JSON */ } });
    });
    const waitFrame = async (pred, timeout) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { const f = frames.find(pred); if (f) return f; await sleep(200); }
      return null;
    };
    let n = 0;
    // A screenshot, and the English left in the interface at that moment.
    const check = async name => {
      await sleep(600);
      const left = await leftovers(page, phrases);
      if (left.length) problems.push(`${label} ${name}: not in ${lang}: ${left.slice(0, 8).join('; ')}`);
      try { await page.screenshot({ path: `${out}/${label}-${String(++n).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 75, timeout: 120000 }); } catch (e) { console.log(`(${label} ${name}: no screenshot)`); }
      console.log(`${left.length ? 'FAIL' : 'PASS'} ${label} ${name}${left.length ? ' - ' + left.slice(0, 3).join('; ') : ''}`);
    };

    const name = label[0] + Date.now().toString(36).slice(-8);
    await page.goto(base + '/Player/Register');
    await page.fill('#Form_Username', name); await page.fill('#Form_Password', 'CorrectHorse9!'); await page.fill('#Form_ConfirmPassword', 'CorrectHorse9!');
    await page.check('#type-1');
    for (const box of (await page.$$('input.cards')).slice(0, 5)) await box.check();
    await page.click('main button[type=submit]'); await page.waitForURL(/Player\/Login/);
    await page.fill('#Name', name); await page.fill('#Password', 'CorrectHorse9!'); await page.click('main button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/Player/Login'));
    await pickLanguage(page, base, lang);

    await page.goto(`${base}/Game?mode=${run.client}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sg-menu', { timeout: 180000 });
    await sleep(2500);
    await check('menu');
    await page.click('.sg-menu-btn >> nth=1'); // practice
    await sleep(1200);
    await check('queue');
    await page.waitForSelector('.sg-mulligan-confirm', { timeout: 180000 });
    await sleep(1500);
    await check('mulligan');
    await page.click('.sg-mulligan-confirm');
    await waitFrame(f => f.type === 226, 60000);
    await sleep(5000);
    await check('game');

    // A few turns so the battle log and the board fill (end the turn; the bot plays its own).
    for (let turn = 0; turn < 2; turn++) {
      const mine = await waitFrame(f => f.type === 236 && f.p.current === 1 && f.p.turn === turn * 2, 120000);
      if (!mine || frames.some(f => RESULT.includes(f.type))) break;
      await sleep(1500);
      if (run.client === '3d') {
        const at = await page.evaluate('window.__souls3d.endTurn()');
        if (at) await page.mouse.click(at.x, at.y);
      } else {
        const box = await (await page.$('#game-window canvas')).boundingBox();
        await page.mouse.click(box.x + 1608 * box.width / 1920, box.y + 550 * box.height / 1080);
      }
      await waitFrame(f => f.type === 236 && f.p.current === 2 && f.p.turn === turn * 2 + 1, 30000);
      await waitFrame(f => f.type === 236 && f.p.current === 1 && f.p.turn === turn * 2 + 2, 120000);
      await sleep(3000);
    }
    await check('turns');

    if (!run.touch) {
      // Card and hero tooltips.
      if (run.client === '3d') {
        const card = await page.evaluate('window.__souls3d.handCard(0)');
        if (card) { await page.mouse.move(card.x, card.y, { steps: 3 }); await sleep(1200); await check('tooltip-card'); }
        const hero = await page.evaluate('window.__souls3d.opponentHero()');
        if (hero) { await page.mouse.move(hero.x, hero.y, { steps: 3 }); await sleep(1000); await check('tooltip-hero'); }
      } else {
        const box = await (await page.$('#game-window canvas')).boundingBox();
        await page.mouse.move(box.x + 956 * box.width / 1920, box.y + 141 * box.height / 1080, { steps: 3 }); await sleep(1200); await check('tooltip-hero');
        await page.mouse.move(box.x + 165 * box.width / 1920, box.y + 980 * box.height / 1080, { steps: 3 }); await sleep(1200); await check('tooltip-card');
      }
    }

    // Settings (with the language switch), then the leave dialog.
    await page.click(run.client === '3d' ? '.souls3d-views .sg-icon-btn' : '.souls-classic-hud .sg-icon-btn').catch(() => {});
    await sleep(800);
    await check('settings');
    await page.keyboard.press('Escape'); await sleep(400);

    if (run.client === '3d') {
      // The end screen as the server sends it (a real ending takes many turns), with keys for every text.
      await page.evaluate(() => window.__souls3d.ui.showEnd('Victory!', {
        statistics: 1, text: 'ann wins against ben!', textKey: 'log.win', textArgs: { winner: 'ann', loser: 'ben' }, coins: 5, rating: 1032, ratingChange: 16,
        quests: [
          { text: 'Win 2 normal games', textKey: 'quest.winGames', textArgs: { n: 2 }, progress: 1, target: 2, reward: 4, done: false },
          { text: 'Play 12 cards', textKey: 'quest.playCards', textArgs: { n: 12 }, progress: 12, target: 12, reward: 2, done: true }],
        season: { number: 1, name: 'Season 1', nameKey: 'season.name', nameArgs: { n: 1 },
          before: { rating: 1040, rank: 1, tier: 'Bronze III', tierKey: 'tier.division', tierArgs: { tier: { key: 'tier.bronze' }, division: 'III' }, css: 'tier-bronze' },
          after: { rating: 1056, rank: 2, tier: 'Bronze II', tierKey: 'tier.division', tierArgs: { tier: { key: 'tier.bronze' }, division: 'II' }, css: 'tier-bronze' },
          promoted: true, demoted: false },
      }, { kind: 'victory', redirect: false }));
      await sleep(3500);
      await check('end');
    }

    // Leave (a practice game is lost at once) and look at the game's summary page.
    await page.evaluate(() => window.SoulsGameMode.leave(true));
    await sleep(500);
    await check('leave-dialog');
    await Promise.all([page.waitForURL(/\/Game$/), page.click('#sg-leave button[value=leave]')]);
    await sleep(3000);
    const games = await (await ctx.request.get(base + '/Home/GetGames')).json();
    const game = games.find(g => g.player1 === name || g.player2 === name);
    if (game) {
      await page.goto(`${base}/Game/Stats/${game.gameId}`);
      await check('stats');
    } else {
      problems.push(`${label}: the game was not stored`);
    }
    await ctx.close();
  }
  console.log('problems:', problems.length ? problems.slice(0, 30) : 'none');
  if (problems.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
