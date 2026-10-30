# Souls: project plan and handover

Status on 30 October 2026, when work in the cloud session stopped. This document says where everything stands,
how to pick the work up again, and what to do next, in order of priority. The [README](../README.md) describes the
product; [game-protocol.md](game-protocol.md) the rules and the protocol; [balance.md](balance.md) the latest
balance report.

## 1. Summary

Souls is a 2014 browser card game (ASP.NET MVC 5, NHibernate, MySQL) that has been rebuilt:

- **Platform**: .NET 10, ASP.NET Core, EF Core 10 and PostgreSQL 18, hardened containers, Docker Compose with Caddy,
  Kubernetes (Kustomize), GitHub Actions CI.
- **Game**: a server-authoritative rules engine with 20-card decks, armor, four races with passives, 19 abilities,
  hero powers, a turn timer, rating and matchmaking, daily quests, card upgrades, spectating and replays, and a
  practice bot with three difficulty levels.
- **Content**: 41 cards in four rarities: the 8 original cards with their original art, and a 33-card expansion with
  generated art. Balanced with a bot-versus-bot simulator.
- **Clients**: the original PixiJS client ("Classic", modernised HUD) and a three.js client ("Modern 3D") with a
  stadium, camera views, touch controls and an effect for every ability.
- **Look**: one dark-fantasy design system for the site and both clients.

