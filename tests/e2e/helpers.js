// What the scripts share: players in their own browser (or a shared one) with their game frames and console problems,
// registering and logging in, steps, screenshots, and the moves of a scripted 3D or classic player.
// Usage: const { step, session, ... } = require('./helpers')(base, out, { quality, expected });
//   quality:  JPEG quality of the screenshots (default 75)
//   expected: console errors that are not problems (default: the software GPU's and the GitHub feed's)
const { chromium } = require('playwright');

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Game over: won, lost, the opponent left.
const RESULT = [230, 231, 233];
// WebGL in software, for a runner without a GPU.
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const NOISE = /GL Driver|GPU stall|api\.github/;
const PASSWORD = 'CorrectHorse9!';

module.exports = (base, out, { quality = 75, expected = NOISE } = {}) => {
  const steps = [];
  const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
  let shot = 0;

  /** A player in its own browser, or in <browser> with the context options given; records the game and chat frames. */
  async function session(label, { browser, ...context } = {}) {
    const own = !browser;
    if (own) browser = await chromium.launch(LAUNCH);
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, ...context });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    const s = { label, browser: own ? browser : undefined, page, frames: [], chat: [], problems: [], sockets: 0, closes: 0 };
    page.on('console', m => { if (m.type() === 'error' && !expected.test(m.text())) s.problems.push(m.text()); });
    page.on('pageerror', e => s.problems.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' / ')));
    page.on('websocket', ws => {
      if (ws.url().endsWith('/chat')) {
        ws.on('framereceived', f => { try { s.chat.push(JSON.parse(f.payload)); } catch (e) {} });
        return;
      }
      if (!ws.url().endsWith('/game')) return;
      s.sockets++;
      ws.on('close', () => s.closes++);
      ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'in', type: j.Type, p: j.Payload, t: Date.now() }); } catch (e) {} });
      ws.on('framesent', f => { try { const j = JSON.parse(f.payload); s.frames.push({ dir: 'out', type: j.Type, p: j.Payload, t: Date.now() }); } catch (e) {} });
    });
    return s;
  }
  /** The first frame from index <from> on that matches, or null after <timeout> ms. */
  async function waitFrame(s, pred, from = 0, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (let i = from; i < s.frames.length; i++) if (pred(s.frames[i])) return s.frames[i];
      await sleep(100);
    }
    return null;
  }
  const last = (s, pred) => [...s.frames].reverse().find(pred);
  const ended = s => s.frames.some(f => f.dir === 'in' && RESULT.includes(f.type));
  async function snap(s, name) {
    const file = `${out}/${String(++shot).padStart(2, '0')}-${s.label ? s.label + '-' : ''}${name}.jpg`;
    try { await s.page.screenshot({ path: file, type: 'jpeg', quality, timeout: 90000 }); } catch (e) { console.log(`(screenshot ${name} skipped)`); }
  }

  // Both take a session or a page.
  async function login(s, name, password = PASSWORD) {
    const p = s.page || s;
    await p.goto(base + '/Player/Login');
    await p.fill('#Name', name); await p.fill('#Password', password); await p.click('main button[type=submit]');
    await p.waitForURL(u => !u.toString().includes('/Player/Login'));
  }
  /** Registers a player of class <type> with the starter <cards> (topped up to five) and logs it in. */
  async function register(s, name, type = 1, cards = []) {
    const p = s.page || s;
    await p.goto(base + '/Player/Register');
    await p.fill('#Form_Username', name);
    await p.fill('#Form_Password', PASSWORD);
    await p.fill('#Form_ConfirmPassword', PASSWORD);
    await p.check(`#type-${type}`);
    for (const id of cards) await p.check(`#card-${id}`);
    for (const box of (await p.$$('input.cards:not(:checked)')).slice(0, 5 - cards.length)) await box.check();
    await p.click('main button[type=submit]');
    await p.waitForURL(/Player\/Login/);
    await p.fill('#Name', name);
    await p.fill('#Password', PASSWORD);
    await p.click('main button[type=submit]');
    await p.waitForURL(u => !u.toString().includes('/Player/Login'));
  }

  /** A practice game against the Easy bot in <mode> (3d or classic), past the mulligan; the game-created frame. */
  async function startPractice(s, mode) {
    await s.page.goto(`${base}/Game?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await s.page.waitForSelector('.sg-menu', { timeout: 180000 });
    await sleep(800);
    await s.page.click('.sg-menu-row .s-seg button >> nth=0'); // Easy
    await s.page.click('.sg-menu-btn >> nth=1');
    const created = await waitFrame(s, f => f.dir === 'in' && f.type === 206, 0, 90000);
    await s.page.waitForSelector('.sg-mulligan-confirm', { timeout: 60000 }); await sleep(1500);
    await s.page.click('.sg-mulligan-confirm');
    await waitFrame(s, f => f.dir === 'in' && f.type === 226, 0, 60000);
    await sleep(3000);
    return created;
  }
  /**
   * Waits for the player's turn, also in the client: it plays the messages in order with their animations and may lag
   * behind the socket (End Turn does nothing until it has). False when the game ended or the turn never came.
   */
  async function myTurn(s, ident, turnFrom) {
    const f = await waitFrame(s, x => x.dir === 'in' && ((x.type === 236 && x.p.current === ident) || RESULT.includes(x.type)), turnFrom, 180000);
    if (!f || f.type !== 236) return false;
    return s.page.waitForFunction(() => window.__souls3d ? window.__souls3d.state().yourTurn : !!(window.gameEngine && window.gameEngine.myTurn),
      null, { timeout: 60000, polling: 300 }).then(() => true, () => false);
  }

  // 3D: the test hooks (null once the page has left the game), and a mouse drag between two points of them.
  const hook = (s, expr) => s.page.evaluate(`window.__souls3d ? window.__souls3d.${expr} : null`);
  async function drag(s, from, to, button = 'left') {
    if (!from || !to) { console.log('drag skipped: a target is not on screen yet'); await sleep(800); return; }
    const m = (s.page || s).mouse;
    await m.move(from.x, from.y, { steps: 3 }); await sleep(250);
    await m.down({ button }); await sleep(200);
    await m.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
    await m.move(to.x, to.y, { steps: 6 }); await sleep(400);
    await m.up({ button }); await sleep(300);
  }
  // Classic: stage coordinates (1920x1080) to page coordinates.
  async function at(s, gx, gy) {
    const canvas = await s.page.$('canvas');
    if (!canvas) {
      console.log('no canvas: url', s.page.url(), 'problems', s.problems.slice(0, 5), 'frames', s.frames.slice(-15).map(f => `${f.dir}${f.type}`).join(' '));
      console.log('body:', (await s.page.evaluate(() => document.body.innerHTML.slice(0, 600))));
      await snap(s, 'no-canvas');
      throw new Error(`${s.label}: classic canvas gone`);
    }
    const box = await canvas.boundingBox();
    return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 };
  }
  async function classicDrag(s, from, to) {
    const a = await at(s, from[0], from[1]); const b = await at(s, to[0], to[1]);
    await s.page.mouse.move(a.x, a.y); await sleep(150);
    await s.page.mouse.down(); await sleep(150);
    await s.page.mouse.move(b.x, b.y, { steps: 25 }); await sleep(300);
    await s.page.mouse.up(); await sleep(400);
  }

  // A turn in 3D: play up to `cards` cards (no spells), the hero power on the enemy hero if `power`, attack with ready
  // cards and the hero, end the turn unless `keep` (the turn stays open, for example for a restart).
  async function turn3d(s, ident, { cards = 3, power = false, keep = false } = {}) {
    for (let k = 0; k < cards; k++) {
      const st = await hook(s, 'state()');
      if (!st) return;
      const taken = new Set(st.board.map(b => b.slotId));
      const slot = [3, 2, 4, 1, 5, 0, 6].find(i => !taken.has(i));
      const pick = st.hand.findIndex(c => c.cost <= st.mana && !c.pending && !c.spell);
      if (pick < 0 || slot === undefined) break;
      const from = s.frames.length;
      await drag(s, await hook(s, `handCard(${pick})`), await hook(s, `slot(${slot})`));
      await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232 || f.type === 213), from, 8000);
      await sleep(800);
    }
    if (keep) return;
    let sync = await hook(s, 'sync()');
    if (power && sync && sync.heroes[ident].canUsePower) {
      const button = await hook(s, 'power()');
      if (button && !button.disabled) {
        const from = s.frames.length;
        await s.page.mouse.click(button.x, button.y); await sleep(400);
        const t = await hook(s, 'opponentHero()');
        await s.page.mouse.move(t.x, t.y, { steps: 3 }); await sleep(200);
        await s.page.mouse.click(t.x, t.y);
        await waitFrame(s, f => f.dir === 'in' && f.type === 236, from, 8000);
        await sleep(800);
      }
    }
    for (let k = 0; k < 6; k++) {
      sync = await hook(s, 'sync()');
      if (!sync || sync.current !== ident || (await hook(s, 'state()')).ended) return;
      const ready = (sync.board[ident] || []).filter(c => c.canAct && c.attack > 0);
      if (!ready.length) break;
      const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
      const from = s.frames.length;
      const src = await hook(s, `boardCard(${ready[0].cid})`);
      const dst = taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()');
      if (!src || !dst) break;
      await drag(s, src, dst);
      const ev = await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
      if (!ev || ev.type === 232) break;
      await sleep(1400);
    }
    sync = await hook(s, 'sync()');
    if (sync && sync.current === ident && sync.heroes[ident].canAttack) {
      const taunts = (sync.board[3 - ident] || []).filter(c => c.taunt);
      const from = s.frames.length;
      await drag(s, await hook(s, 'hero()'), taunts.length ? await hook(s, `opponentCard(${taunts[0].cid})`) : await hook(s, 'opponentHero()'));
      await waitFrame(s, f => f.dir === 'in' && (f.type === 236 || f.type === 232), from, 8000);
      await sleep(1400);
    }
    if (ended(s)) return;
    await endTurn3d(s);
  }
  async function endTurn3d(s) {
    const sign = await hook(s, 'endTurn()');
    const from = s.frames.length;
    await s.page.mouse.click(sign.x, sign.y);
    await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
  }
  // A turn in the classic client: play the first hand card, the hero attacks the enemy hero, end the turn unless `keep`.
  async function turnClassic(s, turn, { keep = false } = {}) {
    await classicDrag(s, [175, 965], [520 + 147.7 * (3 + (turn % 3)), 700]);
    await sleep(1500);
    if (keep) return;
    await classicDrag(s, [956, 960], [956, 141]);
    await sleep(2500);
    if (ended(s)) return;
    const from = s.frames.length;
    const p = await at(s, 1608, 550);
    await s.page.mouse.click(p.x, p.y);
    await waitFrame(s, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), from, 10000);
  }

  return {
    sleep, RESULT, LAUNCH, NOISE, PASSWORD, steps, step, session, waitFrame, last, ended, snap, login, register,
    startPractice, myTurn, hook, drag, at, classicDrag, turn3d, endTurn3d, turnClassic,
  };
};
