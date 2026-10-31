# Card art

Every card portrait (`src/Souls.Web/wwwroot/Content/Images/Card/Portraits/`), the Lost Soul token, the hero
portraits (`Player/Portraits/0.jpg`-`4.jpg`) and the shop mascots and page backgrounds are paintings made with OpenAI image generation through the Codex CLI.
This folder holds the art direction (below), the prompt of every image (`prompts.json`) and `paint.js`, which paints
them again. The older procedural "emblem" generator is kept as a fallback (last section).

## Style bible

One art direction for the whole set. Every prompt in `prompts.json` is the card's subject, then its race palette,
then its kind, then the common style, in that order.

**Common style** (every image):

> Dark-fantasy collectible card game art: a finished painterly digital painting with visible brushwork, rich saturated colour, dramatic rim light that separates the subject from the background, volumetric atmosphere and depth. One single clear subject, large and centred, entirely inside the middle 80% of the frame with nothing important touching the edges; a strong, simple silhouette that still reads at thumbnail size (150 pixels wide); the background is darker and less detailed than the subject. No text, letters, numbers, runes or writing, no logos, no signature, no watermark, no border, frame or card template. An original design that does not resemble any real person or any existing franchise character.

**Race palettes**

| Race | Palette and setting |
|---|---|
| Darkness | moonlit night in cold violet, indigo and blue-grey with pale moonlight and touches of sickly green; graveyards, barrow mounds, dead trees and drifting mist. |
| Vampiric | gothic deep crimson, black and candle-gold, blood-red highlights. The setting changes per card (blood-moon ramparts, candlelit crypt, ballroom, chapel, foggy street), so the race does not become one sky. |
| Lightbringer | radiant gold, ivory and dawn blue, warm sunrise light, cathedral light shafts, polished gold-trimmed armour and white feathers, glowing haze. |
| Ferocious | amber, moss green and earthy brown, an ancient Nordic forest and mountains, warm firelight and golden god rays. |
| Frost (Ferocious ice cards: Snokulv, Frost Jotun, Frostbite) | icy cyan, white and steel blue, snowstorm, glaciers and frozen mountain passes, cold rim light. |
| Neutral (Lost Soul, unknown card and hero) | cold pale blue, silver and grey, an empty misty void with soft light. |
| Shop (mascots) | warm candle-gold, deep brown, soft crimson and old brass, lit like a cosy shop in a dark-fantasy town. |

**Kinds**

- Creature cards: one creature or character, large and centred, landscape 3:2.
- Spells show the effect itself (a burst, a shield, a curse, a wind), not a creature portrait.
- Class cards are creatures or spells of their class's race and hint at the hero: Rabid Soul's violet soul-fire
  (Rabid Ghoul, Night Terror), the Lurker's hidden hunters and feasts (Night Stalker, Crimson Feast), Harrison's
  sunlight and sword (Sunlance, Dawn Paladin), Fader's fading and armoured beasts (Phantom Wolf, Ironhide Bear).
- Heroes: a head-and-shoulders bust facing the viewer, face in the exact centre with room around the head, so it
  reads in the circle crops of the site and the ellipse of the game clients; square.
- Site art has its own style line instead of the common one (that one asks for a single subject in a scene):
  - Shop mascots: two full-body characters standing side by side, centred, on a fully transparent background (no scenery, no floor, no frame), with clean painted edges. Landscape 3:2 composition (1536x1024). Charming, friendly and a little comical, in a painterly dark-fantasy card-game style with rich colour and warm rim light. Original character designs that do not resemble any existing mascots, cartoon characters or real people. No text, letters, logos, signature or watermark.
  - Backdrops: a page background, wide, empty and moody, with no characters and no focal subject, dark and low in contrast so that text and panels can sit on top of it; a finished painterly digital painting. Landscape 16:10 composition (1536x1024). No text, letters, road markings, logos, signature or watermark.
- The original 2014 cards keep their names and abilities, with new original designs: no real people's likenesses,
  no existing characters (card 2 "Dr. Robotnik" is a white-haired clockwork inventor of our own), no logos or text.

