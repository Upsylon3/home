# Development

## Prerequisites

- Node.js 22+ and npm (bumped from 20+ during the [1.1.2] security
  review — Node 20 reached end-of-life on 2026-04-30 and no longer
  receives security patches; see `docs/SECURITY.md`)
- Docker (optional for local dev, required for the full stack — see
  [DEPLOYMENT.md](DEPLOYMENT.md))
- Android Studio, only if working on `apps/homesync-android`

## Install

```bash
npm install
```

This is an npm workspace — one install at the repo root covers every
Node-based service and frontend (`homecore`, everything under `apps/`
except `homesync-android`, and `packages/homecore-client`).

## Running services locally, without Docker

Each backend needs its own `.env` (copy the matching `.env.example`) and
runs on its own fixed port. Each frontend's Vite dev server proxies API
calls to the right backend automatically — see each app's own
`vite.config.js`.

```bash
# HomeCore — identity, sessions, the app registry. Start this first.
cd homecore && cp .env.example .env && npm run dev        # :4000

# HomeCloud's backend — files, folders, sharing
cd apps/homecloud-backend && cp .env.example .env && npm run dev   # :4500

# HomeMedia's backend
cd apps/homemedia-backend && HOMECORE_INTERNAL_URL=http://localhost:4000 \
  HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500 npm run dev # :4200

# HomeNotes' backend
cd apps/homenotes-backend && HOMECORE_INTERNAL_URL=http://localhost:4000 \
  HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500 npm run dev # :4400

# HomeSync's backend
cd apps/homesync-backend && HOMECORE_INTERNAL_URL=http://localhost:4000 \
  HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500 npm run dev # :4300

# HomeVault's backend — notice: no HOMECLOUD_BACKEND_INTERNAL_URL. It's
# the only backend with zero dependency on apps/homecloud-backend.
cd apps/homevault-backend && HOMECORE_INTERNAL_URL=http://localhost:4000 npm run dev # :4600

# Frontends — each is independent, run whichever you're working on
cd apps/home && npm run dev        # :5174
cd apps/homecloud && npm run dev   # :5173
cd apps/homemedia && npm run dev   # :5175
cd apps/homenotes && npm run dev   # :5176
cd apps/homevault && npm run dev   # :5177
```

Visit whichever frontend's port you started. `homemedia-backend`,
`homenotes-backend`, and `homesync-backend` all default
`HOMECORE_INTERNAL_URL`/`HOMECLOUD_BACKEND_INTERNAL_URL` to Docker-network
hostnames that only resolve inside Compose — the inline env vars above
override that for local dev.

Nothing here is backed up automatically outside Docker — see
[DEPLOYMENT.md](DEPLOYMENT.md) §Backups for the real mechanism.

## Windows: one-click launch

Everything in the section above, automated, for Windows specifically:

```bat
scripts\dev-home.bat
```

Opens a small picker UI. Home's own stack (HomeCore, HomeCloud's
backend, Home's dashboard) always starts; HomeCloud's frontend,
HomeMedia, HomeNotes, HomeSync's backend, and HomeVault are optional
checkboxes. Each selected service opens in its own terminal window,
already pointed at the others via the same env vars listed above —
nothing extra to type per-service.

| Service | Port |
|---|---:|
| HomeCore | `4000` |
| HomeCloud backend | `4500` |
| Home dashboard | `5174` |
| HomeCloud frontend *(optional)* | `5173` |
| HomeMedia backend + frontend *(optional)* | `4200` + `5175` |
| HomeNotes backend + frontend *(optional)* | `4400` + `5176` |
| HomeSync backend *(optional — Android app not launched by this)* | `4300` |
| HomeVault backend + frontend *(optional — v0, not yet security-reviewed)* | `4600` + `5177` |

It also creates any missing `.env` files (from each service's
`.env.example`) and data directories on first run, and passes HomeCore
absolute `http://localhost:<port>/` URLs for each app's frontend instead
of the production gateway paths (`/cloud`, `/media`, `/notes`, `/sync`)
— there's no gateway running in this mode, so Home's app cards need to
link straight to each app's own dev server. This is exactly what
`HOMECLOUD_FRONTEND_URL` and friends are for (see
`homecore/.env.example`); nothing about `homecore/src/homecore/seed.js`
needed to change to support it.

The secret this script sets (`JWT_SECRET`, `HOMECORE_INTERNAL_SECRET`)
is a fixed, published dev-only value — fine for a throwaway local
database, **never reuse it for a real deployment**.

Requires Node.js 22+ and npm in `PATH`; runs `npm install` automatically
on first launch if `node_modules` is missing. macOS/Linux: use the
manual commands above instead — this launcher is Windows-only.

