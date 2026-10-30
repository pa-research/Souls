# Souls: project plan and handover

Status on 30 October 2026, after the second working session. This document says where everything stands, how to pick
the work up again, and what to do next, in order of priority. The [README](../README.md) describes the product;
[game-protocol.md](game-protocol.md) the rules and the protocol; [balance.md](balance.md) the latest balance report.

## 1. Summary

Souls is a 2014 browser card game (ASP.NET MVC 5, NHibernate, MySQL) that has been rebuilt:

- **Platform**: .NET 10, ASP.NET Core, EF Core 10 and PostgreSQL 18, hardened containers, Docker Compose with Caddy,
  Kubernetes (Kustomize), GitHub Actions CI with browser tests, OpenTelemetry metrics and dashboards, scheduled
  backups, encrypted Data Protection keys. Running games are saved in the database and survive a restart of the game
  server.
- **Game**: a server-authoritative rules engine with 20-card decks, a mulligan, armor, four races with passives,
  20 abilities, spells, two hero powers per class to pick from, class cards, a turn timer, rating and matchmaking,
  seasons with tier rewards, daily quests, card upgrades, card packs, emotes, friendly challenges, spectating and
  replays, and a practice bot with three difficulty levels (Hard looks one turn ahead).
- **Content**: 59 cards: the 8 original cards with their original art, a 33-card expansion, 10 spells and 8 class
  cards (12 of the 59 are spells), with generated art. Balanced with a bot-versus-bot simulator.
- **Clients**: the original PixiJS client ("Classic", modernised HUD) and a three.js client ("Modern 3D") that renders
  with WebGPU (WebGL 2 fallback), with a stadium, camera views, touch controls and an effect for every ability.
- **Look**: one dark-fantasy design system for the site and both clients, with a finished polish pass over every page
  and both clients.

Everything is merged into `main`, which is the default branch on GitHub.

## 2. Branches and pull requests

