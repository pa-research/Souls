// The "Leave the game?" dialog both clients open from their settings (Views/Game/Index.cshtml, /js/game-mode.js):
// the themed dialog rather than the browser's confirm, on top of everything, focus on Leave, Tab kept inside it, closed
// by Esc, by Stay and (touch) by a tap beside it, without leaving the game; Enter leaves to the game menu.
const sleep = ms => new Promise(r => setTimeout(r, ms));

const state = page => page.evaluate(() => {
  const d = document.getElementById('sg-leave');
  const r = d.getBoundingClientRect();
  const top = d.open && document.elementFromPoint(r.left + r.width / 2, r.top + 24);
  const settings = [...document.querySelectorAll('.sg-settings')].some(e => !e.hidden);
  return {
    open: d.open, onTop: !!top && d.contains(top), inside: d.contains(document.activeElement),
    focus: document.activeElement && document.activeElement.value, settings,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  };
});

/** Opens the dialog from the settings and closes it again in every way that stays in the game. */
async function checkLeaveDialog(page, step, { label, settings, leave, touch = false }) {
  const natives = [];
  const onDialog = d => { natives.push(d.message()); d.dismiss().catch(() => {}); };
  page.on('dialog', onDialog);
  const press = sel => (touch ? page.tap(sel) : page.click(sel));
  const open = async () => {
    if (!(await state(page)).settings) { await press(settings); await sleep(400); }
    await press(leave); await sleep(600);
    return state(page);
  };
  const s = await open();
  const view = page.viewportSize();
  step(`${label}: Leave game opens the themed dialog on top of everything, on the screen, Leave focused`,
    s.open && s.onTop && s.focus === 'leave' && natives.length === 0 && s.rect.x >= 0 && s.rect.y >= 0 && s.rect.x + s.rect.w <= view.width && s.rect.y + s.rect.h <= view.height,
    JSON.stringify({ ...s, natives }));
  const focus = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); focus.push((await state(page)).focus); }
  await page.keyboard.press('Shift+Tab'); focus.push((await state(page)).focus);
  step(`${label}: Tab and Shift+Tab stay in the dialog`, focus.join() === 'stay,leave,stay,leave', focus.join());
  await page.keyboard.press('Escape'); await sleep(400);
  const esc = await state(page);
  step(`${label}: Esc closes it, the settings stay open`, !esc.open && esc.settings, JSON.stringify(esc));
  await open();
  await press('#sg-leave button[value=stay]'); await sleep(400);
  const stay = await state(page);
  step(`${label}: Stay closes it`, !stay.open, JSON.stringify(stay));
  if (touch) {
    await open();
    await page.touchscreen.tap(view.width / 2, 6); await sleep(400);
    const beside = await state(page);
    step(`${label}: a tap beside it closes it`, !beside.open, JSON.stringify(beside));
  }
  // Close the settings again (Esc does it in both clients).
  await page.keyboard.press('Escape'); await sleep(300);
  page.off('dialog', onDialog);
}

/** Leaves the game from the dialog with Enter: the game menu shows (the game is not resumed). */
async function leaveWithEnter(page, step, { label, settings, leave }) {
  await page.click(settings); await sleep(400);
  await page.click(leave); await sleep(500);
  await page.keyboard.press('Enter');
  const menu = await page.waitForSelector('.sg-menu', { timeout: 120000 }).then(() => true, () => false);
  step(`${label}: Enter in the dialog leaves to the game menu`, menu && new URL(page.url()).pathname === '/Game', page.url());
}

module.exports = { checkLeaveDialog, leaveWithEnter };