**Check every result** at full size and at 150 px (the shop tile): one clear subject, readable silhouette, no text
or letters, nothing important at the edges, palette of its race. Paint it again (with a sharper subject line if
needed) when it is muddy, off-palette or cropped badly.

## Sizes and crops

All clients stretch the whole image into a fixed box (an `<img>` or `background-size: 100% 100%` on the site,
`drawImage` into the box in the 3D client, a sprite of fixed size in the classic client), so every image is shipped
at the aspect of its box and nothing is stretched:

- Cards: 708x501, the 236x167 portrait window at 3x, `{id}.jpg` (card 7 is `16.jpg`, its 2014 name) and
  `lost-soul.jpg`. The rarity gem overlaps the bottom centre of the window.
- Heroes: 720x600, `Player/Portraits/{class}.jpg`, the 300x250 hero box of both clients (clipped to an ellipse); the
  site crops them to a circle and, on the Register page, to a wide band through the face (`object-fit: cover`), so
  the face sits in the centre.
- Weight: the shop and the deck builder list every card (lazy-loaded), so cards are at most 70 KB and heroes 90 KB.
  `out` writes progressive JPEG (mozjpeg, 4:2:0) and steps the quality down from 80 until the image fits (floor 62;
  the set lands at q70-80, which stays clean at 3x).
- Site art: the shop mascots (`Page/hansel.png`, a cut-out on a transparent background: `fit: contain` trims the empty
  border, palette PNG with alpha, 560x310 = 280 CSS px at 2x), the page background `Page/bg.jpg` and the classic
  client's backdrop `bg_faded.jpg` (the same painting at 35% brightness, an entry without a prompt). The home page's
  news banner `NewsPosts/post3.jpg` is card 18's master with the 2014 banner's text ("Spirit wolf coming to Souls",
  Liberation Serif Bold, red) set on the left with ImageMagick.

`paint.js out` crops each master around its centre to that aspect (an entry may set `position`, any sharp
position such as `north`, to move the crop) and resizes it with Lanczos.

## Run

```sh
cd tools/card-art
npm install
node paint.js gen 37 hero-2 --masters ~/souls-art      # paint masters (PNG, about 1536x1024; heroes square), 3 per Codex call
node paint.js out 37 hero-2 --masters ~/souls-art      # crop and resize them into the game's image folders
node paint.js gen --masters ~/souls-art --jobs 3       # every entry, three Codex calls at a time
```

Needs the `codex` CLI (0.163 or newer) signed in with a ChatGPT account that has image generation; the images are
made by its built-in image tool, so no API key is needed. Each Codex call gets the prompts verbatim and copies the
generated PNGs unchanged into a fresh work folder under `--masters`; a replaced master moves to `--masters/old/`.
One image takes about a minute. The image tool refuses some prompts (it rejected "bite marks on his neck" for the
Blood Thrall); `gen` then reports the card as missing, so rephrase the prompt and paint it again. The full-size
masters are not in the repository.

Entries are named by card id, plus `lost-soul`, `card-0` (the unknown card) and `hero-0` to `hero-4` (the unknown
hero and the four classes). To change one: edit its `prompt` in `prompts.json`, paint it again, look at it, then run
`out`.

## Emblem generator (fallback)

`generate.js` renders the earlier procedural portraits ("painted emblems" lit from game-icons.net silhouettes, CC BY
3.0) for the expansion, spells, class cards and the Lost Soul token. Nothing it makes ships at the moment. Without
`--out` it overwrites the painted JPEGs in the Portraits folder and rewrites `CREDITS.md` there with the icon
attributions, so render somewhere else unless that is the intent. It never writes the original cards' file names.

### Run

```sh
cd tools/card-art
npm install
node generate.js --out /tmp/emblems   # all cards, plus their CREDITS.md (without --out it overwrites the painted portraits)
node generate.js 37 56 --out /tmp/try --png /tmp/try   # just some cards, somewhere else, keep PNGs
node sheets.js --out /tmp/sheets # contact.png (all cards) + frames.png (in the real card frame, vs 1.png/3.png)
```