## Running with Docker instead

See [DEPLOYMENT.md](DEPLOYMENT.md) — `docker compose up --build -d` runs
the entire stack, including the gateway, with one command. Useful when
you need the full, production-like topology (e.g. testing something that
depends on the gateway's routing) rather than one service in isolation.

## Code layout

```
homecore/src/
  server.js            Entry point — starts Express, OS signal handling
  app.js               The actual Express app (routes/middleware/errors) —
                        split from server.js so tests can boot it without a
                        real port/timer in the way
  db.js                Opens/creates SQLite, migrations, activity logger
  auth.js               register/login/me/change-password/2FA lifecycle
  admin.js              Admin-only account management
  middleware/authMiddleware.js   Verifies JWTs, checks revocation/role
  homecore/             The app registry, permissions, events, notifications,
                        health, system — mounted at /api/core

apps/<name>-backend/src/    Same shape in every backend service:
  server.js             Entry point
  app.js                 Express app, routes, middleware
  db.js                  SQLite schema + queries for that app's own data
  homecloudClient.js      (where relevant) calls into apps/homecloud-backend
                          for real file storage

apps/<name>/src/            Same shape in every frontend:
  main.jsx                Mount point, BrowserRouter
  App.jsx                  Routes, layout
  api.js                   Every backend call funnels through here
  pages/, components/      UI

packages/homecore-client/   Shared by every backend with no identity of
                            its own — verifies a request's token against
                            HomeCore, once, instead of each app
                            reimplementing the same ~40 lines.
```

## Testing

Every application has, or should have, four layers (see each service's
`test/` folder for examples):

- **Unit tests** — business logic, permission checks, validation. Pure
  functions especially (e.g. HomeSync's `pathPlanner.js`) deserve full
  coverage.
- **API tests** — auth, authorization, successful requests, invalid
  input, ownership violations.
- **Integration tests** — real requests against a real, isolated
  upstream service (e.g. HomeMedia's tests boot a real HomeCloud
  instance), not a mock standing in for one.
- **End-to-end tests** — the full user-facing sequence (register → login
  → create folder → upload → view → download → share → delete →
  restore → logout, for the core file flow).

Run everything:

```bash
npm test
```

Or one service at a time:

```bash
cd homecore && npm test                    # 45 tests
cd apps/homecloud-backend && npm test      # 41 tests
cd apps/homemedia-backend && npm test      # 18 tests
cd apps/homenotes-backend && npm test      # 24 tests
cd apps/homesync-backend && npm test       # 20 tests
cd apps/homevault-backend && npm test      # 28 tests
cd apps/homevault && npm test              # 20 tests — crypto.js only, see below
cd apps/homenotes && npm test              # 11 tests — markdown.js only, see below
```

All use Node's built-in test runner (`node --test`) — no extra
test-framework dependency. Each test file gets its own fresh, isolated
temp SQLite database, and `node --test` runs each file in its own
process, so tests can't leak state into each other.

Two frontends have real tests, and both test one small module rather
than the UI. `apps/homevault` tests its client-side encryption
(`src/crypto.js`), and `apps/homenotes` tests its Markdown sanitizer
(`src/markdown.js`, the fix for the stored XSS found in 1.1.1). Both
modules are framework-free on purpose, so `node --test` can run them
directly, the same way it runs HomeSync's `pathPlanner.js`, instead of
reaching them only through rendering UI. `home`, `homecloud` and
`homemedia` have no automated tests yet.

If you change a frontend, also run `npm run build` in that app — the
test suites above don't catch a build-time error in a `.jsx` file.

## HomeSync Android

`apps/homesync-android/` has had exactly one real build attempt so far,
in 1.1.4. Gradle got as far as linking resources and failed because the
app's theme inherits from a style that lives in the classic Material
Components library, which wasn't declared as a dependency. That was
fixed (see `CHANGELOG.md`), and it is the only part of the app that has
been checked against a real Android toolchain. The Gradle, Kotlin and
Compose upgrades made in the same release were reasoned through against
each tool's release notes, not compiled, and the app has never run on a
device or emulator. The pure-Kotlin sync/hashing logic (`SyncLogic.kt`,
zero Android dependencies) has its own JUnit tests.
**A fresh Gradle sync, then a real device/emulator run, should be the
first thing anyone picking this up does** — treat it as unverified until
then, not as done.

To try it: open `apps/homesync-android/` in Android Studio, let Gradle
sync, connect a device or start an emulator, and hit Run. On the login
screen, enter your gateway's address (e.g. `192.168.1.50:8080`) — not a
separate HomeSync-only port.
