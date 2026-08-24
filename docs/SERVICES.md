# Services — what's actually built

Status of every service named anywhere in the roadmap, checked directly
against the repository rather than against an earlier doc's word.
Automated-test numbers below were produced by actually running each
suite (`npm test`), not copied from a prior README claim — several of
those claims turned out to be slightly stale (see each section).

## HomeCloud

**Status: stable, the foundation everything else builds on.**

Self-hosted file storage: accounts, bcrypt password hashing, JWT auth
with token-version-based revocation, admin/user roles, per-user quotas,
nested folders, soft-delete Trash (30-day retention, auto-purged),
shareable links, batch download-as-zip, search/sort, an activity log,
TOTP 2FA with recovery codes and admin override, and PWA support.

The photo gallery, lightbox, and thumbnail viewer that used to live in
HomeCloud's own frontend were **removed** once HomeMedia was built — that
was overlapping scope HomeMedia now owns. HomeCloud is back to being a
file manager, not a photo viewer, per the architecture's own division of
labor.

One new endpoint exists specifically for HomeMedia: `GET
/api/files/all?type=image|video` — a flat, cross-folder listing filtered
by mime type, gated by the same `requireAuth` as everything else.

**Tests: 63, all passing** (`backend/test/`, run via `node --test`).
Covers auth, files, folders, admin, public share links, rate limiting,
and HomeCore's own `/api/core/*` routes in one suite, since HomeCore is
embedded in this same backend process. Each test file gets its own
isolated temp SQLite database.

## Home

**Status: stable.** The dashboard/launcher frontend — no backend of its
own, calls the shared backend directly. Full light/dark/auto theme
system shared with HomeCloud's frontend.

## HomeMedia

**Status: built and tested.** The first real proof of "installing an app
later shouldn't require rebuilding HomeCloud" — it's a genuinely separate
service (own `homemedia-backend/`, own small SQLite DB, own container),
not folded into HomeCloud's process the way HomeCore currently is.

- **No identity of its own.** Every request authenticates by calling
  HomeCloud's `/api/auth/me` (`homemedia-backend/src/homecloudClient.js`),
  cached 5 seconds purely to avoid a flood of calls per gallery page load
  — not to relax how current "signed out" is.
- **Stores no photos or videos.** Its database holds only albums,
  favorites, and a cached EXIF extraction per file; every byte is
  fetched from HomeCloud on demand. Deleting HomeMedia's volume loses
  albums/favorites, never a photo.
- **Its own gallery-quality thumbnails** (640px, vs. HomeCloud's 320px
  file-manager icon), generated and cached only the first time a photo
  is actually viewed in the gallery.
- Auth-header-bearing image fetches via `AuthImage.jsx` (object URLs),
  since a plain `<img src>` can't carry an `Authorization` header.

**In v1:** timeline-grouped library, filename search, favorites, albums
(create/rename/delete, cover photo), lightbox with EXIF panel (camera,
lens, exposure, GPS), video playback.

**Deliberately deferred:** video poster-frame thumbnails (needs ffmpeg —
a real dependency worth adding later, not now); duplicate detection and
shared/multi-user albums (both real design problems — perceptual
hashing, a whole ACL model — deserving their own pass); mobile upload
integration (depends on HomeSync).

**Tests: 18, all passing** (`homemedia-backend/test/`) — real
integration tests against an actual isolated HomeCloud test instance as
the upstream, not a mock, including a real JPEG with real embedded EXIF
written by `sharp` and read back by `exifr`.

## HomeSync

**Status: backend done and tested; Android app incomplete — will not
currently build.**

### Backend (`homesync-backend/`)

Same shape as HomeMedia's backend: no identity or storage of its own,
authenticates every request against HomeCloud, every backed-up file
actually stored via HomeCloud's own upload endpoint. Files land under
`Category/Year/Month` (e.g. `Photos/2026/August`) —
`homesync-backend/src/pathPlanner.js` decides the path (pure, unit
tested), `homecloudClient.js` creates any missing folders.

