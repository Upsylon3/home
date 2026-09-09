# Home

A self-hosted personal/family cloud ecosystem: a small set of independent
web apps (file storage, photos, notes, phone backup) that share one
login, one gateway, and one identity service, instead of each
reinventing accounts and permissions on its own.

Everything runs on hardware you own. No third-party cloud dependency —
internet access is optional, used only for remote access or updates if
you choose to set that up.

## What's here

| App | What it does | Status |
|---|---|---|
| **Home** | The dashboard/launcher — what's available, what happened recently | Built |
| **HomeCloud** | File storage: folders, sharing, Trash, 2FA, admin panel | Built |
| **HomeMedia** | Photo/video library — albums, favorites, EXIF, no storage of its own | Built |
| **HomeNotes** | A Markdown notes workspace | Built |
| **HomeSync** | Android app that backs up phone photos/videos to HomeCloud | Backend built and tested; Android app not yet build-verified — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| **HomeVault** | Client-side-encrypted password/secrets manager | **v0 built, not yet security-reviewed** — see [docs/SECURITY.md](docs/SECURITY.md) before storing anything real |
| **HomeCore** | Shared identity, sessions, permissions, and the app registry — no UI of its own | Built |
| HomeTasks, HomeMonitor, HomeAI | To-dos, system monitor, assistant | Not started — see [docs/ROADMAP.md](docs/ROADMAP.md) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these fit
together, and [docs/SECURITY.md](docs/SECURITY.md) for what's protecting
them today and what isn't yet.

## Quick start (Docker)

Requires [Docker](https://www.docker.com/) with Compose.

```bash
cp homecore/.env.example homecore/.env
cp apps/homecloud-backend/.env.example apps/homecloud-backend/.env
# Edit both files: set real values for JWT_SECRET and HOMECORE_INTERNAL_SECRET
# (the same HOMECORE_INTERNAL_SECRET value in both files — see the comments
# in each file). Generate one with: openssl rand -hex 32

docker compose up --build -d
```

Open `http://localhost:8080`. The first account you register becomes the
admin. HomeCloud lives at `/cloud`, HomeMedia at `/media`, HomeNotes at
`/notes` — all behind that same address and login.

For running services individually without Docker, the Android app, and
everything else involved in working on this codebase, see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). For a from-scratch production
deployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Project layout

```
HOME_MASTER_SPECIFICATION.md   The governing product/architecture spec — see Documentation below
HOME_ARTISTIC_DIRECTION.md     The governing visual/UX spec
gateway/              nginx — the single public entry point (see docs/ARCHITECTURE.md)
homecore/             Identity, sessions, permissions, the app registry — shared by every app
packages/
  homecore-client/    Shared client every other backend uses to verify a request with HomeCore
apps/
  home/               Dashboard frontend
  homecloud/           HomeCloud frontend
  homecloud-backend/   HomeCloud backend — files, folders, sharing
  homemedia/           HomeMedia frontend
  homemedia-backend/   HomeMedia backend
  homenotes/           HomeNotes frontend
  homenotes-backend/   HomeNotes backend
  homesync-backend/    HomeSync backend — the API the Android app talks to
  homesync-android/    The Android app itself (Kotlin)
  homevault/           HomeVault frontend — the only app whose code ever sees a plaintext secret
  homevault-backend/   HomeVault backend — stores only ciphertext, never a key
services/backup/       Nightly backup of every app's data volume
design/                Icon set + wordmark, shared across every frontend
scripts/               Windows dev launcher (see docs/DEVELOPMENT.md)
docs/                  Architecture, security, API reference, deployment, roadmap
```

## Tech stack

- **Backend:** Node.js, Express, SQLite (`better-sqlite3`), Node's
  built-in test runner (`node --test`)
- **Frontend:** React, Vite, React Router
- **Client-side cryptography (HomeVault only):** the browser's native
  Web Crypto API (AES-256-GCM) plus `hash-wasm` for Argon2id — see
  [docs/SECURITY.md](docs/SECURITY.md)
- **Infrastructure:** Docker Compose, nginx
- **Android:** Kotlin, WorkManager, Room

## Tests

190 automated tests across 6 services, run with `npm test` from the
repo root (or inside any one service's own folder):

```
homecore                44 tests
apps/homecloud-backend  39 tests
apps/homemedia-backend  18 tests
apps/homenotes-backend  24 tests
apps/homesync-backend   20 tests
apps/homevault-backend  27 tests
apps/homevault          18 tests  (src/crypto.js — the one frontend with real tests)
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how to run them and
what each layer covers.

## Documentation

- [HOME_MASTER_SPECIFICATION.md](HOME_MASTER_SPECIFICATION.md) —
  the original product/architecture/API/security/roadmap brief. Takes
  priority over everything below where they disagree; implementation
  can flex, this can't without a deliberate decision to change it.
- [HOME_ARTISTIC_DIRECTION.md](HOME_ARTISTIC_DIRECTION.md) — the
  original visual/UX brief `docs/DESIGN_SYSTEM.md` is condensed from.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the apps fit
  together, and the rules for adding a new one
- [docs/API.md](docs/API.md) — every HTTP endpoint, by service
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — running this locally,
  code layout, testing
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — a from-scratch production
  setup, backups, upgrading
- [docs/SECURITY.md](docs/SECURITY.md) — what's protecting this today,
  and HomeVault's (not yet built) threat model
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — visual direction,
  for anyone designing a new screen
- [docs/ROADMAP.md](docs/ROADMAP.md) — what's next
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose a change
- [CHANGELOG.md](CHANGELOG.md) — what changed, by version

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE). This is a
deliberately conservative default, chosen to be easy to relax later
(open source, or a different license) rather than hard to undo.
