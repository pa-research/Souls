# Browser tests

Playwright scripts that drive real games against a running stack (Docker Compose, see the main README). They
register fresh players, play against the practice bot or each other, check the protocol messages and the browser
console, and save screenshots.

```sh
npm install
```

| Script | What it checks |
|---|---|
| `rules3d.js <base> <out> [difficulty] [class]` | A full 3D practice game (as Rabid Soul, or the class id given): hero power (and its targeting hint, off the heroes, the hero power, the hand and End Turn), the leave dialog, cards, attacks, turn timer, tooltips, rewards, stats page, 3D replay; every animation frame, no two full-screen layers (matchmaking, VS splash, mulligan, end screen) at once and no banner or tooltip over one |
| `classic_ui.js <base> <out> [width height]` | A classic practice game with the HUD: menu, queue, cards, hero power, tooltip, settings; the board keeps 16:9 at any window shape with the HUD over it, messages off the heroes and hero powers, the leave dialog (Tab, Esc, Stay, Enter leaves) |
| `pvp_rules.js <base> <out>` | A ranked game between a 3D and a classic player, watched live by a spectator |
| `social.js <base> <out>` | Friendly challenges (accept, decline, challenge link) and emotes (mute) between a 3D and a classic player; no rating change |
| `spells.js <base> <out>` | Spells: the admin makes four spells starter cards (and puts them back), shop and deck tiles, casting from the hand in 3D (an arrow from the hand onto a target, a spell without one dropped on the board) with a spectator, in the classic client, and tap-tap on a phone |
| `hero_choice.js <base> <out>` | Hero powers and class cards: a Lurker picks Blood Gift on the Deck page, the shop shows each class only its own class cards, Blood Gift used on an own card in 3D (with a spectator) and in the classic client |
| `portrait.js <base> <out> [width height]` | The 3D client on a phone held upright (412x915 unless given, touch): the portrait layout in every camera view, after turning the phone and with a notch and home indicator (safe area; hand cards wide enough, no controls over the board or the hand), a touched hand card lifted clear of the hero and hero power with its rules below the top buttons, the leave dialog by touch, then a practice game played to the end by touch (cards dragged onto slots, a spell tapped then its target and one aimed with an arrow from the hand, the hero power, attacks, End Turn), tooltips on screen, and the replay upright |
| `restart.js <base> <out> [restart] [redeploy]` | Running games survive a restart of the game server: a 3D practice game restarted during the mulligan and during the bot's turn, a ranked 3D vs classic game with a spectator restarted mid-turn and redeployed (stop and start) during the classic turn; everyone reconnects, the games finish, ratings change once, replays are complete. The commands default to `$SOULS_RESTART_CMD` / `$SOULS_REDEPLOY_CMD`, else `docker compose restart server` |
| `vfx3d.js <base> <out>` | Replays the new card set's effects in the 3D client (legendary entrance, inferno, ward, venom, ice, grow, rally, drain, shatter) |
| `hud3d.js <base> <out> [width height]` | Screenshots of the 3D client's interface states |
| `ui_capture.js <base> <out>` | Every website page on desktop (1600x900) and phone (412x915), with their validation errors, flash messages and empty states, including the admin pages; fails on a console error or a page that scrolls sideways |

`<base>` is the site, e.g. `https://localhost`; `<out>` a folder for the screenshots. Each script prints
`PASS`/`FAIL` lines or a list of console problems. `leave_dialog.js` holds the leave dialog checks the game scripts
share.

```sh
node rules3d.js https://localhost out/rules3d 2
```

`ui_capture.js` logs in as the admin with `SOULS_ADMIN_PASSWORD`, or the password `deploy/compose/init-secrets.sh`
wrote.

Without a GPU, Chromium renders WebGL in software and the scripted players get slow. Give turns and the mulligan more time, or
they time out (for example with an override file next to `compose.yaml`):

```yaml
services:
  server:
    environment:
      Souls__Game__TurnTime: "00:08:00"
      Souls__Game__MulliganTime: "00:03:00"
```

CI (job "Browser tests" in `.github/workflows/ci.yml`) runs `ui_capture.js`, `classic_ui.js` and `rules3d.js` on
every pull request against the stack with `compose.ci.yaml` (long turns). Those three exit non-zero on a `FAIL` line
or a console problem, which fails the pull request; the screenshots are the `e2e-screenshots` artifact.
