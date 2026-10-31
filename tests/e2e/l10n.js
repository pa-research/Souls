// Language helpers for the browser tests: switch a page's language and find English left on a translated page.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const TABLES = path.join(ROOT, 'src/Souls.Model/Localization');
const RESX = path.join(ROOT, 'src/Souls.Web/Resources');

/** The game's string table of a language (all Souls.Model/Localization/*.{lang}.json merged). */
function table(lang) {
  return Object.assign({}, ...fs.readdirSync(TABLES).filter(f => f.endsWith(`.${lang}.json`))
    .map(f => JSON.parse(fs.readFileSync(path.join(TABLES, f), 'utf8'))));
}

/** The site's texts of a language: English text -> translation (Resources/SharedResource.{lang}.resx). */
function resx(lang) {
  const file = path.join(RESX, `SharedResource.${lang}.resx`);
  if (!fs.existsSync(file)) return {};
  const xml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const entries = {};
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<data name="([^"]*)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g)) entries[xml(m[1])] = xml(m[2]);
  return entries;
}

const trim = s => s.replace(/^[\s.,:;!?·()"'«»\-–]+|[\s.,:;!?·()"'«»\-–]+$/g, '');

/**
 * What a page in `lang` must not show: the English texts that the language translates differently. `long` are pieces
 * of two or more words found anywhere in a text, `short` whole one-word labels (a button "Settings").
 */
function englishPhrases(lang) {
  const en = table('en');
  const own = table(lang);
  const site = resx(lang);
  const pairs = [...Object.keys(en).map(k => [en[k], own[k]]), ...Object.entries(site)];
  const translations = [...Object.values(own), ...Object.values(site)].join('\n');
  const long = new Set();
  const short = new Set();
  for (const [english, translated] of pairs) {
    if (!translated || translated === english) continue;
    for (const piece of english.split(/\{\w+\}/).map(trim)) {
      if (piece.length >= 8 && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(piece)) long.add(piece);
    }
    const whole = trim(english);
    if (/^[A-Za-z]{4,}$/.test(whole)) short.add(whole.toLowerCase());
  }
  // A piece a translation contains too is a name both share ("Lost Souls"), not English left over.
  return {
    long: [...long].filter(p => !translations.includes(p)),
    short: [...short].filter(w => !Object.values(own).concat(Object.values(site)).some(t => trim(t).toLowerCase() === w)),
  };
}

/** Untranslated keys showing as text ("g3d.yourTurn"). */
const KEY = String.raw`\b(?:g3d|classic|log|error|ability|race|power|keyword|rarity|tier|quest|emote|challenge|queue|spectate|chat|close|mode|deck|password|season|card|lang|flavor|service)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\b`;

/**
 * The English (and raw keys) visible on the page: text, aria-label, title, placeholder and alt of visible elements.
 * `skip` is a selector of content that is not interface text (news posts, the GitHub feed).
 */
async function leftovers(page, phrases, skip = '.news-wrapper, #github-feed') {
  return page.evaluate(({ long, short, key, skip }) => {
    const shown = el => {
      if (skip && el.closest(skip)) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const parent = n.parentElement;
      const text = n.nodeValue.trim();
      if (text && parent && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName) && shown(parent)) texts.push(text);
    }
    for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], img[alt]')) {
      if (!shown(el)) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) if (el.getAttribute(a)) texts.push(el.getAttribute(a).trim());
    }
    const keyPattern = new RegExp(key);
    const found = new Set();
    for (const t of texts) {
      const k = t.match(keyPattern);
      if (k) found.add('key ' + k[0]);
      for (const p of long) if (t.includes(p)) found.add(`"${p}" in "${t.slice(0, 80)}"`);
      if (short.includes(t.replace(/^[\s.,:;!?·()"'«»\-–]+|[\s.,:;!?·()"'«»\-–]+$/g, '').toLowerCase())) found.add(`"${t}"`);
    }
    return [...found];
  }, { ...phrases, key: KEY, skip });
}

/** Picks the language with the site's switch (the EN | NB picker posts it to a cookie) and waits for the page. */
async function pickLanguage(page, base, lang) {
  if (!/\/$|\/Home/.test(page.url())) await page.goto(base + '/');
  await Promise.all([page.waitForNavigation(), page.evaluate(l => document.querySelector(`form.s-lang button[value="${l}"]`).click(), lang)]);
  const shown = await page.evaluate(() => document.documentElement.lang);
  if (shown !== lang) throw new Error(`the page is in ${shown} after picking ${lang}`);
}

/** The browser locale (Accept-Language) for a language code. */
const locale = lang => ({ en: 'en-US', nb: 'nb-NO' }[lang] || lang);

module.exports = { table, resx, englishPhrases, leftovers, pickLanguage, locale };
