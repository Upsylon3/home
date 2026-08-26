# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/); versioning
follows [SemVer](https://semver.org/) as described in `VERSIONING.md`.

> **A note on the history below `0.1.0`:** there was no git repository
> before this pass, so nothing before `0.1.0` has real commit history —
> it's reconstructed, as accurately as the surviving docs allow, from
> `docs/ARCHITECTURE.md`, `docs/SERVICES.md`, and `docs/ROADMAP.md`'s own "checked
> directly against the repo" passes. Treat it as a summary, not a ledger.

## [Unreleased]

### Correction to this file (2026-08-24)
The "Known unmerged work" entry originally here assumed the icon-set and
HomeSync-Android-data-layer code from earlier sessions could still be
pasted in later. That code is confirmed lost — it only ever existed
inside past chat sessions and was never saved anywhere retrievable. What
survives is the *specification* of both, in the doc set folded into this
repo below (`docs/`): `docs/DESIGN_SYSTEM.md`'s "Icon system" section
describes the icon language precisely enough to regenerate it, and
`docs/SERVICES.md`'s HomeSync section lists the exact missing Kotlin
classes and what each one needs to do. Both are tracked as ordinary
backlog items in `docs/ROADMAP.md` (#1 and #3) — rebuilt from spec, not
recovered.

### Planned
- Real separation of HomeCore (identity/sessions/permissions/registry)
  from HomeCloud (files/folders/sharing) into two independent services —
  see `MIGRATION_PLAN.md`.

## [0.4.0] — Phase 0 of `MIGRATION_PLAN.md`: shared `packages/homecore-client`

### Fixed (landed first, its own commit, before touching anything else)
- `test/helpers/{app,client}.js` in `homemedia-backend`, `homesync-backend`,
  and `homenotes-backend` all still required `../../../backend/...` — the
  pre-rename path, broken since `backend/` became `homecore/` and these
  three moved under `apps/`. Confirmed broken first (`MODULE_NOT_FOUND`,
  reproduced directly), then fixed, then re-ran every affected suite:
  `homecore` 64/64, `homemedia-backend` 18/18, `homesync-backend` 20/20,
  `homenotes-backend` 24/24 (this last count wasn't previously documented
  anywhere). Exactly the "carefully written, never actually run" failure
  mode this project's docs already warn about — here in test
  infrastructure rather than app code.

### Added
- `packages/homecore-client/` (`@home/homecore-client`) — `verifyUser()`
  (ask HomeCore's `/api/auth/me`, cache 5s) and the `requireAuth` Express
  middleware wrapping it, extracted from three copies that were confirmed
  — by diffing pairwise, not assumed — identical only in that one ~40-line
  block. Each app's own `homecloudClient.js` still holds its genuinely
  different app-specific calls (`listFiles`, `uploadFile`,
  `resolveFolderPath`, etc.).

### Changed
- `homemedia-backend`, `homesync-backend`, `homenotes-backend`: each
  `homecloudClient.js` now imports `HOMECLOUD_URL` from the shared package
  instead of defining it locally; each `app.js` (and HomeSync's
  `authProxy.js`) imports `requireAuth`/`HOMECLOUD_URL` from
  `@home/homecore-client`. Three `authMiddleware.js` files deleted.
- Per-workspace `package-lock.json` files (`apps/*`, `homecore/`) removed
  — an npm workspace uses one root lockfile, not one per package; these
  predated workspaces being set up.

### Verified
- All four affected suites re-run **after** the extraction, not just
  after the preceding path fix — same counts as above, confirming the
  refactor changed nothing observable: `homecore` 64/64,
  `homemedia-backend` 18/18, `homesync-backend` 20/20, `homenotes-backend`
  24/24.

## [0.3.0] — HomeSync Android's `data/` package rebuilt from spec

Rebuilt (the original was lost — see the `[Unreleased]` correction note
above) by tracing every consumer file (`HomeSyncApplication.kt`,
`BackupWorker.kt`, `HomeViewModel.kt`, `LoginViewModel.kt`) for its exact
expected constructor/method signatures, and every request/response shape
against the real backend routes (`homecore/src/auth.js`,
`homesync-backend/src/devices.js`, `homesync-backend/src/sync.js`)
directly — not assumed or reconstructed from memory of the lost version.

### Added
- `data/BackupSettings.kt`, `data/SessionManager.kt`,
  `data/SettingsStore.kt` — DataStore-backed session and backup
  preferences. `SessionManager` keeps an in-memory `StateFlow` copy
  alongside the persisted value specifically so `ApiClient`'s auth
  interceptor (which can't `suspend`) can read the current token
  synchronously.
- `data/api/Models.kt`, `data/api/HomeSyncApi.kt`, `data/api/ApiClient.kt`
  — Retrofit/OkHttp, matched field-for-field against the real backend
  JSON. `ApiClient` normalizes the bare `192.168.1.50:8080`-style address
  from the login screen into a real base URL, and rebuilds its cached
  client if that address changes.
- `data/local/AppDatabase.kt`, `data/local/SyncedMediaDao.kt`,
  `data/local/SyncedMediaEntity.kt` — Room, for the on-device
  already-backed-up cache used both to skip re-scanning known files and
  as the offline fallback for the Home screen's summary card.

### Verified, and what wasn't
- Every import across the app now resolves to a real file — checked by
  cross-referencing every `import com.homeecosystems.homesync.data...`
  line in the app against what was actually written, not just assumed
  complete.
- `data/BackupSettings.kt` and `data/api/Models.kt` (the two files with no
  Android/Retrofit/Room dependencies) were **compiled with `kotlinc`**
  alongside the already-verified `sync/SyncLogic.kt` — a real compile,
  not a read-through.
- The other seven files depend on `android.*`, DataStore, Room, or
  Retrofit, none of which are resolvable in a sandbox with no Android SDK
  and no Maven repository on its network allowlist — same limitation
  `TESTING.md` already documents for this module. These were carefully
  traced against real call sites and checked for balanced
  braces/parens, but **not compiled**. A real `./gradlew build` (or
  Android Studio's Gradle sync) is the next real checkpoint, and the
  first thing worth doing once this reaches a machine that has the
  Android SDK installed.

## [0.2.0] — icon set rebuilt from spec

### Added
- The 9-icon set + wordmark from `docs/DESIGN_SYSTEM.md`'s spec, rebuilt
  from scratch (the original was lost — see the [Unreleased] correction
  note above) and rendered/verified with `rsvg-convert` at both preview
  and favicon scale, on both light and dark backgrounds, before shipping
  — not just written and assumed correct.
- `design/` — the canonical source: `design/icons/*.svg` (nine app icons
  + `wordmark.svg`), `design/AppIcon.jsx` and `design/Wordmark.jsx` (inline
  React versions — an `<img src>` can't be recolored by `currentColor`,
  so anywhere an icon needs to follow the theme, it has to be inlined
  JSX, not a static file reference), and `design/sync-assets.sh`, which
  copies these out to every frontend that uses them. Edit only the
  `design/` copies; the script overwrites the rest.
- Real icons wired into Home (`AppCard.jsx` launcher tiles, sidebar app
  list, sidebar/topbar brand, mobile bottom-nav, and the `Wordmark`
  component on both login screens), HomeMedia's and HomeNotes'
  sidebar/topbar brand.
- `homecore/seed.js`'s icon paths (`/icons/homecloud.svg` etc.) now
  resolve to real files for the first time.

### Verified
- `apps/home`, `apps/homemedia`, and `apps/homenotes` each `npm run
  build` clean with these changes in place — not just checked by eye.

### Known gap
- `apps/homecloud` has no shared branded `Layout.jsx` the way its three
  siblings do (predates that pattern), so it only received the icon
  *files* (favicon/manifest use) — nothing to inline the icon into yet.
  Worth a small follow-up once someone's touching that frontend anyway;
  not urgent enough to justify restructuring it on its own.

## [0.1.1]

### Added
- Folded the full doc set (`docs.zip` — `SETUP.md`, `SERVICES.md`,
  `SECURITY.md`, `ROADMAP.md`, `TESTING.md`, `DESIGN_SYSTEM.md`,
  `DEVELOPER_GUIDE.md`, `SETUP_SCRIPT_CHANGES.md`, and the doc-set's own
  index `README.md`) into this repo under `docs/`, alongside
  `ARCHITECTURE.md` (moved there from the root — it was a byte-identical
  duplicate of the copy already in the doc set). This was previously a
  second, separate zip with no fixed relationship to the code — now it's
  one repo, one history. All references to these files elsewhere in the
  repo were updated to point at `docs/`.

### Fixed
- Corrected this file's "Known unmerged work" entry — see the
  [Unreleased] section above.

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
  `docs/SECURITY.md`) — nothing enforces a declared permission before granting
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
  the Tier 0/1/2 layering rule in `docs/ARCHITECTURE.md` §4.
- This pass: repository restructured into `gateway/`, `homecore/`,
  `apps/*`, `services/backup/`; HomeNotes built as a fourth Tier 1 app
  (backend + frontend + tests) — not yet reflected in `docs/SERVICES.md`/
  `docs/ROADMAP.md`, which still describe it as "not started."
