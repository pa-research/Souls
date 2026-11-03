// Spells end to end. The admin makes four spells starter cards in the card editor (and puts them back at the end); fresh
// players pick them, find them in the shop and the deck builder, and cast them from the hand against the Easy bot:
// in the 3D client (an arrow from the hand onto the enemy hero, a spell without a target dropped over the board)
// watched by a spectator, in the classic client, and on a phone (tap the spell, then tap the target).
// Usage: node spells.js <base> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'https://localhost';
const out = process.argv[3] || 'spells';
fs.mkdirSync(out, { recursive: true });
const adminPassword = process.env.SOULS_ADMIN_PASSWORD
  || fs.readFileSync(path.join(__dirname, '../../deploy/compose/secrets/Souls__Admin__Password'), 'utf8').trim();
const { sleep, RESULT, LAUNCH, steps, step, session, waitFrame, snap, login, register, startPractice, myTurn } = require('./helpers')(base, out, { quality: 78 });
// Soul Rend and Blood Lance burn an enemy card or hero, Revelation draws (no target), Sacred Shield is in the deck too.
const SPELLS = [60, 63, 66, 67];
const BURN = 8, INSIGHT = 14;

(async () => {
  const browser = await chromium.launch(LAUNCH);

  /** Starter cards are level 1 in the card editor. */
  async function setLevel(page, id, level) {
    await page.goto(`${base}/Admin/CardEditor/${id}`);
    await page.fill('#Card_Level', String(level));
    await page.click('#card-form button[type=submit]');
    await page.waitForLoadState('domcontentloaded');
    return (await page.textContent('body')).includes('Saved');
  }

  /** The cast (224) of a spell and its events: the ability (or trigger) event comes from the spell's cid. */
  function castOf(s, from, cid) {
    const cast = s.frames.slice(from).find(f => f.dir === 'in' && f.type === 224 && f.p.card.cid === cid);
    const events = s.frames.slice(from).filter(f => f.dir === 'in' && f.type === 235).flatMap(f => f.p.events);
    return { cast, effect: events.find(e => ['ability', 'trigger'].includes(e.t) && e.src && e.src.cid === cid) };
  }

  // ---- The admin makes the two spells starter cards --------------------------------------------------------------
  const admin = await session('admin', { browser });
  await login(admin.page, 'admin', adminPassword);
  let saved = true;
  for (const spell of SPELLS) saved = (await setLevel(admin.page, spell, 1)) && saved;
  step('card editor saves spells as starter cards', saved);
  await admin.page.goto(`${base}/Admin/CardEditor/${SPELLS[0]}`);
  step('card editor shows the spell kind', (await admin.page.inputValue('#Card_Kind')) === '1');
  await snap(admin, 'card-editor');

  try {
    // ---- Shop and deck builder ---------------------------------------------------------------------------------
    const id = Date.now().toString(36);
    const A = await session('3d', { browser });
    await register(A.page, 'sa' + id, 1, SPELLS);
    await A.page.goto(base + '/Shop');
    const shopSpells = await A.page.$$eval('.s-card.spell', els => els.length);
    step('the shop shows the spells with a spell frame', shopSpells >= 10 && (await A.page.$$eval('.s-card.spell .s-card-attack', e => e.length)) === 0, `${shopSpells} spell tiles`);
    await (await A.page.$('.s-card.spell')).scrollIntoViewIfNeeded();
    await snap(A, 'shop');
    await A.page.goto(base + '/Deck');
    const deckSpells = await A.page.$$eval('.s-card.spell', els => els.length);
    step('the deck builder shows the owned spells', deckSpells === SPELLS.length, `${deckSpells} spell tiles`);
    await snap(A, 'deck');

    // ---- 3D: cast both spells, watched by a spectator ------------------------------------------------------------
    const ident = (await startPractice(A, '3d'))?.p.ident ?? 1;
    const hook = expr => A.page.evaluate(`window.__souls3d.${expr}`);
    const C = await session('watch', { browser });
    await register(C.page, 'sc' + id, 1, []);
    await C.page.goto(base + '/Game?mode=3d', { waitUntil: 'domcontentloaded' });
    await C.page.waitForSelector('.sg-menu', { timeout: 120000 });
    await C.page.click('.sg-menu-btn:has-text("Watch live")');
    await C.page.waitForSelector('.sg-game button', { timeout: 60000 });
    for (const row of await C.page.$$('.sg-game')) {
      if ((await row.textContent()).includes('sa' + id)) { await (await row.$('button')).click(); break; }
    }
    step('spectator joins the 3D game', !!(await waitFrame(C, f => f.dir === 'in' && f.type === 241, 0, 30000)));

    const drag = async (from, to) => {
      const page = A.page;
      await page.mouse.move(from.x, from.y, { steps: 3 }); await sleep(250);
      await page.mouse.down(); await sleep(200);
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await sleep(200);
      await page.mouse.move(to.x, to.y, { steps: 8 }); await sleep(500);
    };
    const cast3d = {};
    let tooltip = false;
    for (let turn = 0, turnFrom = 0; turn < 10 && !(cast3d.burn && cast3d.insight); turn++) {
      if (!(await myTurn(A, ident, turnFrom))) break;
      await sleep(1500);
      for (let k = 0; k < 3; k++) {
        const st = await hook('state()');
        if (st.hand.some(c => c.ability === INSIGHT)) cast3d.insightDrawn = true;
        const index = st.hand.findIndex(c => c.spell && c.cost <= st.mana && !c.pending && (c.ability === BURN ? !cast3d.burn : c.ability === INSIGHT && !cast3d.insight));
        if (index < 0) break;
        const card = st.hand[index];
        if (!tooltip) {
          const at = await hook(`handCard(${index})`);
          await A.page.mouse.move(at.x, at.y, { steps: 3 }); await sleep(900);
          const tip = await hook('tooltip()');
          tooltip = true;
          step('a spell in the hand explains itself', !!tip && /Spell/.test(tip) && !/Attack/.test(tip), (tip || '').slice(0, 100));
          await snap(A, 'hand-spell');
        }
        const from = A.frames.length;
        const fromWatch = C.frames.length;
        // Burn: an arrow from the hand onto the enemy hero (it lights up); Insight: the card dropped over the board.
        await drag(await hook(`handCard(${index})`), card.ability === BURN ? await hook('opponentHero()') : await hook('slot(3)'));
        if (card.ability === BURN) await snap(A, 'targeting');
        await A.page.mouse.up(); await sleep(700);
        step(`3D: no targeting hint is left after casting ${card.name}`, (await A.page.$$('.sg-hint')).length === 0);
        await snap(A, card.ability === BURN ? 'cast-burn' : 'cast-insight');
        await waitFrame(A, f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast, effect } = castOf(A, from, card.cid);
        const ok = !!cast && !!effect && (card.ability === BURN ? cast.p.target && cast.p.target.k === 'hero' : cast.p.target === null);
        step(`3D: ${card.name} is cast from the hand`, ok, cast ? `target ${JSON.stringify(cast.p.target)}, ${effect ? effect.t : 'no effect event'}` : 'no 224');
        if (card.ability === BURN) cast3d.burn = ok; else cast3d.insight = ok;
        const seen = await waitFrame(C, f => f.dir === 'in' && f.type === 224 && f.p.card.cid === card.cid, fromWatch, 8000);
        step(`spectator sees ${card.name} cast`, !!seen);
        if (seen && !cast3d.watched) { cast3d.watched = true; await sleep(300); await snap(C, 'spectator-cast'); }
        await sleep(1200);
        const st2 = await hook('state()');
        step(`3D: ${card.name} left the hand and the board`, !st2.hand.some(c => c.cid === card.cid) && !st2.board.some(c => c.cid === card.cid));
      }
      if (A.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      turnFrom = A.frames.length;
      const sign = await hook('endTurn()');
      await A.page.mouse.click(sign.x, sign.y);
      await waitFrame(A, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    if (!(cast3d.burn && cast3d.insight)) {
      const st = await hook('state()').catch(() => null);
      console.log('3D state at the end:', JSON.stringify(st && { mana: st.mana, current: st.current, ended: st.ended, hand: st.hand }));
      await snap(A, 'end-3d');
    }
    // A deck of 20 with 4 Revelations: now and then none comes up in 10 turns.
    step('3D: the spells that came up were cast', !!cast3d.burn && (!!cast3d.insight || !cast3d.insightDrawn),
      cast3d.insightDrawn ? '' : 'no Revelation was drawn');
    const botSpells = A.frames.filter(f => f.dir === 'in' && f.type === 225).map(f => f.p.card.name);
    console.log('bot spells seen in the 3D game:', botSpells.join(', ') || 'none');
    step('no console errors in the 3D game', A.problems.length === 0, A.problems.slice(0, 4).join(' || '));
    step('no console errors for the spectator', C.problems.length === 0, C.problems.slice(0, 4).join(' || '));
    await C.page.context().close();
    await A.page.context().close();

    // ---- Classic: drag the spells from the hand ---------------------------------------------------------------------
    const B = await session('classic', { browser });
    await register(B.page, 'sb' + id, 1, SPELLS);
    const identB = (await startPractice(B, 'classic'))?.p.ident ?? 1;
    const at = async (gx, gy) => { const box = await (await B.page.$('canvas')).boundingBox(); return { x: box.x + gx * box.width / 1920, y: box.y + gy * box.height / 1080 }; };
    const castClassic = {};
    for (let turn = 0, turnFrom = 0; turn < 10 && !(castClassic.burn && castClassic.insight); turn++) {
      if (!(await myTurn(B, identB, turnFrom))) break;
      await sleep(2500);
      for (let k = 0; k < 3; k++) {
        const sync = B.frames.filter(f => f.dir === 'in' && f.type === 236).pop();
        const mana = Number(sync.p.heroes[identB].mana);
        const spell = await B.page.evaluate(({ mana, done }) => {
          const hand = Object.values(window.gameEngine.player.cardManager.hand);
          const card = hand.find(c => c.spell && Number(c.cost) <= mana && [8, 14].includes(c.abilityId) && !done.includes(c.abilityId));
          return card ? { cid: card.cid, ability: card.abilityId, name: card.name, x: card.position.originX + 45, y: card.position.originY } : null;
        }, { mana, done: [castClassic.burn ? BURN : -1, castClassic.insight ? INSIGHT : -1] });
        if (!spell) break;
        const from = B.frames.length;
        // Overlapping hand cards: PixiJS gives a press to the lowest card under the pointer, and the hand moves while
        // cards are drawn. Press, check which card the client holds, and try another point if it is not the spell.
        const b = spell.ability === BURN ? await at(956, 141) : await at(960, 540);
        let a = null;
        for (const dx of [0, 25, -20, 55]) {
          const point = await at(spell.x + dx, spell.y);
          await B.page.mouse.move(point.x, point.y); await sleep(300); await B.page.mouse.down(); await sleep(300);
          if (await B.page.evaluate(cid => (window.gameEngine.player.holdingCard || {}).cid === cid, spell.cid)) { a = point; break; }
          // Drag the wrong card off (a click would arm a spell) and let it go back to the hand.
          const off = await at(spell.x + dx, 1075);
          await B.page.mouse.move(off.x, off.y, { steps: 4 }); await sleep(200); await B.page.mouse.up(); await sleep(1200);
        }
        if (!a) { step(`classic: picks up ${spell.name}`, false); break; }
        await B.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await sleep(400);
        await B.page.mouse.move(b.x, b.y, { steps: 8 }); await sleep(500);
        if (spell.ability === BURN) await snap(B, 'targeting');
        await B.page.mouse.up(); await sleep(900);
        await snap(B, spell.ability === BURN ? 'cast-burn' : 'cast-insight');
        await waitFrame(B, f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast, effect } = castOf(B, from, spell.cid);
        const ok = !!cast && !!effect;
        step(`classic: ${spell.name || 'a spell'} is cast from the hand`, ok, cast ? `target ${JSON.stringify(cast.p.target)}` : 'no 224');
        if (spell.ability === BURN) castClassic.burn = ok; else castClassic.insight = ok;
        await sleep(1500);
      }
      if (B.frames.some(f => f.dir === 'in' && RESULT.includes(f.type))) break;
      turnFrom = B.frames.length;
      const end = await at(1608, 550);
      await B.page.mouse.click(end.x, end.y);
      await waitFrame(B, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    step('classic: both spells were cast', !!castClassic.burn && !!castClassic.insight);
    step('no console errors in the classic game', B.problems.length === 0, B.problems.slice(0, 4).join(' || '));
    await B.page.context().close();

    // ---- Phone: tap the spell, then tap the target ----------------------------------------------------------------
    const D = await session('phone', { browser, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await register(D.page, 'sd' + id, 1, SPELLS);
    const identD = (await startPractice(D, '3d'))?.p.ident ?? 1;
    const hookD = expr => D.page.evaluate(`window.__souls3d.${expr}`);
    let tapped = false;
    for (let turn = 0, turnFrom = 0; turn < 10 && !tapped; turn++) {
      if (!(await myTurn(D, identD, turnFrom))) break;
      await sleep(1500);
      const st = await hookD('state()');
      const index = st.hand.findIndex(c => c.spell && c.ability === BURN && c.cost <= st.mana);
      if (index >= 0) {
        const card = st.hand[index];
        const from = D.frames.length;
        const h = await hookD(`handCard(${index})`);
        await D.page.touchscreen.tap(h.x, h.y); await sleep(900);
        await snap(D, 'spell-armed');
        const armed = await D.page.$$eval('.sg-hint', e => e.map(x => x.textContent).join());
        const target = await hookD('opponentHero()');
        await D.page.touchscreen.tap(target.x, target.y); await sleep(900);
        const left = (await D.page.$$('.sg-hint')).length;
        step('phone: the hint asks for a target while the spell is armed and goes with the cast', /pick a target/.test(armed) && left === 0, `armed: "${armed}", after: ${left}`);
        await snap(D, 'spell-cast');
        await waitFrame(D, f => f.dir === 'in' && f.type === 236, from, 8000);
        const { cast } = castOf(D, from, card.cid);
        tapped = true;
        step('phone: tap the spell, then the enemy hero, casts it', !!cast && cast.p.target && cast.p.target.k === 'hero', cast ? JSON.stringify(cast.p.target) : 'no 224');
        break;
      }
      turnFrom = D.frames.length;
      const sign = await hookD('endTurn()');
      await D.page.touchscreen.tap(sign.x, sign.y);
      await waitFrame(D, f => f.dir === 'in' && (f.type === 226 || RESULT.includes(f.type)), turnFrom, 10000);
    }
    step('phone: a spell came up to tap', tapped);
    step('no console errors on the phone', D.problems.length === 0, D.problems.slice(0, 4).join(' || '));
  } finally {
    // Spells are not starter cards.
    let restored = true;
    for (const spell of SPELLS) restored = (await setLevel(admin.page, spell, 2)) && restored;
    step('card editor puts the spells back', restored);
  }

  fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
  console.log(`${steps.filter(s => s.ok).length}/${steps.length} passed`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
