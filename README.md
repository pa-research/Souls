# Souls Online

A multiplayer browser card game: build a deck, queue for a match against another player or the practice bot,
and fight it out in the arena with in-game chat, either in the original 2D client (PixiJS) or in the
"Modern 3D" client (three.js). Originally written in 2014 on ASP.NET MVC 5,
websocket-sharp, NHibernate and MySQL; this branch ports it to **.NET 10 (LTS)** with production-ready
container, Docker Compose and Kubernetes (Kustomize) deployments.

```
 Browser ──HTTPS──▶ reverse proxy / ingress ─┬─ /ws/*  ──▶ souls-server  (game + chat + admin WebSockets)
                                             └─ /*     ──▶ souls-web     (site, login, shop, admin, game client)
                                                                │                  │
                                                                └──── PostgreSQL ◀─┘
```

Both services share the database and the ASP.NET Core Data Protection key ring, so the login cookie issued
by the web app authenticates the WebSockets on the game server (same origin, no tokens in JavaScript).

## What changed

| | Before | Now |
|---|---|---|
| Runtime | .NET Framework 4.5, IIS | .NET 10, ASP.NET Core, Kestrel, distroless non-root containers |
| Web | ASP.NET MVC 5 + Web API 2 | ASP.NET Core MVC (Razor), Bootstrap 5.3, jQuery 4, jQuery UI 1.14 |
| Game server | console app, websocket-sharp (vendored DLL) | ASP.NET Core WebSockets, same JSON protocol |
| Data | NHibernate 3.3, MySQL, schema auto-update | EF Core 10, PostgreSQL 18, EF migrations |
| Practice bot | separate WebSocket client logging in with the shared hash `BOT` | in-process client, cannot be impersonated |
| Tests | 1 empty test project | 62 unit + integration tests (xUnit v3, Testcontainers PostgreSQL) |
| Deploy | `start.bat` | Dockerfile, `compose.yaml` + Caddy (automatic TLS), Kustomize base/components/overlays, GitHub Actions |

Database tables keep their original names; the seed data (cards, races, classes, abilities, bot names, log
types) comes from the 2015 dump with its broken test rows fixed (negative card stats, too few starter cards,
ability ids that did not match the engine).

## Game clients: Classic and Modern 3D

The game page has a **Classic | Modern 3D** switch (top right). The choice is remembered per browser, can be
forced with `/Game?mode=classic` or `/Game?mode=3d`, and defaults to 3D when the browser supports WebGL 2.

- **Classic** is the original 2014 PixiJS client.
- **Modern 3D** (`wwwroot/Scripts/Game3D`, three.js r186, ES modules, no build step) keeps the classic card
  artwork, hero frames, hand/slot layout and controls (hover a hand card to zoom it, drag it onto a slot to play
  it, left-drag from your card or hero to attack, right-drag from a card to use its ability, click End Turn),
  and adds camera views (buttons top left, or keys 1-4):
  - **Classic**: the original top-down arena picture, 1:1 with the classic client.
  - **Arena**, **Field**, **Cinematic**: a 3D stadium rises out of the ground around the sand, with terraces
    full of spectators who jump, roar and do the Mexican wave, the two "Souls" pillars with stadium screens
    (the SOULS logo, a live score ticker and flashes for hits, KOs and the result), tunnel gates, torch-lit
    gate towers, floodlights, flags and a dusk sky. Board cards stand up to face you in the low views; heroes
    move onto podiums.

  Hand cards and the End Turn sign are a HUD, so they stay where the classic client has them in every view.
  Matches open with a VS splash, heroes entering in columns of light, flame jets and fireworks; big hits punch
  the camera and send shockwaves across the sand; a victory ends in a fireworks finale. Bloom makes fire,
  rings, screens and effects glow, and the crowd ambience and fireworks are synthesized with Web Audio (they
  follow the sound toggle).

  Controls:

  | | Mouse | Touch |
  |---|---|---|
  | Look at a hand card | hover it | tap it (tap again or tap the arena to close), or hold it |
  | Play a card | drag it onto a free slot | drag it onto a free slot |
  | Attack | drag from your card or hero to an enemy | the same |
  | Use a card's ability | right-drag from the card to a friendly card or hero | hold the card until it glows green, then drag |
  | Rotate the camera | right- or middle-drag on the arena | drag the arena with one finger, or two fingers |
  | Zoom | mouse wheel | pinch |
  | Camera views | buttons top left, or keys 1-4 | buttons |

  Graphics quality adapts to the device (software rendering: no bloom and a thinner crowd; phones and tablets:
  a lighter stadium). `?fx=low|medium|high` overrides it.

