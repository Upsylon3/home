# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/); versioning
follows [SemVer](https://semver.org/) as described in `VERSIONING.md`.

> **A note on the history below `0.1.0`:** there was no git repository
> before this pass, so nothing before `0.1.0` has real commit history —
> it's reconstructed, as accurately as the surviving docs allow, from
> `ARCHITECTURE.md`, `SERVICES.md`, and `ROADMAP.md`'s own "checked
> directly against the repo" passes. Treat it as a summary, not a ledger.

## [Unreleased]

### Known unmerged work (see `VERSIONING.md`'s "Reconciling the branches")
- The 9-icon SVG set + wordmark + `AppIcon.jsx`, built in a separate
  session, is **not in this checkout**. `homecore/seed.js` still points at
  icon paths (`/icons/homecloud.svg` etc.) that don't resolve to real
  files here.
- HomeSync Android's `data/` package (`SessionManager`, `SettingsStore`,
  `ApiClient`/`HomeSyncApi`, `AppDatabase`, `SyncedMediaDao`,
  `SyncedMediaEntity`), also built in a separate session, is **not in this
  checkout**. The Android app still will not build without it.

### Planned
- Real separation of HomeCore (identity/sessions/permissions/registry)
  from HomeCloud (files/folders/sharing) into two independent services —
  see `MIGRATION_PLAN.md`.

## [0.1.0] — first tracked checkpoint (this pass)

The point where version control starts. Everything below was true of the
tiered-refactor export handed off for this pass; the fixes are new in
this commit.

### Added
- `VERSIONING.md` — semver + branching policy.
- `CHANGELOG.md` — this file.
- `MIGRATION_PLAN.md` — concrete plan for the real HomeCore/HomeCloud
  split.
- Root `package.json` — npm workspaces tying `homecore/` and every
  Node-based `apps/*` service together for one-command install/test.
- A real git repository, with this as its first commit, tagged `v0.1.0`.

### Fixed
- **`docker-compose.yml` had no pinned project `name:`.** Compose was
  deriving the project name from the checkout folder's name, which means
  the actual Docker volume (`<project-name>_homecloud_data`) could
  silently change across re-extracted zips — a real data-loss risk, not a
  cosmetic issue. Pinned to `name: home`.
- **`.gitignore` still referenced pre-rename paths** (`backend/.env`,
  `backend/data/`) that no longer exist now that the directory is
  `homecore/`. Updated to match the actual tree, and extended to cover
  `homecore/.env` / `homecore/data/` so secrets and local SQLite data
  can't accidentally be committed now that there's a real repo to commit
  to.
- **`homecore/seed.js`'s fallback URLs for HomeMedia/HomeSync/HomeNotes/
  HomeCloud's own registry entries were still the pre-gateway four-port
  scheme** (`localhost:8080`/`8082`/`8083`/`8084`) even though
  `docker-compose.yml` already overrides them with path-shaped values
  (`/cloud`, `/media`, etc.) matching the single-port gateway. Fixed the
  fallbacks to be path-shaped too, so a non-Docker `npm run dev` inside
  `homecore/` produces correct Launch links instead of pointing at ports
  nothing publishes anymore.
- **`homecore/package.json`'s `name` field was still `"homecloud-backend"`**
  despite the directory being renamed to `homecore/` — misleading to
  anyone reading it fresh. Renamed to `"homecore"`, with its description
  stating plainly that it's still running both HomeCore and HomeCloud's
  file-storage logic in one process (see Known Issues below).
- Root `README.md`'s title and opening section still described the whole
  project as "homecloud, a tiny Dropbox clone" — accurate when it was
  literally the whole project, stale now that Home is the ecosystem and
  HomeCloud is one app inside it. Retitled and reframed the opening;
  left the deep-dive technical content (auth, JWT, 2FA, etc.) as-is,
  since it's still accurate description of what's currently in
  `homecore/`. Also corrected the doc's own "Tiered architecture" closing
  section, which claimed the HomeCore/HomeCloud split was further along
  than it actually is.

### Known issues (not fixed in this pass, tracked in `MIGRATION_PLAN.md`)
- `homecore/` is a folder rename, not an architectural split — it still
  contains HomeCloud's file/folder/admin/activity routes in the same
  process and database as real HomeCore code.
- The icon system and HomeSync Android's `data/` package are missing from
  this checkout entirely (see Unreleased above) — not regressions, just
  never-merged work from other sessions.
- HomeCore's permission system is still declarative only (per
  `SECURITY.md`) — nothing enforces a declared permission before granting
  cross-app access.

## Before [0.1.0] — reconstructed summary, no real commit history

- HomeCloud built and stabilized: accounts, bcrypt, JWT + token-version
  revocation, roles, quotas, soft-delete trash, share links, 2FA, admin
  panel, activity log, folders. Backend test suite grown to 63 passing.
- HomeCore introduced, embedded in HomeCloud's backend process: identity
  extras, application registry, permissions catalog, event bus, health,
  notifications.
- HomeMedia built as a genuinely separate service (own backend, own
  small SQLite DB, no photo storage of its own) — 18 backend tests
  passing.
- HomeSync built the same way: backend done and tested (20 tests
  passing); Android app started but incomplete (missing `data/` package
  as of this checkpoint — see Unreleased above).
- The gateway was introduced (single origin, shared login), then
  **dropped entirely** during a period of parallel-session work on
  different apps, then restored — the incident that directly motivated
  the Tier 0/1/2 layering rule in `ARCHITECTURE.md` §4.
- This pass: repository restructured into `gateway/`, `homecore/`,
  `apps/*`, `services/backup/`; HomeNotes built as a fourth Tier 1 app
  (backend + frontend + tests) — not yet reflected in `SERVICES.md`/
  `ROADMAP.md`, which still describe it as "not started."
