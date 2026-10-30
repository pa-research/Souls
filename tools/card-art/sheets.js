#!/usr/bin/env node
// Review sheets for the generated portraits:
//   node sheets.js --out <dir> [--in <portrait dir>] [--cols 6] [--scale 0.5]
// writes <dir>/contact.png (every card with id + name) and <dir>/frames.png (a few portraits composited into the
// real card frame at 1:1 next to the original art 1.png / 3.png, plus a phone-size row).
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const IMG = path.join(ROOT, '..', '..', 'src', 'Souls.Web', 'wwwroot', 'Content', 'Images', 'Card');
const RACE_FRAME = { darkness: 'darkness', vampiric: 'vampiric', lightbringer: 'lightbringer', ferocious: 'ferocious', neutral: 'darkness' };

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
function dataUrl(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function main() {
  const out = arg('out');
  if (!out) throw new Error('--out <dir> is required');
  const inDir = arg('in', path.join(IMG, 'Portraits'));
  const cols = +arg('cols', 6), scale = +arg('scale', 0.5);
  const showcase = (arg('frames', '28,37,47,56,20,33,42,51')).split(',');
  fs.mkdirSync(out, { recursive: true });
  const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8')).cards
    .filter(c => fs.existsSync(path.join(inDir, `${c.id}.jpg`)));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const images = Object.fromEntries(cards.map(c => [c.id, dataUrl(path.join(inDir, `${c.id}.jpg`))]));
  const frames = Object.fromEntries(Object.values(RACE_FRAME).map(r => [r, dataUrl(path.join(IMG, 'Texture', `${r}.png`))]));
  const originals = { 1: dataUrl(path.join(IMG, 'Portraits', '1.png')), 3: dataUrl(path.join(IMG, 'Portraits', '3.png')) };

  const sheets = await page.evaluate(async ({ cards, images, frames, originals, cols, scale, showcase, RACE_FRAME }) => {
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const RARITY = { C: 'Common', R: 'Rare', E: 'Epic', L: 'Legendary' };

    // ---- contact sheet
    const tw = Math.round(708 * scale), th = Math.round(501 * scale), pad = 10, lab = 26;
    const rows = Math.ceil(cards.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * (tw + pad) + pad; c.height = rows * (th + lab + pad) + pad;
    const x = c.getContext('2d');
    x.fillStyle = '#1b1b1f'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i], img = await load(images[card.id]);
      const cx = pad + (i % cols) * (tw + pad), cy = pad + Math.floor(i / cols) * (th + lab + pad);
      x.drawImage(img, cx, cy, tw, th);
      x.fillStyle = '#e8e2d0'; x.font = 'bold 15px sans-serif';
      x.fillText(`${card.id}  ${card.name}`, cx + 2, cy + th + 18);
      x.fillStyle = '#9a9488'; x.font = '12px sans-serif';
      const tag = `${card.race} · ${RARITY[card.rarity]}`;
      x.fillText(tag, cx + tw - x.measureText(tag).width - 2, cy + th + 18);
    }
    const contact = c.toDataURL('image/png');

    // ---- frame sheet: card frames at 1:1 (330x450) with the portrait at x=47, y=110, 236x167
    async function card(ctx, ox, oy, portrait, race, k) {
      k = k || 1;
      ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
      ctx.drawImage(await load(portrait), 47, 110, 236, 167);
      ctx.drawImage(await load(frames[RACE_FRAME[race]]), 0, 0, 330, 450);
      ctx.restore();
    }
    const items = [{ label: 'original 1.png', img: originals[1], race: 'ferocious' }, { label: 'original 3.png', img: originals[3], race: 'vampiric' }]
      .concat(showcase.map(id => cards.find(cc => String(cc.id) === id)).filter(Boolean)
        .map(cc => ({ label: `${cc.id} ${cc.name}`, img: images[cc.id], race: cc.race })));
    const perRow = 5, fw = 330, fh = 450, g = 16;
    const nrows = Math.ceil(items.length / perRow);
    const small = 110 / 236; // a phone: the portrait is about 110 px wide
    const f = document.createElement('canvas');
    f.width = perRow * (fw + g) + g;
    f.height = nrows * (fh + 30 + g) + g + 40 + Math.ceil(fh * small) + 30;
    const y = f.getContext('2d');
    y.fillStyle = '#2a2a30'; y.fillRect(0, 0, f.width, f.height);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ox = g + (i % perRow) * (fw + g), oy = g + Math.floor(i / perRow) * (fh + 30 + g);
      await card(y, ox, oy, it.img, it.race);
      y.fillStyle = '#e8e2d0'; y.font = 'bold 15px sans-serif'; y.fillText(it.label, ox + 6, oy + fh + 20);
    }
    let sy = g + nrows * (fh + 30 + g) + 10;
    y.fillStyle = '#e8e2d0'; y.font = 'bold 15px sans-serif'; y.fillText('phone size (portrait ~110 px wide):', g, sy + 14);
    sy += 26;
    for (let i = 0; i < items.length; i++) await card(y, g + i * (fw * small + 10), sy, items[i].img, items[i].race, small);
    return { contact, frames: f.toDataURL('image/png') };
  }, { cards: cards.map(c => ({ id: c.id, name: c.name, race: c.race, rarity: c.rarity })), images, frames, originals, cols, scale, showcase, RACE_FRAME });

  fs.writeFileSync(path.join(out, 'contact.png'), Buffer.from(sheets.contact.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(out, 'frames.png'), Buffer.from(sheets.frames.split(',')[1], 'base64'));
  await browser.close();
  console.log(`wrote ${path.join(out, 'contact.png')} and ${path.join(out, 'frames.png')} (${cards.length} cards)`);
}

main().catch(e => { console.error(e); process.exit(1); });