Everything is on GitHub. `main` holds the work up to the AAA interface (pull request #2, merged). The expansion,
a classic-client loader fix, the browser test scripts and this plan are on `feature/expansion-card-set`, which
starts from `main` and waits for a pull request.

## 2. Branches and pull requests

| Branch | What it holds | State |
|---|---|---|
| `dev` | The original 2014/2015 code (the repository's default branch) | Untouched |
| `modernize/dotnet10` | The first port to .NET 10 with Compose and Kubernetes | Contained in `main` |
| `main` | `dev` plus the port, the 3D client, the gameplay overhaul and the AAA interface (pull request #2) | Merged on 29 Oct |
| `feature/threejs-arena` | The 3D client, gameplay overhaul and AAA interface (merged as pull request #2), plus two later commits that are repeated on the branch below | Done; can be deleted after the next merge |
| `feature/expansion-card-set` | `main` plus the expansion card set, the classic loader fix, browser tests and this plan | **Needs a pull request into `main`** |

Open the pull request here if the session did not:
<https://github.com/pa-research/Souls/compare/main...feature/expansion-card-set?expand=1>

Decision for the owner: the default branch is still `dev`. Making `main` the default is probably what you want now
(GitHub: Settings, General, Default branch).

## 3. What has been built

| Phase | Commit | Highlights |
|---|---|---|
| Port to .NET 10 | `4840c14`, `5d2edad` | ASP.NET Core MVC site, WebSocket game server with the same JSON protocol, EF Core + PostgreSQL migrations, security fixes (password hashing, sessions, CSP, origin checks, rate limits), distroless non-root images, Compose + Caddy, Kustomize base/components/overlays, CI |
| Modern 3D client | `988895f`, `406f1b8`, `63cb41d` | three.js r186 client next to the classic one (switch top right), stadium with crowd, pillars and screens, camera views, bloom, touch controls, phone layouts |
| Original content | `c038258`, `26853bd` | The original April 2014 card art and card names restored |
| Gameplay overhaul | `57b84e7` | Armor, decks with fatigue, races, 9 abilities, hero powers, Taunt, turn timer, smarter bot (Easy/Normal/Hard), Elo rating and matchmaking, quests, upgrades, deck builder, spectating, replays, events protocol |
| AAA interface | `ead6547`, `28879f4` | Design system (theme.css, game-hud.css, fonts, icons, rank emblems), every site page, 3D HUD and menus, classic HUD |
| Expansion card set | `Expansion card set: ...` | 33 cards, rarities, 10 new abilities with per-card values, generated art, simulator and balance pass, effects and sounds in both clients, shop filters, deck limits per rarity, data migration |
| Classic loader fix | `Classic client: no module load timeout` | RequireJS no longer gives up after 7 s on slow devices |

Numbers today: 41 cards (18 common, 11 rare, 6 epic, 6 legendary; about 10 per race), 19 abilities, 4 hero
classes, 4 migrations (`InitialCreate`, `RestoreHuyCard`, `GameplayOverhaul`, `ExpansionCardSet`), 105 .NET tests.

## 4. Architecture at a glance

```
 Browser ──HTTPS──▶ Caddy / ingress ─┬─ /ws/*  ──▶ souls-server  (game, chat, admin WebSockets; in-memory games)
                                     └─ /*     ──▶ souls-web     (site, shop, deck, admin, both game clients)
                                                        │                  │
                                                        └──── PostgreSQL ◀─┘   (one-shot `migrate` container first)
```

| Area | Where |
|---|---|
| Rules constants, ability definitions, labels and texts | `src/Souls.Model/GameRules.cs` |
| Cards, classes, abilities, log types (seed data) | `src/Souls.Model/SeedData.cs` |
| Rarity rules and stat budget | `src/Souls.Model/Rarity.cs`, `src/Souls.Model/CardPower.cs` |
| Deck rules (validation, automatic and themed decks) | `src/Souls.Model/Decks.cs` |
| Migrations | `src/Souls.Model/Migrations` (the expansion one also gives existing players the common starters) |
| Rules engine | `src/Souls.Server/Game/GameEngine.cs`, `GameEngine.Rules.cs`, `GameEngine.End.cs`, `GameRoom.cs` |
| Card instances and their JSON | `src/Souls.Server/Objects/Card.cs` |
| Practice bot | `src/Souls.Server/Ai/AiPlayer.cs` |
| Site pages | `src/Souls.Web/Controllers`, `Views`, `wwwroot/css/site.css`, `wwwroot/js` |
| Design system | `src/Souls.Web/wwwroot/css/theme.css`, `game-hud.css` |
| Modern 3D client | `src/Souls.Web/wwwroot/Scripts/Game3D` (`game.js` events, `cards.js` card faces, `effects.js`, `crowd.js` audio) |
| Classic client | `src/Souls.Web/wwwroot/Scripts/Game` (`Networking/EventPlayer.js`, `Objects/Card/Card.js`, `Objects/Animation/Animation.js`) |
| Card art | `src/Souls.Web/wwwroot/Content/Images/Card/Portraits` (originals and generated `*.jpg`, `CREDITS.md`) |
| Balance simulator | `tools/Souls.Sim` |
| Card art generator | `tools/card-art` |
| Browser tests (Playwright) | `tests/e2e` |
| Deployment | `compose.yaml`, `Dockerfile`, `deploy/compose`, `deploy/k8s`, `.github/workflows/ci.yml` |

## 5. How to run, test and tune

Everything below is also in the README; this is the short version for picking the work up.

1. **Run it**: `./deploy/compose/init-secrets.sh`, then `docker compose up -d --build`, then open
   <https://localhost>. The admin password is in `deploy/compose/secrets/Souls__Admin__Password`.
2. **.NET tests** (needs Docker for PostgreSQL): `dotnet test --project tests/Souls.Tests`. Expect 105 passing.
3. **Browser tests** against a running stack: see [tests/e2e/README.md](../tests/e2e/README.md). With software
   rendering (no GPU) start the server with long turns, or the scripted players time out:
   `Souls__Game__TurnTime=00:08:00`.
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
| .NET unit and integration tests | 105 / 105 pass | After the expansion |
| Balance (10 000 bot games) | Classes 48-53 %, races 48.5-51.7 %, every card 48.8-54.7 % drawn win rate, first player 51.9 %, about 17 turns | After the expansion |
| 3D practice game against the Hard bot (`rules3d.js`) | 14 / 14 checks, no console errors, replay works | After the expansion |
| 3D effects replayed in the browser (`vfx3d.js`) | Inferno, ward, venom, ice, grow, rally, drain, shatter and the legendary banner render; no console errors | After the expansion |
| Classic practice game against the Hard bot (`classic_ui.js`) | Cards played, hero power and attacks work, no console errors | After the expansion |
| Website pages, desktop and phone (`ui_capture.js`) | No errors apart from the deliberate 404 page | After the expansion |
| Two players (3D against Classic) with a spectator (`pvp_rules.js`) | **Partly.** Match creation, live games list and joining as a spectator pass; the run was stopped after 15 turns because software rendering made it very slow. The "spectator receives live events" check failed, most likely because the long test turns meant nobody acted while the spectator waited. Not yet confirmed. | After the expansion |
| Real devices (GPU, phones, touch) | **Not tested.** All browser tests ran in headless Chromium with software rendering | - |
| Migration on a copy of real production data | **Not done.** Only tested on the test database | - |

## 7. Known issues and risks

**Gameplay and balance**
- The balance comes from the Hard bot playing itself, not from people. Human players will find stronger lines.
  The low-health classes are sensitive: one point of Harrison's health moves his win rate by several percent.
- The original cards' stats and all four classes were changed for balance (for example Bobby is now a 1-mana 1/3
  Taunt, Fader has 44 health and 6 armor). The original art and names are kept.
- `CardPower` (the stat budget) is only a first guess; its test allows a wide margin and the simulator decides.
- The bot plays the new abilities with simple rules (it holds Inferno back while the enemy board is small, burns or
  drains the best target it can kill, pops wards with small cards). It does not look ahead.

**Art**
- The 33 new portraits are generated "lit emblems" built from game-icons.net silhouettes, not paintings. Public-domain
  art archives and image generators were not reachable from the cloud session. Weakest: the Vampiric cards all
  lean on red blood moons, Blood Thrall and Acolyte of Dawn are plain, Frost Jotun is busy, Lord Varga shows thin red
  outlines.
- The original cards use their 2014 art, which includes third-party images (photos, a Sonic character, a film
  still). Fine for a hobby project; replace before any commercial use.
- Long names such as "Dr. Robotnik" sit close to the race emblem on the site's card tiles.

**Clients**
- The classic client's new effects were built against a mock harness and checked in one live game; Drain on touch
  (long press) and Fury's second attack were not exercised in the live test.
- Under software rendering the browser can stall for seconds, so time-based animations (the legendary banner)
  may be missed in screenshots. On a GPU this is not an issue.

**Platform** (also in the README's known limitations)
- Games live in the game server's memory: one replica, and a restart ends running games (finished games and
  replays are stored).
- The Data Protection key ring is stored unencrypted in the database.
- The classic client still runs its 2014 libraries (PixiJS 1.x, CreateJS 0.x) under a strict CSP.
- Legacy MySQL data is not imported automatically.

## 8. Roadmap

Ordered by priority. Each item says when it is done.

### P0: ship what is built

1. **Pull request for the expansion** into `main`, review, merge. *Done when* `main` contains the expansion and CI
   is green.
2. **Default branch**: make `main` the default (or merge it into `dev`). *Done when* new clones get the current code.
3. **Deploy**: the `migrate` container applies `ExpansionCardSet` automatically. Before the first production run,
   back up the database, run the migration on a copy of production data and check that every player has a full deck
   (the migration gives existing players the common starter cards). *Done when* production runs the new card set and
   a smoke test (register, practice game, shop, deck) passes.
4. **Finish the two-player check**: run `tests/e2e/pvp_rules.js` on a machine with a GPU (or with normal turn
   times) and confirm the spectator sees live events. *Done when* all its checks pass.

### P1: confidence and quality

5. **Play-test with people** for a week; collect card win rates from real games. The data is already stored
   (`game_log` holds every card played, `game` the winner). Build an admin page "Card statistics" that shows win
   rate when played, per card and class, from real games. *Done when* the page exists and is compared with
   `docs/balance.md`.
6. **Browser tests in CI**: run `tests/e2e` against the Compose stack in a GitHub Actions job (headless Chromium,
   long turn times), at least `rules3d.js`, `classic_ui.js` and `ui_capture.js`. *Done when* a pull request fails if
   a client breaks.
7. **Real devices**: test on an iPhone, an Android phone and a desktop with a GPU (frame rate, touch, sound,
   legendary entrance, ward bubbles). *Done when* the 3D client keeps 60 fps on a mid-range phone in the Arena view
   or the quality setting drops automatically.
8. **Art pass**: replace the generated portraits with painted art (commissioned, licensed, or a model with clear
   commercial terms), starting with the six legendaries and the Vampiric cards. Keep the file names (`{id}.jpg`) so
   no code changes. *Done when* the shop no longer mixes emblem and painted styles.

### P2: content and features

9. **Lost original cards** (Paul and others): only an old persoft.no database backup or the Wayback Machine can
   bring them back exactly. With names and stats they become seed data plus a migration (the card editor works too).
10. **Card packs**: a reveal animation for buying a random pack (5 cards, at least one rare) next to buying single
    cards; duplicates level cards up. Price it so a pack costs less than its cards on average.
11. **Spells**: cards that are played on a target and do not stay on the board. Needs targeting from the hand in
    both clients and a `spell` card kind in the protocol.
12. **More hero choice**: two hero powers per class to pick from, and class-specific cards.
13. **Mulligan**: replace any of the starting cards once.
14. **Seasons**: rating resets with rewards per tier; season leaderboard.
15. **Smarter Hard bot**: one-turn lookahead (simulate its own actions on a copy of the state), scored with the same
    value function. Use `tools/Souls.Sim` to prove it beats today's bot.
16. **Emotes and friendly challenges** (invite a friend instead of the ranked queue).

### P3: platform and operations

17. **Persistent games**: keep running games in the database or Redis so the game server can restart and scale
    beyond one replica.
18. **Encrypt the Data Protection keys** (`ProtectKeysWithCertificate` or a key vault).
19. **Observability**: OpenTelemetry traces and metrics (games running, queue times, errors), dashboards, alerts.
20. **Backups**: scheduled PostgreSQL backups with a tested restore (Compose: a backup container; Kubernetes: the
    operator or a CronJob).
21. **Import the legacy MySQL data** if the old database turns up (accounts, decks, game history).
22. **Classic client libraries**: if the classic client stays, consider a port to a current PixiJS; otherwise make
    the 3D client the only one with a classic top-down view (it already has one).

## 9. Open decisions for the owner

- **Art**: keep the generated portraits, or commission or license painted art? Keep the third-party images in the
  original cards?
- **Original cards**: they were rebalanced (stats, rarity, price). Keep that, or freeze the originals and balance
  only the new cards?
- **Lost cards**: is there an old database backup from persoft.no?
- **Branches**: make `main` the default branch?
- **Hosting**: where should it run (a VM with Compose, or Kubernetes)? The deployment files support both.

## 10. Picking the work up in a new session

1. Clone, check out `feature/expansion-card-set` (or `main` once the pull request is merged).
2. Install the .NET 10 SDK and Docker; run `dotnet test --project tests/Souls.Tests`.
3. `./deploy/compose/init-secrets.sh` and `docker compose up -d --build`; open <https://localhost>.
4. For browser tests: `cd tests/e2e && npm install`, then the commands in its README.
5. Read sections 6 to 8 above and start at the first P0 item that is not done.