Needs Node 22 and Playwright's Chromium (`npx playwright install chromium` if it is not installed already). The
render runs headless in WebGL2 (SwiftShader is fine), about 5-15 s per card. Output is deterministic per card
(seeded from the id).

### Files

- `cards.json` - one entry per card: id, name, race, rarity, mood, icon layers and per-card tweaks (light position,
  motif, particles, material, emissive spots for eyes and flames, `grow` / `dropSpecks` for thin or speckled icons,
  raw uniform overrides in `tweak`).
- `style.js` - the look of the set: race palettes, moods, materials, rarity drama, and how a card resolves to uniforms.
  A mood is another lighting set-up within a race (Vampiric: blood moon, `moonlit`, `candle`, `rosewindow`, `dusk`;
  Darkness: graveyard moon, `plague`, `nightmare`; Lightbringer: day sky, `dawn`; Ferocious: forest, `moonwood`,
  `frost`), so a race keeps one palette family without every card sharing one sky. Order of merging: race -> mood ->
  material -> rarity -> `tweak`.
- `lib/render.js`, `lib/shaders.js`, `lib/scenery.js` - the in-browser renderer.
- `icon-authors.json` - author of every icon used (written by `node fetch-authors.js`, only needed when a new
  icon is added: the npm package only names the set author, so it probes the per-author folders of
  https://github.com/game-icons/icons).

### How the look is built

1. **Subject.** The icon paths (one or more game-icons, stacked with a knocked-out gap between layers) are drawn
   with Canvas 2D at 2x and auto-fitted to ~74% of the height. Small enclosed holes are filled and narrow slits are
   closed (morphological closing) so the silhouette is solid; the icon's cut-out details become grooves. Optional
   per card: `dropSpecks` removes loose debris islands, `grow` thickens thin limbs and blades so they survive the
   ~150 px shop tile. The knocked-out gap between stacked layers (and a `cut` layer, e.g. claw marks carved into a
   ghost) stays part of the figure as a dark groove, so the rim light never draws thin bright outlines through it. Exact
   signed distance fields (Felzenszwalb EDT) of the silhouette and of the detail mask, plus a wide blur for the
   overall volume, give a relief height field: rounded bevels, grooves and a soft dome, plus material noise
   (stone, bone, fur, bark with moss, iron, gold, ice, cloth, ethereal). It is lit in linear light by a key light
   from the side of the scene's light, a back light that rims the edges facing the moon/sun, environment-style
   reflections for metal, and emissive spots (eyes, flames) that glow inside their holes. Disc icons such as
   `wolf-howl` and `witch-flight` can be used inverted: the figure is the cut-out and the moon is placed exactly
   behind it.
2. **Background.** Per race: sky gradient, a moon or sun disc with glow, angular sky rays, domain-warped fBm smoke /
   clouds / mist bands lit from the light direction, procedural silhouettes (graveyard, barrow, gothic castle and
   arch, cathedral window, forest, mountains) in three fogged depth layers with mist between them, an optional
   glowing sigil, and drifting particles (ash, motes, blood, sparks, fireflies, embers, snow, wisps).
3. **Atmosphere.** A contact shadow / outline and a back-light aura separate the subject; god rays come from a
   radial blur of the bright background occluded by the subject; a front fog band and blurred foreground particles
   add depth. Rarity scales rays, halo ring, glow, particle count and saturation.
4. **Finish.** A light Kuwahara filter for a painted texture, ACES tone mapping, split toning per race, contrast,
   vignette and film grain; then a 2x downsample and JPEG encoding with sharp (mozjpeg, 4:4:4).

### License (emblems)

The silhouettes come from game-icons.net (https://game-icons.net) via `@iconify-json/game-icons`, licensed
CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). The generated portraits are derivative works and must
keep the attribution in `src/Souls.Web/wwwroot/Content/Images/Card/Portraits/CREDITS.md` (written by
`generate.js` from `icon-authors.json`). When adding an icon, run `node fetch-authors.js` first.