Both clients speak the same WebSocket protocol, so a classic player and a 3D player can play each other.
Switching clients in the middle of a match reloads the page and resumes the running game (the server
re-sends the game state when a player reconnects within the grace period).

## Security fixes

The original application had several critical issues. Fixed in this port:

- **Every new account was an administrator** (registration assigned permission id 1, `Admin`). New players now
  get `Player`; the first administrator is created from configuration (`Souls:Admin:*`).
- **Any logged-in player could ban, kick and reset anyone** through the admin WebSocket, and anyone could log in
  to the game server as the bot by sending the hash `BOT`. WebSockets are now authenticated with the login
  cookie, `/ws/admin` requires the Admin role, and the bot no longer has a login.
- **Session hijacking**: the session "hash" was `sha256(timestamp + id + ip)` and exposed cross-origin through a
  JSONP endpoint. Sessions now use a random 256-bit token inside an encrypted, HttpOnly, `SameSite`,
  `__Host-` cookie; only its hash is stored, and logout/ban revoke it for the web app and game server.
- **Unsalted SHA-256 passwords** → PBKDF2-SHA512 (210,000 iterations). Legacy hashes are accepted once and
  re-hashed on login. Minimum length 8, login/registration rate limiting, no user enumeration.
- **XSS**: chat messages, player names and news were inserted into the page as HTML. Chat and names are now
  rendered as text, news HTML is sanitized (HtmlSanitizer), usernames are restricted to `[A-Za-z0-9_-]`, and a
  strict Content-Security-Policy (`script-src 'self'`, no inline scripts) is sent on every page.
- **Arbitrary file read/write** in the card editor (it copied a client-supplied path into the web root) and
  unvalidated uploads. Uploads are now limited to 1 MB PNG/JPEG/GIF detected from content, stored in the
  database, served with `nosniff` and a sandbox CSP; portraits must be a built-in or uploaded image.
- **CSRF**: state changes used GET links (logout, buy, delete news, sample users). All are POST with
  antiforgery tokens now; the admin "create 200 sample users with password `password`" button was removed.
- **Cross-site WebSocket hijacking**: the game server checks the `Origin` of every handshake.
- **Denial of service / crashes**: unvalidated `int.Parse` on client input, unsynchronized shared state across
  threads, unbounded rooms and messages. Messages are parsed defensively, size- and rate-limited, and all game
  state changes are serialized.
- **Game cheats**: the client chose which ability a card used and could play cards into any slot. The server
  now uses the card's own ability and validates slots, turns and mana.
- **Old front-end libraries with known CVEs** (jQuery 1.11, jQuery UI 1.10, Bootstrap 3.1, CKEditor 4.4,
  RequireJS 2.1) were replaced or removed.
- Hardened deployment: non-root distroless images, read-only root file systems, all capabilities dropped,
  `restricted` Pod Security Standard, default-deny NetworkPolicies, secrets mounted as files, TLS at the edge,
  HSTS, trusted-proxy configuration for `X-Forwarded-*`.

