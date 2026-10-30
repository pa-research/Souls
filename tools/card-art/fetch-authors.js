#!/usr/bin/env node
// Looks up the game-icons.net author of every icon used in cards.json and records it in icon-authors.json.
// The npm package only carries the set-level author ("GameIcons"); the per-icon author is the contributor folder
// of the icon's SVG in https://github.com/game-icons/icons, which this script finds by probing raw.githubusercontent.com.
// Only needed when cards.json starts using a new icon; generate.js reads the committed icon-authors.json.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

// contributor folder -> display name (from the repository's license.txt)
const AUTHORS = {
  'lorc': 'Lorc', 'delapouite': 'Delapouite', 'john-colburn': 'John Colburn', 'felbrigg': 'Felbrigg',
  'john-redman': 'John Redman', 'carl-olsen': 'Carl Olsen', 'sbed': 'Sbed', 'priorblue': 'PriorBlue',
  'willdabeast': 'Willdabeast', 'viscious-speed': 'Viscious Speed', 'lord-berandas': 'Lord Berandas',
  'irongamer': 'Irongamer', 'heavenly-dog': 'HeavenlyDog', 'lucas': 'Lucas', 'faithtoken': 'Faithtoken',
  'skoll': 'Skoll', 'andymeneely': 'Andy Meneely', 'cathelineau': 'Cathelineau', 'kier-heyl': 'Kier Heyl',
  'aussiesim': 'Aussiesim', 'sparker': 'Sparker', 'zeromancer': 'Zeromancer', 'rihlsul': 'Rihlsul',
  'quoting': 'Quoting', 'guard13007': 'Guard13007', 'darkzaitzev': 'DarkZaitzev', 'spencerdub': 'SpencerDub',
  'generalace135': 'GeneralAce135', 'zajkonur': 'Zajkonur', 'catsu': 'Catsu', 'starseeker': 'Starseeker',
  'pepijn-poolman': 'Pepijn Poolman', 'pierre-leducq': 'Pierre Leducq', 'caro-asercion': 'Caro Asercion',
  'seregacthtuf': 'SeregaCthtuf',
};

// Icons that exist on game-icons.net (and in the npm set) but not in the GitHub repository's master branch.
// Author taken from the game-icons.net release archive layout (svgs/<author>/<icon>.svg), as redistributed in
// the npm package game-icons-transparent@1.0.2.
const MANUAL = {
  'female-vampire': { slug: 'delapouite', name: 'Delapouite' },
};

function status(url) {
  return new Promise(res => {
    const req = https.request(url, { method: 'HEAD' }, r => { r.resume(); res(r.statusCode); });
    req.on('error', () => res(0));
    req.end();
  });
}

async function main() {
  const file = path.join(__dirname, 'icon-authors.json');
  const known = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8')).cards;
  const icons = [...new Set(cards.flatMap(c => c.layers.map(l => l.icon).concat(c.sigil ? [c.sigil.icon] : [])))].sort();
  for (const icon of icons) {
    if (known[icon]) continue;
    if (MANUAL[icon]) { known[icon] = MANUAL[icon]; console.log(`${icon}: ${MANUAL[icon].name} (manual)`); continue; }
    const hits = [];
    await Promise.all(Object.keys(AUTHORS).map(async slug => {
      const code = await status(`https://raw.githubusercontent.com/game-icons/icons/master/${slug}/${icon}.svg`);
      if (code === 200) hits.push(slug);
    }));
    if (hits.length !== 1) { console.log(`${icon}: ${hits.length ? 'ambiguous ' + hits.join(',') : 'NOT FOUND'}`); if (!hits.length) continue; }
    known[icon] = { slug: hits[0], name: AUTHORS[hits[0]] };
    console.log(`${icon}: ${AUTHORS[hits[0]]}`);
  }
  const sorted = Object.fromEntries(icons.filter(k => known[k]).map(k => [k, known[k]])); // drop icons no longer used
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
