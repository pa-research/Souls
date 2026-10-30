# Browser tests

Playwright scripts that drive real games against a running stack (Docker Compose, see the main README). They
register fresh players, play against the practice bot or each other, check the protocol messages and the browser
console, and save screenshots.

```sh
npm install
```

| Script | What it checks |
|---|---|
| `rules3d.js <base> <out> [difficulty]` | A full 3D practice game: hero power, cards, attacks, turn timer, tooltips, rewards, stats page, 3D replay |
| `classic_ui.js <base> <out> [width height]` | A classic practice game with the HUD: menu, queue, cards, hero power, tooltip, settings |
| `pvp_rules.js <base> <out>` | A ranked game between a 3D and a classic player, watched live by a spectator |
| `social.js <base> <out>` | Friendly challenges (accept, decline, challenge link) and emotes (mute) between a 3D and a classic player; no rating change |
| `spells.js <base> <out>` | Spells: the admin makes four spells starter cards (and puts them back), shop and deck tiles, casting from the hand in 3D (an arrow from the hand onto a target, a spell without one dropped on the board) with a spectator, in the classic client, and tap-tap on a phone |
| `vfx3d.js <base> <out>` | Replays the new card set's effects in the 3D client (legendary entrance, inferno, ward, venom, ice, grow, rally, drain, shatter) |
| `hud3d.js <base> <out> [width height]` | Screenshots of the 3D client's interface states |
| `ui_capture.js <base> <out>` | Every website page on desktop and phone, including the admin pages |

`<base>` is the site, e.g. `https://localhost`; `<out>` a folder for the screenshots. Each script prints
`PASS`/`FAIL` lines or a list of console problems.

```sh
node rules3d.js https://localhost out/rules3d 2
```

`ui_capture.js` logs in as the admin with `SOULS_ADMIN_PASSWORD`, or the password `deploy/compose/init-secrets.sh`
wrote.

Without a GPU, Chromium renders WebGL in software and the scripted players get slow. Give turns more time, or they
time out (for example with an override file next to `compose.yaml`):

```yaml
services:
  server:
    environment:
      Souls__Game__TurnTime: "00:08:00"
```
