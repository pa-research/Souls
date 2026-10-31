# Card, hero and site art credits

## Painted art (2026)

Every card portrait in this folder (`{id}.jpg`, `lost-soul.jpg`; card 7 is `16.jpg`), the hero portraits `0.jpg`-`4.jpg`
in `../../Player/Portraits`, the shop mascots (`../../Page/hansel.png`), the page background (`../../Page/bg.jpg`),
the classic client's backdrop (`../../bg_faded.jpg`) and the news banner `../../NewsPosts/post3.jpg` (card 18's
painting with the 2014 banner's text) were painted for Souls in 2026 with
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

The `original-2014/` folders (in this folder, `Player/Portraits`, `Page`, `NewsPosts` and `Content/Images`) keep the
2014 art that the paintings replaced, under its old names, for history only: the game no longer uses it. It contains
photos and third-party images (a Sega character, a film still, comic and game art, fan art, stock photos, cartoon
mascots) that Souls has no licence for; do not reuse them.

## Emblem generator (fallback)

`tools/card-art/generate.js` can still render the older "painted emblem" portraits from game-icons.net silhouettes
(CC BY 3.0). None of them ships now. If they are ever used again, `generate.js` writes the attribution those icons
require next to its output.