The person only enters **one** address on the Android login screen —
`authProxy.js` is a small genuine proxy forwarding `/api/homesync/auth/*`
straight through to HomeCloud, the same pattern each frontend's nginx
already uses.

**Tests: 20, all passing** (`homesync-backend/test/`) — integration tests
against a real HomeCloud instance.

### Android app (`homesync-android/`)

**This is the one part of the ecosystem with a real, current build gap.**

What exists: 14 Kotlin files (13 main + 1 test) — sign-in with full 2FA
support, independent Photos/Videos/Screenshots/Downloads toggles,
Wi-Fi-only/charging-only mapped onto WorkManager's native `Constraints`,
content-hash dedup, a "last backup" summary screen.

What's verified: `sync/SyncLogic.kt` — the core hashing/dedup-planning
logic — has zero `android.*`/`androidx.*` imports specifically so it can
run outside Android entirely. It was compiled and run directly with
`kotlinc`, and its 7 JUnit tests (`SyncLogicTest.kt`, streaming SHA-256
checked against known test vectors and independently against Java's
`MessageDigest`) are present and structured correctly.

**What's missing:** `HomeSyncApplication.kt`, `BackupWorker.kt`,
`HomeViewModel.kt`, and `LoginViewModel.kt` all import a `data` package —
`ApiClient`, `HomeSyncApi` (plus its request/response types like
`LoginRequest`, `CheckRequest`, `RegisterDeviceRequest`,
`TwoFactorVerifyRequest`, `HistorySummary`), `SessionManager`,
`SettingsStore`, `AppDatabase`, `SyncedMediaDao`, `SyncedMediaEntity` —
**none of which exist anywhere in the repository.** This isn't a subtle
gap: it's the entire network client and local database layer. As checked
in, this module cannot compile. (Checked against both the gateway-restored
and the sister setup-tooling branch — same gap in both, and nothing in
`.gitignore` explains it as an intentionally excluded folder.)

Earlier documentation described this as "written carefully but never
build-tested" and estimated "17 Kotlin files" — both slightly optimistic
relative to what's actually in the repo (14 files, and a missing data
layer, not just an unverified build). Treat writing the `data/` package
as the next concrete task here, before a first Android Studio build is
attempted — see `ROADMAP.md`.

**Deliberately deferred (design decisions, not oversights):** true
resumable/chunked upload (retries re-send the whole file — reasonable
given Wi-Fi-only defaults and typical file sizes); a numeric
battery-percentage threshold (uses WorkManager's built-in
`requiresBatteryNotLow` instead); detecting an in-place photo edit (the
dedup cache keys on MediaStore id alone); a real app icon / matching
typography (placeholder for now).

## HomeCore

**Status: built, embedded (not yet its own service).** See
`ARCHITECTURE.md` §3 for the tables and what's registered. Lives inside
`backend/src/homecore/`.

## HomeVault

**Status: full security design written, zero code.** See `SECURITY.md`
for the threat model. `HOME_MASTER_SPECIFICATION.md`'s own rule (§18/§35
Phase 8) was "dedicated security design before implementation" — that
part is done; implementation hasn't started, and per the threat model's
own §9, several prerequisites (TLS at the gateway, a shared-origin-vs.
-separate-origin decision, tuned Argon2id parameters, a designed recovery
kit) should land first.

## HomeNotes, HomeTasks, HomeMonitor, HomeAI, HomeBridge

**Status: not started.** Named in the roadmap (`ARCHITECTURE.md` §7,
`ROADMAP.md`), no code anywhere in the repository.

## The icon system

**Status: designed, never integrated.** A separate design pass produced
9 application icons and a wordmark following a described house-metaphor
system. None of it — no `icons/` folder, no `wordmark/` folder, no
`preview.html` — exists anywhere in this repository. `homecore/seed.js`
already references icon paths (`/icons/homecloud.svg`, etc.) that don't
resolve to real files; Home's and HomeMedia's frontends currently ship no
icon assets at all, and only HomeCloud's frontend has real PWA icon PNGs.
See `DESIGN_SYSTEM.md`.