| Branch | State |
|---|---|
| `main` | Default branch. Holds everything below (pull requests #2 to #25) |
| `dev`, `master` | The original 2014/2015 code. Untouched |
| `modernize/dotnet10`, `feature/*`, `fix/*`, `polish/*` | Merged. Their remote branches were not deleted (the session was not allowed to delete remote branches); they can all go |

Pull requests merged on 30 October:

| # | What |
|---|---|
| #3 | Expansion card set, classic loader fix, project plan, browser test scripts |
| #4 | Compose: configurable frontend subnet (`SOULS_FRONTEND_SUBNET`) |
| #5 | Admin page "Card statistics" from real games (P1-5) |
| #6 | Observability: OpenTelemetry, game metrics, dashboard and alerts (P3-19) |
| #7 | Data Protection keys encrypted with a certificate (P3-18) |
| #8 | Two-player browser test fixes |
| #9 | Scheduled database backups with a tested restore (P3-20) |
| #10 | Card packs with a reveal animation (P2-10) |
| #11 | 3D client: automatic quality step-down on slow frames (P1-7) |
| #12 | Seasons: rating resets, tier rewards, season leaderboard (P2-14) |
| #13 | Hard bot: one-turn lookahead (P2-15) |
| #14 | Mulligan (P2-13) |
| #15 | Emotes and friendly challenges (P2-16) |
| #16 | 3D client: no black arena when a warded card is on the board (NaN in a shader through bloom) |
| #17 | Spells (P2-11) |
| #18 | Browser tests in CI (P1-6) |
| #19 | Two hero powers per class and class cards (P2-12) |
| #20 | 3D client on three.js `WebGPURenderer` (WebGPU, WebGL 2 fallback), TSL shaders, node bloom |
| #21 | 3D client: the mulligan opens after the VS splash, not over it |
| #22 | Site polish pass |
| #23 | Persistent games: running games survive a game server restart (P3-17, one replica) |
| #24 | 3D client polish pass |
| #25 | Classic client polish pass |

## 3. What has been built

| Phase | Where | Highlights |
|---|---|---|
| Port to .NET 10 | `4840c14`, `5d2edad` | ASP.NET Core MVC site, WebSocket game server with the same JSON protocol, EF Core + PostgreSQL migrations, security fixes (password hashing, sessions, CSP, origin checks, rate limits), distroless non-root images, Compose + Caddy, Kustomize base/components/overlays, CI |
| Modern 3D client | `988895f`, `406f1b8`, `63cb41d`, #11, #16, #20 | three.js r186 client next to the classic one (switch top right), stadium with crowd, pillars and screens, camera views, bloom, touch controls, phone layouts, adaptive quality, WebGPU with WebGL 2 fallback |
| Original content | `c038258`, `26853bd` | The original April 2014 card art and card names restored |
| Gameplay overhaul | `57b84e7` | Armor, decks with fatigue, races, abilities, hero powers, Taunt, turn timer, bot (Easy/Normal/Hard), Elo rating and matchmaking, quests, upgrades, deck builder, spectating, replays, events protocol |
| AAA interface | `ead6547`, `28879f4`, #21, #22, #24, #25 | Design system (theme.css, game-hud.css, fonts, icons, rank emblems), every site page, 3D HUD and menus, classic HUD; then a polish pass over all three (transitions, overlaps, phone layouts, card tiles, empty and error states) |
| Content and features | #3, #10, #12 to #15, #17, #19 | Expansion, card packs, seasons, smarter bot, mulligan, emotes and friendly challenges, spells, hero power choice, class cards |
| Operations | #4 to #7, #9, #18, #23 | Card statistics, observability, encrypted keys, backups, browser tests in CI, persistent games |

Numbers today: 59 cards (12 spells, 8 class cards), 20 abilities, 4 classes with 8 hero powers, 8 migrations
(`InitialCreate`, `RestoreHuyCard`, `GameplayOverhaul`, `ExpansionCardSet`, `Seasons`, `Spells`, `HeroChoice`,
`RunningGames`), 171 .NET tests.

## 4. Architecture at a glance

```
 Browser ──HTTPS──▶ Caddy / ingress ─┬─ /ws/*  ──▶ souls-server  (game, chat, admin WebSockets; one replica)
                                     └─ /*     ──▶ souls-web     (site, shop, deck, admin, both game clients)
                                                        │                  │
                                                        └──── PostgreSQL ◀─┘   (one-shot `migrate` container first;
                                                                                running games in running_game*)
```

| Area | Where |
|---|---|
| Rules constants, ability definitions, hero powers, labels and texts | `src/Souls.Model/GameRules.cs` |
| Cards, classes, abilities, log types (seed data) | `src/Souls.Model/SeedData.cs` |
| Rarity rules and stat budget | `src/Souls.Model/Rarity.cs`, `src/Souls.Model/CardPower.cs` |
| Deck rules (validation, automatic and themed decks) | `src/Souls.Model/Decks.cs` |
| Migrations | `src/Souls.Model/Migrations` |
| Rules engine | `src/Souls.Server/Game/GameEngine.cs`, `GameEngine.Rules.cs`, `GameEngine.End.cs`, `GameRoom.cs` |
| Running games in the database | `src/Souls.Server/Game/GameStore.cs`, `GameRoom.Snapshot.cs`, `Matchmaker.cs` (restore on start, save on stop) |
| Card instances and their JSON | `src/Souls.Server/Objects/Card.cs` |
| Practice bot | `src/Souls.Server/Ai/AiPlayer.cs` |
| Site pages | `src/Souls.Web/Controllers`, `Views`, `wwwroot/css/site.css`, `wwwroot/js` |
| Design system | `src/Souls.Web/wwwroot/css/theme.css`, `game-hud.css` |
| Modern 3D client | `src/Souls.Web/wwwroot/Scripts/Game3D` (`scene.js` renderer and quality, `game.js` events, `cards.js` card faces, `effects.js`, `ui.js` HUD) |
| Classic client | `src/Souls.Web/wwwroot/Scripts/Game` (`Networking/GameService.js`, `Networking/EventPlayer.js`, `Objects/Card/Card.js`) |
| Card art | `src/Souls.Web/wwwroot/Content/Images/Card/Portraits` (originals and generated `*.jpg`, `CREDITS.md`) |
| Balance simulator | `tools/Souls.Sim` |
| Card art generator | `tools/card-art` |
| Browser tests (Playwright) | `tests/e2e` |
| Deployment | `compose.yaml`, `Dockerfile`, `deploy/compose`, `deploy/k8s`, `.github/workflows/ci.yml` |

## 5. How to run, test and tune

Everything below is also in the README; this is the short version for picking the work up.

1. **Run it**: `./deploy/compose/init-secrets.sh`, then `docker compose up -d --build`, then open
   <https://localhost>. The admin password is in `deploy/compose/secrets/Souls__Admin__Password`.
2. **.NET tests** (needs Docker for PostgreSQL): `dotnet test --project tests/Souls.Tests`. Expect 171 passing.
3. **Browser tests** against a running stack: see [tests/e2e/README.md](../tests/e2e/README.md). Without a GPU, start
   the stack with `COMPOSE_FILE=compose.yaml:tests/e2e/compose.ci.yaml` (long turns and mulligan, higher login rate
   limit), as CI does.
4. **Balance report**: `dotnet run --project tools/Souls.Sim -c Release -- --games 10000 --out docs/balance.md`
   (about 30 s). Add `--tune 5` to let it adjust the classes' health, or `--class id:attack,health,armor,mana` to try
   other class stats.
5. **Card art**: `cd tools/card-art && npm install && node generate.js` (5-15 s per card). Card specs are in
   `tools/card-art/cards.json`.
6. **After changing cards or classes**: change `SeedData.cs`, run the simulator, then add a migration:
   `dotnet ef migrations add <Name> --project src/Souls.Model --startup-project src/Souls.Model`.

## 6. Verification status

| Check | Result | When |
|---|---|---|
| .NET unit and integration tests | 171 / 171 pass (CI) | After #23 |
| CI browser tests (`ui_capture.js`, `classic_ui.js`, `rules3d.js` on every pull request, software rendering) | Pass. Two flakes seen once each and passed on rerun: `ERR_NETWORK_CHANGED` on the runner, and a Hard-bot game won before the script could afford a card | After #23 |
| 3D practice game (`rules3d.js`) | 17 / 17 on the RTX 3090 with WebGPU and with WebGL 2, and in CI with the automatic WebGL 2 fallback | After #24 |
| Spells (`spells.js`) | 26 / 26 (shop, deck, 3D and classic casting, spectator, phone tap-tap) | After #24 |
| Hero choice (`hero_choice.js`) | 19 / 19 | After #24 |
| Two players with a spectator (`pvp_rules.js`) | 13 / 13 on the GPU, including "spectator receives live events". With CI's 8-minute turns that one step can time out | After #19 and #20 |
| Restart survival (`restart.js`) | 22 / 22: restarts during the mulligan, the bot's turn and a ranked turn, a redeploy, ratings applied once, complete replays | After #23, on the merged code |
| Website pages, desktop and phone (`ui_capture.js`) | No console errors, no page scrolls sideways; covers the new pages | After #22 |
| Balance (10 000 bot games) | Spells 46-55 % played win rate; new hero powers 47-53 % against the class's other power; class cards 47-51 % (adjusted). Classes are far apart: Harrison 61.0 %, Lurker 57.5 %, Rabid Soul 57.2 %, Fader 24.5 % | After #19 |
| Upgrade from the previous release | Players registered on the old version all have 20-card decks after the migrations | Test database, P0-3 check |
| Kubernetes | Deployed locally on kind with ingress-nginx; smoke test passes | P0-3 check |
| Desktop GPU frame rate | RTX 3090, 1080p: 57-60 fps with vsync (WebGL renderer, #11). At 4x CPU throttle the WebGPU build (#20) costs about 15 % more CPU per frame than the WebGL renderer it replaced | After #20 |
| Real devices (phones, tablets, Safari, Firefox, Windows/macOS Chrome) | **Not tested.** Only Playwright emulation | - |
| Migration on a copy of real production data | **Not done.** No production data was available | - |

## 7. Known issues and risks

**Gameplay and balance**
- Fader wins 24.5 % of bot games; Harrison 61 %. A class retune is needed (`--tune` in the simulator) and is the
  owner's call, because it changes the classes' health and armor again.
- The balance comes from the bot playing itself, not from people. The "Card statistics" admin page shows real win
  rates once people play.
- Friendly games give coins and quest progress, so two accounts can farm them.

**Art**
- All new portraits (expansion, spells, class cards) are generated "lit emblems" built from game-icons.net
  silhouettes, not paintings.
- The original cards use their 2014 art, which includes third-party images (photos, a Sonic character, a film
  still). Fine for a hobby project; replace before any commercial use.

**Clients**
- WebGPU is new: tested on Chromium with an NVIDIA GPU only. On one Linux setup (ANGLE on GL, WebGPU on Vulkan) canvas
  textures came out blank; `willReadFrequently` canvases fix it there, not yet confirmed on other machines.
- Classic client on a phone: upright it asks you to turn the phone; sideways the board is stretched about 20 %.
- About one frame in a thousand of the classic client was drawn without the arena (cause unknown; the stage colour now
  hides it).
- Leaving a game uses the browser's confirm dialog; the end screen shows no season information.

**Platform**
- The game server runs as one replica. Running games survive a restart, but a second replica needs ownership leases,
  routing or cross-replica events, and a shared lobby (design in the README's known limitations).
- Saving a running game holds the game lock (about 10 ms). If the database is slow, every game waits up to 2 s, then
  saving pauses for 5 s. Fine at today's scale.
- After a restart the in-game chat room is not restored; a crash (no SIGTERM) can lose the last action.
- The classic client still runs its 2014 libraries (PixiJS 1.x, CreateJS 0.x) under a strict CSP.
- Legacy MySQL data is not imported automatically.
- ingress-nginx was retired in March 2026; the production overlay uses the Gateway API, the `ingress` component is
  for local clusters only.

## 8. Roadmap

Ordered by priority. Done items keep their number.

### P0: ship what is built

1. ~~Pull request for the expansion~~ **Done** (#3).
2. ~~Default branch~~ **Done**: `main` is the default.
3. **Deploy**: tested locally (Compose, and Kubernetes on kind). *Still to do*: pick the host, back up the database,
   run the migrations on a copy of production data, deploy, smoke test.
4. ~~Two-player check~~ **Done**: `pvp_rules.js` passes on a GPU.

### P1: confidence and quality

5. **Play-test with people**. The "Card statistics" admin page is built (#5); compare it with `docs/balance.md` after
   a week of real games.
6. ~~Browser tests in CI~~ **Done** (#18).
7. **Real devices**: adaptive quality (#11) and WebGPU (#20) are in. *Still to do*: test on an iPhone, an Android
   phone and Safari/Firefox (frame rate, touch, sound, WebGPU fallback).
8. **Art pass** (owner): replace the generated portraits, starting with the legendaries. Keep the file names.
9. **Class retune** (new): bring Fader and Harrison back towards 50 % with the simulator, then a migration.

### P2: content and features

10. **Lost original cards** (Paul and others): needs an old persoft.no backup or the Wayback Machine.
11. ~~Card packs~~ (#10), ~~Spells~~ (#17), ~~More hero choice~~ (#19), ~~Mulligan~~ (#14), ~~Seasons~~ (#12),
    ~~Smarter Hard bot~~ (#13), ~~Emotes and friendly challenges~~ (#15): **Done**.
12. **Season on the end screen**: send the season tier change with the game result and show it in both clients.

### P3: platform and operations

13. **Persistent games**: restart survival **done** (#23). *Still to do* for more than one replica: the design in the
    README.
14. ~~Encrypted Data Protection keys~~ (#7), ~~Observability~~ (#6, opt-in in production), ~~Backups~~ (#9): **Done**.
15. **Import the legacy MySQL data** if the old database turns up.
16. **Classic client**: polished (#25). Decide whether it stays (port to a current PixiJS) or the 3D client's
    classic view replaces it.

## 9. Open decisions for the owner

- **Class retune**: run the simulator's `--tune` now, or wait for real games?
- **Art**: keep the generated portraits, or commission or license painted art? Keep the third-party images in the
  original cards?
- **Lost cards**: is there an old database backup from persoft.no?
- **Hosting**: which cluster or VM? Both Compose and Kubernetes (Gateway API) are ready.
- **Classic client**: keep it, port it, or retire it in favour of the 3D client's classic view?
- **Old branches**: delete the merged remote branches (`feature/*`, `fix/*`, `polish/*`, `modernize/dotnet10`)?

## 10. Picking the work up in a new session

1. Clone and stay on `main`.
2. Install the .NET 10 SDK and Docker; run `dotnet test --project tests/Souls.Tests` (171 tests).
3. `./deploy/compose/init-secrets.sh` and `docker compose up -d --build`; open <https://localhost>.
4. For browser tests: `cd tests/e2e && npm ci`, then the commands in its README.
5. Read sections 6 to 9 above and start at the first item that is not done.