> **Rotate the old credentials.** The previous code committed database passwords
> (`SoulsServer/App.config`, `SoulsModel/NHibernateHelper.cs`), a GitHub access token
> (`SoulsClient/Views/Shared/Partials/Github.cshtml`) and password hashes of test accounts
> (`souls.13.09.15.working.sql`). They are removed from the tree but remain in the git history. Revoke the
> token and change those passwords if they are still in use anywhere; consider rewriting history if the
> repository is public.

## Run with Docker Compose

Requires Docker with Compose v2.

```bash
./deploy/compose/init-secrets.sh
```

```bash
docker compose up -d --build
```

Open <https://localhost> (Caddy issues a certificate from its local CA, so the browser shows a warning the
first time). Log in as `admin` with the password printed by `init-secrets.sh`
(also in `deploy/compose/secrets/Souls__Admin__Password`), or register a player and press **Play Now!**.

Settings go in a `.env` file next to `compose.yaml`:

| Variable | Default | |
|---|---|---|
| `SOULS_DOMAIN` | `localhost` | Public host name. A real domain gets a Let's Encrypt certificate. |
| `CADDY_GLOBAL_OPTIONS` | | e.g. `email you@example.com` for ACME. |
| `SOULS_HTTP_PORT` / `SOULS_HTTPS_PORT` | `80` / `443` | Published ports. |
| `SOULS_ADMIN_USERNAME` | `admin` | Bootstrap administrator. |
| `SOULS_GITHUB_REPOSITORY` | | Show recent commits of `owner/repo` on the home page. |
| `SOULS_WEB_IMAGE` / `SOULS_SERVER_IMAGE` | `souls-web:latest` / `souls-server:latest` | Use published images instead of building. |

Only Caddy publishes ports. The web app and game server sit on internal networks without internet access, and
PostgreSQL is only reachable from them. A one-shot `migrate` container applies the database migrations before
the apps start.

## Run on Kubernetes (Kustomize)

```
deploy/k8s/
├── base/                 web + game server Deployments, Services, PDB, NetworkPolicies, config, namespace
├── components/
│   ├── postgres/         single-instance PostgreSQL StatefulSet (dev / small installs)
│   ├── ingress/          Ingress: /ws → game server, / → web
│   └── gateway-api/      HTTPRoute for a Gateway API implementation
└── overlays/
    ├── dev/              in-cluster PostgreSQL + Ingress on http://souls.localtest.me, locally built images
    └── production/       managed PostgreSQL, Gateway API, HPA, pinned image tags
```

Local cluster (kind, k3d, minikube, Docker Desktop) with an ingress controller in the `ingress-nginx`
namespace:

```bash
docker build --target web -t souls-web:local .
```

```bash
docker build --target server -t souls-server:local .
```

```bash
kind load docker-image souls-web:local souls-server:local
```

```bash
./deploy/k8s/overlays/dev/init-secrets.sh && kubectl apply -k deploy/k8s/overlays/dev
```

Then open <http://souls.localtest.me> (resolves to 127.0.0.1; adjust for your ingress port).

For production, copy `overlays/production`, set the host name, Gateway reference, image tags and the
ingress/gateway namespace in the NetworkPolicy patch, and create `secrets.env` from `secrets.env.example`
(it is git-ignored; use your secret manager / Sealed Secrets / External Secrets in real deployments).

Notes:

- Each pod runs `migrate` as an init container; EF Core locks the database while migrating, so concurrent
  rollouts are safe.
- **The game server must run as a single replica** (running games live in memory); it uses the `Recreate`
  strategy. The web tier scales horizontally.
- NetworkPolicies need a CNI that enforces them (Calico, Cilium, recent kindnet, ...). If your ingress
  controller lives in another namespace than `ingress-nginx`, patch `allow-http-from-ingress`.
- Behind a TLS-terminating ingress the apps trust `X-Forwarded-*` from the private address ranges
  (`Souls__TrustedProxyNetworks`); the NetworkPolicy ensures only the ingress controller can reach them.

