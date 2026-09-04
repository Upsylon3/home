# Development

## Prerequisites

- Node.js 20+ and npm
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

# Frontends — each is independent, run whichever you're working on
cd apps/home && npm run dev        # :5174
cd apps/homecloud && npm run dev   # :5173
cd apps/homemedia && npm run dev   # :5175
cd apps/homenotes && npm run dev   # :5176
```

Visit whichever frontend's port you started. `homemedia-backend`,
`homenotes-backend`, and `homesync-backend` all default
`HOMECORE_INTERNAL_URL`/`HOMECLOUD_BACKEND_INTERNAL_URL` to Docker-network
hostnames that only resolve inside Compose — the inline env vars above
override that for local dev.

Nothing here is backed up automatically outside Docker — see
[DEPLOYMENT.md](DEPLOYMENT.md) §Backups for the real mechanism.

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
cd homecore && npm test                    # 44 tests
cd apps/homecloud-backend && npm test      # 39 tests
cd apps/homemedia-backend && npm test      # 18 tests
cd apps/homenotes-backend && npm test      # 24 tests
cd apps/homesync-backend && npm test       # 20 tests
```

All use Node's built-in test runner (`node --test`) — no extra
test-framework dependency. Each test file gets its own fresh, isolated
temp SQLite database, and `node --test` runs each file in its own
process, so tests can't leak state into each other.

If you change a frontend, also run `npm run build` in that app — the
test suites above don't catch a build-time error in a `.jsx` file.

## HomeSync Android

`apps/homesync-android/` has never been built with a real Android
toolchain in the environment this codebase was developed in — there's no
CI or sandbox here with the Android SDK. Static review (imports resolve,
no dangling references) is clean, and the pure-Kotlin sync/hashing logic
(`SyncLogic.kt`, zero Android dependencies) has its own JUnit tests. But
**a first Gradle sync and a real device/emulator run should be the first
thing anyone picking this up does** — treat it as unverified until then,
not as done.

To try it: open `apps/homesync-android/` in Android Studio, let Gradle
sync, connect a device or start an emulator, and hit Run. On the login
screen, enter your gateway's address (e.g. `192.168.1.50:8080`) — not a
separate HomeSync-only port.
