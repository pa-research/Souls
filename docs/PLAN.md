# Souls: project plan and handover

Status on 31 October 2026, after the second working session. This document says where everything stands, how to pick
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
  replays, and a practice bot with three difficulty levels (Hard looks one turn ahead). Friendly games give no
  rewards; ranked games show the season tier change on the end screen.
- **Content**: 59 cards: the 8 original cards with their original art, a 33-card expansion, 10 spells and 8 class
  cards (12 of the 59 are spells), with generated art. Balanced with a bot-versus-bot simulator: every class wins
  48-51 % of bot games.
- **Clients**: the original PixiJS client ("Classic", modernised HUD) and a three.js client ("Modern 3D") that renders
  with WebGPU (WebGL 2 fallback), with a stadium, camera views, touch controls, a portrait layout for phones held
  upright and an effect for every ability.
- **Look**: one dark-fantasy design system for the site and both clients, with a finished polish pass over every page
  and both clients.

Everything is merged into `main`, which is the default branch on GitHub.

## 2. Branches and pull requests

| Branch | State |
|---|---|
| `main` | Default branch. Holds everything below (pull requests #2 to #31) |
| `dev`, `master` | The original 2014/2015 code. Untouched |
| `modernize/dotnet10`, `feature/*`, `fix/*`, `polish/*` | Merged. Their remote branches were not deleted (the session was not allowed to delete remote branches); they can all go |

Pull requests merged on 30 and 31 October:

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
| #26 | 3D client: portrait layout for phones held upright |
| #27 | This plan |
| #28 | Card art: more varied, cleaner generated portraits (the 2014 originals unchanged) |
| #29 | Class retune: every class 48-51 % (Fader was 24.5 %) |
| #30 | Friendly games give no rewards, season on the end screen, game chat restored after a restart, database saves off the game lock |
| #31 | Client polish: themed leave dialog, toasts off the heroes, classic board keeps 16:9, safe areas, cinematic camera clear of the pillars |

## 3. What has been built

| Phase | Where | Highlights |
|---|---|---|
| Port to .NET 10 | `4840c14`, `5d2edad` | ASP.NET Core MVC site, WebSocket game server with the same JSON protocol, EF Core + PostgreSQL migrations, security fixes (password hashing, sessions, CSP, origin checks, rate limits), distroless non-root images, Compose + Caddy, Kustomize base/components/overlays, CI |
| Modern 3D client | `988895f`, `406f1b8`, `63cb41d`, #11, #16, #20 | three.js r186 client next to the classic one (switch top right), stadium with crowd, pillars and screens, camera views, bloom, touch controls, phone layouts, adaptive quality, WebGPU with WebGL 2 fallback |
| Original content | `c038258`, `26853bd` | The original April 2014 card art and card names restored |
| Gameplay overhaul | `57b84e7` | Armor, decks with fatigue, races, abilities, hero powers, Taunt, turn timer, bot (Easy/Normal/Hard), Elo rating and matchmaking, quests, upgrades, deck builder, spectating, replays, events protocol |
| AAA interface | `ead6547`, `28879f4`, #21, #22, #24 to #26, #31 | Design system (theme.css, game-hud.css, fonts, icons, rank emblems), every site page, 3D HUD and menus, classic HUD; then a polish pass over all three (transitions, overlaps, phone layouts, card tiles, empty and error states) |
| Content and features | #3, #10, #12 to #15, #17, #19, #28 to #30 | Expansion, card packs, seasons, smarter bot, mulligan, emotes and friendly challenges, spells, hero power choice, class cards, art pass, class retune, season results |
| Operations | #4 to #7, #9, #18, #23, #30 | Card statistics, observability, encrypted keys, backups, browser tests in CI, persistent games |

Numbers today: 59 cards (12 spells, 8 class cards), 20 abilities, 4 classes with 8 hero powers, 9 migrations
(`InitialCreate`, `RestoreHuyCard`, `GameplayOverhaul`, `ExpansionCardSet`, `Seasons`, `Spells`, `HeroChoice`,
`RunningGames`, `ClassRetune`), 175 .NET tests.

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
2. **.NET tests** (needs Docker for PostgreSQL): `dotnet test --project tests/Souls.Tests`. Expect 175 passing.
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
| .NET unit and integration tests | 175 / 175 pass (CI) | After #30 |
| CI browser tests (`ui_capture.js`, `classic_ui.js`, `rules3d.js` on every pull request, software rendering) | Pass. Occasional flakes (a network change on the runner, a Hard-bot game won before the script could afford a card) pass on rerun | After #31 |
| 3D practice game (`rules3d.js`) | 22 / 22 as Rabid Soul, 21 / 21 as Fader (GPU, WebGL 2); also on hardware WebGPU and in CI | After #31 |
| Phone held upright (`portrait.js`) | 34 / 34 at 412x915 and at 360x780, a full game played by touch; also on hardware WebGPU | After #31 |
| Spells (`spells.js`), hero choice (`hero_choice.js`) | 22 / 22 and 19 / 19 | After #31 |
| Classic client (`classic_ui.js`) | Pass at 1600x900 and 915x412 (16:9 board, leave dialog) | After #31 |
| Two players with a spectator (`pvp_rules.js`) | 14 / 14, incl. live events for the spectator and the season on both end screens | After #31 |
| Friendly challenges and emotes (`social.js`) | 24 / 24, no rewards for friendly games | After #30 |
| Restart survival (`restart.js`) | 23 / 23: restarts during the mulligan, the bot's turn and a ranked turn, a redeploy, the game chat comes back, ratings applied once, complete replays | After #30 |
| Website pages, desktop and phone (`ui_capture.js`) | No console errors, no page scrolls sideways; covers the new pages | After #28 |
| Balance (three runs of 10 000 bot games) | Classes 48.0-51.2 %, worst matchup 42-45 %, hero powers 45.7-54.3 % against the class's other power, races 50.2-52.6 %, first player 48.4-48.6 %, 24.7 turns. Expensive cards read 55-60 % drawn win rate but 50-54 % counted over every game of a deck that holds them | After #29 |
| Upgrade from the previous release | Players registered on the old version all have 20-card decks after the migrations | Test database, P0-3 check |
| Kubernetes | Deployed locally on kind with ingress-nginx; smoke test passes | P0-3 check |
| Desktop GPU frame rate | RTX 3090, 1080p: 57-60 fps with vsync (WebGL renderer, #11). At 4x CPU throttle the WebGPU build (#20) costs about 15 % more CPU per frame than the WebGL renderer it replaced | After #20 |
| Real devices (phones, tablets, Safari, Firefox, Windows/macOS Chrome) | **Not tested.** Only Playwright emulation | - |
| Migration on a copy of real production data | **Not done.** No production data was available | - |

## 7. Known issues and risks

**Gameplay and balance**
- A class played with its own race is lopsided: Harrison with Lightbringer decks wins about 70 %, Lurker with Vampiric
  about 43 % (bot games; the bot picks races at random, people choose them). A follow-up pass on the race passives
  is in progress.
- The balance comes from the bot playing itself, not from people. The "Card statistics" admin page shows real win
  rates once people play.

**Art**
- All new portraits (expansion, spells, class cards) are generated "lit emblems" built from game-icons.net
  silhouettes (CC BY 3.0), not paintings; #28 made them more varied and cleaner.
- The original cards use their 2014 art, which includes third-party images (photos, a Sonic character, a film
  still). Kept on purpose for a hobby project; replace before any commercial use.
- The lost original cards (Paul and others) cannot be restored without an old persoft.no backup.

**Clients**
- WebGPU is tested on Chromium with an NVIDIA GPU only. On one Linux setup (ANGLE on GL, WebGPU on Vulkan) canvas
  textures came out blank; `willReadFrequently` canvases fix it there, not yet confirmed on other machines.
- The classic client asks you to turn a phone held upright; the 3D client plays upright.
- About one frame in a thousand of the classic client was drawn without the arena (cause unknown; the stage colour
  hides it).
- In landscape the 3D hand and End Turn do not avoid side notches (portrait does).

**Platform**
- The game server runs as one replica (decided: restart survival is enough at this scale). A second replica needs
  ownership leases, routing or cross-replica events, and a shared lobby (design in the README's known limitations).
- A crash (no SIGTERM) can lose the last action that was not written yet.
- The classic client still runs its 2014 libraries (PixiJS 1.x, CreateJS 0.x) under a strict CSP (decided: keep).
- ingress-nginx was retired in March 2026; the production overlay uses the Gateway API, the `ingress` component is
  for local clusters only.

## 8. Roadmap

Ordered by priority. Done items are struck through.

### P0: ship it

1. ~~Pull request for the expansion~~ (#3), ~~default branch~~, ~~two-player check~~: **Done**.
2. **Deploy**: tested locally (Compose, and Kubernetes on kind). *Still to do* (needs a host and its credentials):
   back up the database, run the migrations on a copy of production data, deploy, smoke test.

### P1: confidence and quality

3. **Real devices**: test on an iPhone, an Android phone, Safari and Firefox (frame rate, touch, sound, WebGPU and
   its fallback, safe areas).
4. **Play-test with people** for a week, then compare the "Card statistics" admin page (#5) with `docs/balance.md`.
5. **Own-race balance**: in progress (see section 7).
6. ~~Browser tests in CI~~ (#18), ~~class retune~~ (#29), ~~AAA polish~~ (#21, #22, #24 to #26, #31),
   ~~art pass~~ (#28): **Done**.

### P2: content and features

7. ~~Card packs~~ (#10), ~~Spells~~ (#17), ~~More hero choice~~ (#19), ~~Mulligan~~ (#14), ~~Seasons~~ (#12, end
   screen #30), ~~Smarter Hard bot~~ (#13), ~~Emotes and friendly challenges~~ (#15, no rewards #30): **Done**.
8. **Lost original cards**: only with an old persoft.no backup.

### P3: platform and operations

9. ~~Persistent games~~ (#23, #30), ~~encrypted Data Protection keys~~ (#7), ~~observability~~ (#6, opt-in in
   production), ~~backups~~ (#9): **Done**.
10. **More than one game server replica**: not planned (see section 7); the design is in the README.
11. **Import the legacy MySQL data** if the old database turns up.

## 9. Decisions taken (31 October)

The owner delegated the open decisions:

- **Class balance**: retuned now with the simulator (#29); own-race decks next.
- **Art**: keep the 2014 originals; improve the generated portraits (#28) instead of commissioning art.
- **Classic client**: keep it as it is (polished, tested); no port to a current PixiJS.
- **Friendly games**: no coins, quests, rating or season points (#30).
- **Game server replicas**: one, with restart survival.
- **Lost cards**: not searched further.

Still open, because they need the owner's accounts or hardware:

- **Hosting**: which cluster or VM (Compose and Kubernetes with the Gateway API are ready).
- **Old branches**: the merged remote branches (`feature/*`, `fix/*`, `polish/*`, `balance/*`, `art/*`, `docs/*`,
  `modernize/dotnet10`) can be deleted; the session was not allowed to delete remote branches.

## 10. Picking the work up in a new session

1. Clone and stay on `main`.
2. Install the .NET 10 SDK and Docker; run `dotnet test --project tests/Souls.Tests` (175 tests).
3. `./deploy/compose/init-secrets.sh` and `docker compose up -d --build`; open <https://localhost>.
4. For browser tests: `cd tests/e2e && npm ci`, then the commands in its README.
5. Read sections 6 to 9 above and start at the first item that is not done.