## Development

Requires the .NET 10 SDK and Docker (for PostgreSQL and the integration tests).

```bash
docker run -d --name souls-pg -e POSTGRES_USER=souls -e POSTGRES_PASSWORD=souls -e POSTGRES_DB=souls -p 5432:5432 postgres:18-alpine
```

```bash
Souls__Admin__Username=admin Souls__Admin__Password='change-me-please' dotnet run --project src/Souls.Web -- migrate
```

```bash
dotnet run --project src/Souls.Server
```

```bash
dotnet run --project src/Souls.Web
```

The site runs on <http://localhost:5080> and the game server on <http://localhost:5081>
(`appsettings.Development.json` wires them together).

```bash
dotnet test --project tests/Souls.Tests
```

New migration after changing the model:

```bash
dotnet tool restore && dotnet ef migrations add <Name> --project src/Souls.Model --startup-project src/Souls.Model
```

### Projects

| Project | |
|---|---|
| `src/Souls.Model` | EF Core model, migrations, seed data, password hashing, sessions, shared hosting setup |
| `src/Souls.Web` | MVC site, Razor views, static assets, the classic PixiJS game client (`wwwroot/Scripts/Game`) and the three.js client (`wwwroot/Scripts/Game3D`) |
| `src/Souls.Server` | Game engine, chat, admin service, practice bot, WebSocket endpoints |
| `tests/Souls.Tests` | Unit tests and integration tests that host both apps against PostgreSQL |

Both applications also accept two commands, used by the containers:
`migrate` (apply migrations and seed data, then exit) and `healthcheck` (probe `/healthz/live`).
Health endpoints: `/healthz/live` and `/healthz/ready` (includes the database).

## Configuration

Settings come from `appsettings.json`, environment variables (`Section__Key`) and secret files in
`/run/secrets/souls` (one file per setting, named like the environment variable; override the directory
with `SOULS_SECRETS_PATH`).

| Setting | App | |
|---|---|---|
| `ConnectionStrings__Souls` | both | PostgreSQL connection string (**secret**). |
| `Souls__Admin__Username` / `Souls__Admin__Password` | migrate | Creates (or promotes) the bootstrap administrator (**password is secret**). |
| `Souls__SecureCookies` | both | Defaults to `true` outside Development. Only disable for plain-HTTP local setups. |
| `Souls__TrustedProxyNetworks` | both | CIDRs allowed to set `X-Forwarded-*` (your reverse proxy / ingress). |
| `Souls__GameServerUrl` | web | WebSocket base the game client uses. `/ws` = same origin (recommended). |
| `Souls__GameServerHealthUrl` | web | Game server health URL for the status box on the home page. |
| `Souls__GitHubRepository` | web | `owner/repo` for the "Souls Updates" feed (fetched by the browser). |
| `Souls__RateLimits__AuthPerMinute` / `UploadsPerMinute` | web | Per-IP limits (defaults 10 / 20). |
| `Souls__AllowedOrigins` | server | Extra allowed WebSocket origins. Empty = same origin only. |
| `Souls__Matchmaker__ReconnectGracePeriod` | server | How long a disconnected player may reconnect before forfeiting (default 1 min). |
| `Souls__Bot__ThinkDelay` / `AttackDelay` | server | Pacing of the practice bot. |

## Known limitations

- The game server keeps games in memory: one replica, and a restart ends running games.
- The Data Protection key ring is stored unencrypted in the database. Anyone with read access to the database
  could forge login cookies; protect database access accordingly or add `ProtectKeysWith*`.
- The classic client still uses its original 2014 libraries (PixiJS 1.x, CreateJS 0.x). They have no known
  vulnerabilities and run with a strict CSP; the Modern 3D client is the up-to-date alternative.
- The legacy MySQL data is not imported automatically. Old accounts can be copied into the `player` table;
  their SHA-256 password hashes are accepted and upgraded on first login.
