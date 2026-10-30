# Card portrait generator

Generates the "painted emblem" portraits for the expansion cards (ids 20-56), the spells (60-69), the class cards
(70-77) and the Lost Soul token in `src/Souls.Web/wwwroot/Content/Images/Card/Portraits/` (`{id}.jpg`,
`lost-soul.jpg`, 708x501 = the 236x167 portrait window at 3x, sRGB JPEG q86) and writes `CREDITS.md` next to them. The game's original art in that folder
(0-6, 15, 16, 18) is never touched; `generate.js` refuses to write those names.

## Run

```sh
cd tools/card-art
npm install
node generate.js                 # all cards -> the game's Portraits folder, plus CREDITS.md
node generate.js 37 56 --out /tmp/try --png /tmp/try   # just some cards, somewhere else, keep PNGs
node sheets.js --out /tmp/sheets # contact.png (all cards) + frames.png (in the real card frame, vs 1.png/3.png)
```

Needs Node 22 and Playwright's Chromium (`npx playwright install chromium` if it is not installed already). The
render runs headless in WebGL2 (SwiftShader is fine), about 5-15 s per card. Output is deterministic per card
(seeded from the id).

## Files

- `cards.json` - one entry per card: id, name, race, rarity, icon layers and per-card tweaks (light position,
  motif, particles, material, emissive spots for eyes and flames, raw uniform overrides in `tweak`).
- `style.js` - the look of the set: race palettes, materials, rarity drama, and how a card resolves to uniforms.
- `lib/render.js`, `lib/shaders.js`, `lib/scenery.js` - the in-browser renderer.
- `icon-authors.json` - author of every icon used (written by `node fetch-authors.js`, only needed when a new
  icon is added: the npm package only names the set author, so it probes the per-author folders of
  https://github.com/game-icons/icons).

## How the look is built

1. **Subject.** The icon paths (one or more game-icons, stacked with a knocked-out gap between layers) are drawn
   with Canvas 2D at 2x and auto-fitted to ~74% of the height. Small enclosed holes are filled and narrow slits are
   closed (morphological closing) so the silhouette is solid; the icon's cut-out details become grooves. Exact
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

## License

The silhouettes come from game-icons.net (https://game-icons.net) via `@iconify-json/game-icons`, licensed
CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). The generated portraits are derivative works and must
keep the attribution in `src/Souls.Web/wwwroot/Content/Images/Card/Portraits/CREDITS.md` (written by
`generate.js` from `icon-authors.json`). When adding an icon, run `node fetch-authors.js` first.
