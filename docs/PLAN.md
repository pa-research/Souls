# Souls: project plan and handover

Status on 1 November 2026, after the second working session and the AAA round. This document says where everything stands, how to pick
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
- **Content**: 59 cards: the 8 original cards, a 33-card expansion, 10 spells and 8 class cards (12 of the 59 are
  spells), all with painted art (OpenAI image generation through Codex) in one style, and painted heroes. Balanced with a bot-versus-bot simulator: every class wins
  48-51 % of bot games.
- **Clients**: the original PixiJS client ("Classic", modernised HUD) and a three.js client ("Modern 3D") that renders
  with WebGPU (WebGL 2 fallback), with a crafted stadium (architecture, procedural materials, an animated crowd), camera
  views, touch controls, a portrait layout for phones held upright and an effect for every ability; blows land with a
  frame-freeze and a camera knock, the killing blow on a hero plays in slow motion, and the screen's edges pulse red
  while the player's hero is low.
- **Sound**: 41 sound effects, a menu theme and a battle theme generated with ElevenLabs, in both clients; in the 3D
  client every hero speaks (emotes, an intro, low health, victory and defeat) in English and Norwegian.
- **Languages**: English and Norwegian Bokmål (site, game texts, both clients); more languages are more resource files.
- **Look**: one dark-fantasy design system for the site and both clients, with a finished polish pass over every page
  and both clients.

