# Card and hero portrait credits

## Painted portraits (2026)

Every card portrait in this folder (`{id}.jpg`, `lost-soul.jpg`, and the original cards' `0.png`-`6.png`, `16.jpg`
and `18.png`) and the hero portraits `0.png`-`4.png` in `../../Player/Portraits` were painted for Souls in 2026 with
OpenAI image generation, through the image tool of the Codex CLI (signed in with the project owner's ChatGPT
account). One art direction covers the whole set; the style bible is in `tools/card-art/README.md` and the exact
prompt of every image in `tools/card-art/prompts.json`, so any portrait can be painted again with
`tools/card-art/paint.js`.

They are original illustrations made for this project: no photos, game-icons.net silhouettes or other third-party
images went into them, and the prompts ask for original designs without real people, existing characters, logos or
text. Under OpenAI's terms of use the rights in the output belong to the user who generated it (the project owner).
AI-generated images may get little or no copyright protection in some countries; that does not limit their use in
Souls.

## The 2014 art (`original-2014/`)

`original-2014/` in this folder and in `Player/Portraits` keeps the April 2014 art of the original cards and heroes
under its old names, for history only: the game no longer uses it. It contains photos and third-party images (a
Sega character, a film still, comic and game art, fan art) that Souls has no licence for; do not reuse them.
`Player/Portraits/5.png` and `6.png` are 2014 leftovers of the same kind that both clients still preload; no hero
class shows them.

## Emblem generator (fallback)

`tools/card-art/generate.js` can still render the older "painted emblem" portraits from game-icons.net silhouettes
(CC BY 3.0). None of them ships now. If they are ever used again, `generate.js` writes the attribution those icons
require next to its output.