Everything is merged into `main`, which is the default branch on GitHub. The demo runs at <https://souls.perception.no>
(deployed through the owner's per-arne-agent infrastructure repository: Flux, `infrastructure/souls-demo`).

## 2. Branches and pull requests

| Branch | State |
|---|---|
| `main` | Default branch. Holds everything below (pull requests #2 to #38) |
| `dev`, `master` | The original 2014/2015 code. Untouched |
| `modernize/dotnet10`, `feature/*`, `fix/*`, `polish/*` | Merged. Their remote branches were not deleted (the session was not allowed to delete remote branches); they can all go |

Pull requests merged from 30 October to 1 November:

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
| #32 | Balance report: class × deck-race table; cards flagged by their in-deck win rate |
| #33 | Audio: ElevenLabs sound effects and music in both clients |
| #34 | Painted card, hero and shop art (Codex image generation); third-party 2014 images moved to `original-2014/` |
| #35 | AAA leftovers: landscape safe areas, tooltips, opponent hand, shop on phones, menu camera, classic arena frames and hand, touch wording, cheaper bloom |
| #36 | Localization: English and Norwegian Bokmål |
| #37 | Stadium rebuild: architecture, procedural materials, crowd, lighting, banners, new site backdrop |
| #38 | Two flaky browser checks |
| #40 | rules3d: the battle log is read before the end screen leaves; CI plays the Normal bot |
| #41 | 3D client: card and hero tooltips go beside what is hovered |

## 3. What has been built

| Phase | Where | Highlights |
|---|---|---|
| Port to .NET 10 | `4840c14`, `5d2edad` | ASP.NET Core MVC site, WebSocket game server with the same JSON protocol, EF Core + PostgreSQL migrations, security fixes (password hashing, sessions, CSP, origin checks, rate limits), distroless non-root images, Compose + Caddy, Kustomize base/components/overlays, CI |
| Modern 3D client | `988895f`, `406f1b8`, `63cb41d`, #11, #16, #20 | three.js r186 client next to the classic one (switch top right), stadium with crowd, pillars and screens, camera views, bloom, touch controls, phone layouts, adaptive quality, WebGPU with WebGL 2 fallback |
| Original content | `c038258`, `26853bd` | The original April 2014 card art and card names restored |
| Gameplay overhaul | `57b84e7` | Armor, decks with fatigue, races, abilities, hero powers, Taunt, turn timer, bot (Easy/Normal/Hard), Elo rating and matchmaking, quests, upgrades, deck builder, spectating, replays, events protocol |
| AAA interface | `ead6547`, `28879f4`, #21, #22, #24 to #26, #31, #33 to #37 | Design system (theme.css, game-hud.css, fonts, icons, rank emblems), every site page, 3D HUD and menus, classic HUD; polish passes over all three; painted art, ElevenLabs audio, the stadium rebuild, two languages |
| Content and features | #3, #10, #12 to #15, #17, #19, #28 to #30 | Expansion, card packs, seasons, smarter bot, mulligan, emotes and friendly challenges, spells, hero power choice, class cards, art pass, class retune, season results |
| Operations | #4 to #7, #9, #18, #23, #30 | Card statistics, observability, encrypted keys, backups, browser tests in CI, persistent games |

Numbers today: 59 cards (12 spells, 8 class cards), 20 abilities, 4 classes with 8 hero powers, 12 migrations
(`InitialCreate`, `RestoreHuyCard`, `GameplayOverhaul`, `ExpansionCardSet`, `Seasons`, `Spells`, `HeroChoice`,
`RunningGames`, `ClassRetune`, `GameLogTextKeys`, `PaintedPortraits`, `GlickoRatings`), 192 .NET tests, 2 languages.

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
2. **.NET tests** (needs Docker for PostgreSQL): `dotnet test --project tests/Souls.Tests`. Expect 192 passing.
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
| Localization (`LocalizationTests`, `ui_capture.js <lang>`, `l10n_games.js`) | Every key in English and Norwegian, every server text sent with a key; no English left in the Norwegian site or games (desktop and phone) | After #36 |
| Sound (instrumented runs of `rules3d.js`, `spells.js`, `classic_ui.js`) | Every sound decodes and plays at its event in both clients, no 404s; loudness-normalized (effects −16 LUFS, music −20 LUFS). Not listened to on real speakers | After #33 |
| Stadium (`rules3d.js` on WebGL 2 and WebGPU, `portrait.js`, `spells.js`) | Pass; 90 draw calls per frame (was 98), CPU the same or lower; no orbit position hides the board | After #37 |
| Website pages, desktop and phone (`ui_capture.js`) | No console errors, no page scrolls sideways, no image or sound 404s; covers the new pages | After #37 |
| Balance (three runs of 10 000 bot games) | Classes 48.0-51.2 %, worst matchup 42-45 %, hero powers 45.7-54.3 % against the class's other power, races 50.2-52.6 %, first player 48.4-48.6 %, 24.7 turns. Expensive cards read 55-60 % drawn win rate but 50-54 % counted over every game of a deck that holds them | After #29 |
| Upgrade from the previous release | Players registered on the old version all have 20-card decks after the migrations | Test database, P0-3 check |
| Kubernetes | Deployed locally on kind with ingress-nginx; smoke test passes | P0-3 check |
| Desktop GPU frame rate | RTX 3090, 1080p: 57-60 fps with vsync (WebGL renderer, #11). At 4x CPU throttle the WebGPU build (#20) costs about 15 % more CPU per frame than the WebGL renderer it replaced | After #20 |
| Real devices (phones, tablets, Safari, Firefox, Windows/macOS Chrome) | **Not tested.** Only Playwright emulation | - |
| Migration on a copy of real production data | **Not done.** No production data was available | - |

## 7. Known issues and risks

**Gameplay and balance**
- Classes are balanced overall (48-51 %), but not every class and deck race (`docs/balance.md`, "Classes and deck
  races"): the healing races (Vampiric, Lightbringer) suit frail, hard-hitting heroes and the damage races suit
  armoured ones, so Harrison wins about 70 % with Lightbringer or Vampiric decks and 36 % with Darkness or Ferocious.
  Every bot-driven fix tried (Harrison 4 attack, blessing and lifesteal cuts, death curse cuts, Ferocious card nerfs)
  moved the problem to another class or lengthened games past 25 turns. Decided: keep it, watch real games.
- The balance comes from the bot playing itself, not from people. The "Card statistics" admin page shows real win
  rates once people play.

**Art and sound**
- Every card, hero, the shop mascots and the classic backdrop are painted with OpenAI image generation (Codex, the
  owner's account); OpenAI's terms give the output's rights to the user, but AI images may get little copyright
  protection. The prompts are in `tools/card-art/prompts.json`; the 2014 originals (third-party images) are kept in
  `original-2014/` folders and are not used.
- The sounds, music and hero voices are generated with ElevenLabs. Commercial use needs a paid ElevenLabs plan at the
  time of generation; check the account's plan before selling the game (`Content/Sound/CREDITS.md`,
  `Content/Sound/Voice/CREDITS.md`).
- The lost original cards (Paul and others) cannot be restored without an old persoft.no backup.

**Clients**
- WebGPU is tested on Chromium with an NVIDIA GPU only. On one Linux setup (ANGLE on GL, WebGPU on Vulkan) canvas
  textures came out blank; `willReadFrequently` canvases fix it there, not yet confirmed on other machines.
- The classic client asks you to turn a phone held upright; the 3D client plays upright.
- On hardware GL a few classic frames in several thousand are still drawn without the arena (below Pixi; the
  multisampled buffer is off, the stage colour hides it; the browser test allows 1 in 1000).
- The new stadium's fragment shaders are heavier than before; CPU cost is the same or lower, GPU cost still needs a
  real mid-range phone.
- Card names, player names and news posts are not translated; games stored before #36 show their log in English.

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
2. ~~Deploy~~: **Done** (1 November): <https://souls.perception.no>, on the owner's k3s cluster through Flux
   (per-arne-agent `infrastructure/souls-demo`, digest-pinned images). The backup before it was waived by the owner.
   *Still to do by the owner*: log in and play a practice game there.

### P1: confidence and quality

3. **Real devices**: test on an iPhone, an Android phone, Safari and Firefox (frame rate, touch, sound, WebGPU and
   its fallback, safe areas).
4. **Play-test with people** for a week, then compare the "Card statistics" admin page (#5) with `docs/balance.md`.
5. **Class × race balance**: decide with real games ("Card statistics" admin page). Ideas with data in
   `docs/balance.md` and the session's experiments: heals that scale with the hero's health, Harrison 4/27 with
   race passive cuts.
6. ~~Browser tests in CI~~ (#18), ~~class retune~~ (#29), ~~AAA polish~~ (#21, #22, #24 to #26, #31),
   ~~art pass~~ (#28): **Done**.

### P2: content and features

7. ~~Card packs~~ (#10), ~~Spells~~ (#17), ~~More hero choice~~ (#19), ~~Mulligan~~ (#14), ~~Seasons~~ (#12, end
   screen #30), ~~Smarter Hard bot~~ (#13), ~~Emotes and friendly challenges~~ (#15, no rewards #30): **Done**.
8. **Lost original cards**: only with an old persoft.no backup.
9. **Ranked bots** ([ranked-bots.md](ranked-bots.md)): AI opponents of the right strength when no player is waiting,
   disclosed to players. Phase 1, Glicko-2 ratings, is in progress.

### P3: platform and operations

10. ~~Persistent games~~ (#23, #30), ~~encrypted Data Protection keys~~ (#7), ~~observability~~ (#6, opt-in in
    production), ~~backups~~ (#9): **Done**.
11. **More than one game server replica**: not planned (see section 7); the design is in the README.
12. **Import the legacy MySQL data** if the old database turns up.

## 9. Decisions taken (31 October)

The owner delegated the open decisions:

- **Class balance**: retuned with the simulator (#29). The class × race spread is kept and shown in the balance
  report (#32) until real games say more.
- **Art**: keep the 2014 originals; improve the generated portraits (#28) instead of commissioning art.
- **Classic client**: keep it as it is (polished, tested); no port to a current PixiJS.
- **Friendly games**: no coins, quests, rating or season points (#30).
- **Game server replicas**: one, with restart survival.
- **Lost cards**: not searched further.
- **AAA round (1 November)**: painted art for every card and hero with Codex, the 2014 images archived; sound and
  music with ElevenLabs; the stadium rebuilt procedurally (no bought assets); Norwegian Bokmål as the second language.

Still open, because they need the owner's accounts or hardware:

- **Data Protection certificate** for the demo, and turning observability on there.
- **ElevenLabs plan**: check that the account was on a paid plan when the sounds and voices were generated, before
  selling the game.

## 10. Picking the work up in a new session

2. Clone and stay on `main`.
3. Install the .NET 10 SDK and Docker; run `dotnet test --project tests/Souls.Tests` (192 tests).
4. `./deploy/compose/init-secrets.sh` and `docker compose up -d --build`; open <https://localhost>.
5. For browser tests: `cd tests/e2e && npm ci`, then the commands in its README.
6. Read sections 6 to 9 above and start at the first item that is not done.
