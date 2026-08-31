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

## [0.9.1] — Phase 6 of `MIGRATION_PLAN.md`: doc sync, plus a real bug found while doing it

The last phase of the HomeCore/HomeCloud migration. Documentation only
by plan — but writing an accurate routing table meant actually reading
every frontend's own `nginx.conf`, which surfaced a real, systemic bug
outside the scope of "just update the docs."

### Fixed
- **All four frontends' own `nginx.conf`** (`apps/home`, `apps/homecloud`,
  `apps/homemedia`, `apps/homenotes`) still proxied to a Docker service
  named `backend`, which hasn't existed since `homecore`'s rename at
  `v0.1.0`. Currently harmless in the real deployed topology — only the
  gateway publishes a host port, so these are a fallback nothing hits
  today, not something live — but `apps/homecloud/nginx.conf` and
  `apps/home/nginx.conf` were also missing any `/api/homecloud/` rule at
  all, which would matter the moment anything ever did reach them
  directly. Renamed `backend` → `homecore` in all four; added the
  missing `/api/homecloud/` (and, for HomeCloud's own frontend,
  `/api/share/`) rules mirroring the gateway's own routing; corrected
  each file's stale comments. Verified with `nginx -t` against all four
  (hostnames substituted with a resolvable dummy — no Docker network in
  this sandbox to resolve the real ones), not just visually inspected.

### Changed — documentation
- `docs/ARCHITECTURE.md` §1/§3/§4/§5/§6/§7/§8: HomeCore now correctly
  described as a real separate service, not embedded; the gateway
  routing table gained `/api/homecloud/`, `/api/homenotes/`,
  `/api/share/`, and `/notes/`; the "known v0 shortcuts" section's
  embedded-HomeCore item marked resolved (struck through, not deleted —
  the item below it was directly caused by this one); HomeNotes moved
  out of the "future" parenthetical everywhere it was still listed
  there; a new shortcut item added documenting why the old
  `files`/`folders`/`shares` tables are deliberately left inert rather
  than dropped for an existing install.
- `MIGRATION.md` rewritten — its central claim described exactly what
  this migration fixed.
- Root `README.md`: the "Tiered architecture" section rewritten; every
  `/api/files`/`/api/folders` path outside one large, deliberately
  flagged section fixed to `/api/homecloud/...`; the API reference table
  gained two missing routes (`/api/homecloud/files/quota` from Phase 2,
  `/api/homecloud/files/all` which existed before but was missing from
  this table); three instances of "HomeCloud's `/api/auth/me`" corrected
  to "HomeCore's" (a real factual imprecision — auth verification was
  never HomeCloud's job, not just an internal branding conflation like
  the rest of this document's known "homecloud vs Home" looseness); the
  HomeMedia section's claim that HomeCore "still lives embedded" fixed.
- **Deliberately not rewritten**: `README.md`'s `**Backend, in more
  detail:**` section and the following backup-service paragraphs —
  several hundred words of detailed, specific technical narrative
  describing a single merged backend that no longer exists as one.
  Judged too large to safely rewrite accurately in this pass without
  real risk of introducing new inaccuracies faster than fixing old ones.
  Flagged clearly and specifically in place instead (which file each
  concept actually lives in now, and where to find the accurate current
  version — `docs/SERVICES.md`, `docs/DEVELOPER_GUIDE.md`), rather than
  either left silently wrong or rushed. A real rewrite of this section is
  legitimate follow-up work, not something this entry claims is done.

### Verified
- All four fixed `nginx.conf` files pass `nginx -t` (syntax-checked
  directly, hostnames substituted since this sandbox can't resolve real
  Docker service names).
- Every remaining `/api/files`/`/api/folders` reference in `README.md`
  outside the flagged section checked and confirmed fixed; the one
  reference still inside the flagged section confirmed still there on
  purpose, not missed.

## [0.9.0] — Phase 5 of `MIGRATION_PLAN.md`: the switch actually flips

The biggest single change in this project's tracked history. Wired
`apps/homecloud-backend` into real infrastructure, deleted the old
duplicated code, and — critically — found and fixed four real problems
the original plan didn't anticipate, each caught by actually running
things rather than assumed away. See `MIGRATION_PLAN.md`'s Phase 5 for
the full account; this entry covers what changed, file by file.

### Added
- `scripts/migrate-legacy-homecloud-data.js` — a real, tested one-time
  migration for any deployment with existing data: copies (never moves)
  file/folder/share rows and the actual uploaded bytes from HomeCore's
  old storage into `apps/homecloud-backend`'s own, preserving every row
  id exactly. Verified with SHA-256 byte comparison on real file bytes,
  confirmed idempotent-by-refusal, confirmed the source is left
  completely untouched by three separate real runs (populated legacy db,
  re-run against an already-migrated destination, empty legacy db).
- `scripts/Dockerfile` + a new `migrate-legacy-data` Compose service
  (`profiles: [tools]`, never starts with a normal `docker compose up`)
  — packages the migration script with its own minimal image, since it
  lives at the repo root, outside any one service's own build context.
- `docs/SETUP.md` §6, "Upgrading an existing install past v0.9.0" — the
  real, followable steps using the new service above.
- `GET /api/homecloud/files/quota` is now the only source of usage/quota
  data anywhere in the frontend (see Changed, below).
- A second internal URL, `HOMECLOUD_BACKEND_INTERNAL_URL`, distinct from
  `HOMECLOUD_URL`/`HOMECLOUD_INTERNAL_URL` — see "What Phase 5's own plan
  didn't anticipate" below for why this exists.

### Changed — infrastructure
- `docker-compose.yml`: added the `homecloud-backend` service (own
  volume `homecloud_backend_data`, own healthcheck); `homecloud`
  (frontend) now depends on it instead of `homecore`; `homecore` and all
  three sibling backends (`homemedia-backend`, `homesync-backend`,
  `homenotes-backend`) gained `HOMECLOUD_BACKEND_INTERNAL_URL` and,
  for the siblings, a `depends_on: homecloud-backend` alongside their
  existing `depends_on: homecore`.
- `gateway/nginx.conf`: added `/api/homecloud/` → `homecloud-backend`
  and `/api/share/` → `homecloud-backend` (the latter deliberately
  unprefixed and unauthenticated — see Phase 2's original reasoning,
  restated in `apps/homecloud-backend/src/publicShare.js`).
- `services/backup/backup.sh` generalized from one hardcoded volume to
  any number of named sources — `homemedia_data`/`homenotes_data`/
  `homesync_data` (including HomeNotes' actual note content, not just a
  cache) were silently never backed up before this. `docker-compose.yml`'s
  `backup` service now mounts all five app volumes.
- `docs/SETUP.md` §5's restore instructions corrected — still referenced
  the pre-`name: home` volume prefix from before `v0.1.0`'s Compose
  project-name pin, and only covered one of what's now five sources.
- `MIGRATION.md` rewritten — its central claim ("`homecore/` ... deliberately
  embedded in the former HomeCloud backend for v0") described exactly what
  this phase fixed; left saying so would have been the same mistake this
  project keeps flagging elsewhere.

### Changed — HomeCore
- `homecore/src/auth.js`'s `/api/auth/me` simplified: `quotaBytes`/
  `usedBytes` removed (the local `files` table they queried no longer
  exists); `quotaOverride` stays, now the only quota-related field here.
- `homecore/src/admin.js`'s Phase 4 fallback removed the right way, not
  just deleted: an unreachable `homecloud-backend` now means
  `usedBytes: null` — a genuinely different fact from "zero" — while
  every other admin action (disable, role, quota, 2FA reset) keeps
  working, matching `docs/ARCHITECTURE.md`'s graceful-degradation
  principle instead of an all-or-nothing failure over one field.
  `apps/homecloud/src/pages/Admin.jsx` shows "Usage unavailable" for
  that case instead of passing `null` through `formatBytes`.
- `homecore/src/db.js`: `files`/`folders`/`shares` table definitions and
  `UPLOADS_DIR` removed. **Deliberately not dropped** for an existing
  install, unlike `activity_log` in Phase 3 — this held real file
  ownership records, not an audit trail with an already-accepted
  "acceptable to lose some history" precedent. Simply never created on a
  fresh install; left inert (unused, untouched) on an existing one until
  the person manually reclaims that space once confident their migration
  succeeded.
- `homecore/src/files.js`, `folders.js`, `publicShare.js` deleted, along
  with their tests (`homecore/test/files.test.js`, `folders.test.js`,
  `publicShare.test.js`) and the dead trash-purge scheduling left over in
  `homecore/src/server.js` (that responsibility moved to
  `apps/homecloud-backend/src/server.js` back in Phase 2).
- `homecore/src/homecore/health.js`: its "storage" health check pointed
  at the now-removed `UPLOADS_DIR` — repointed to check `DATA_DIR`
  writability instead (this service's own database directory, a
  genuinely distinct signal from a successful query, not a check on file
  uploads anymore).
- `homecore/src/homecore/seed.js`: `seedHomecloudApplication()`'s special
  self-registration case (reading this process's own `package.json`
  version, since HomeCloud used to share it) collapsed into the same
  pre-seeded pattern as its three siblings — HomeCloud is a genuinely
  separate service now, with no more access to this database than
  HomeMedia ever had.
- Three tests that generated activity by calling now-deleted local routes
  (`homecore/test/activity.test.js`, two tests each in `admin.test.js`
  and `homecore.test.js`) rewritten to simulate exactly what
  `apps/homecloud-backend`'s real `logActivity()` sends over HTTP — the
  actual cross-service boundary being tested, tested more directly than
  booting a second whole service just to generate one event would.

### What Phase 5's own plan didn't anticipate (all four found by actually
running things, not by re-reading the plan more carefully)
1. **Existing real data needed a real migration mechanism.** `MIGRATION.md`
   flagged the risk back at `v0.1.0` but never built the fix — see Added,
   above.
2. **`/api/auth/me` needed simplifying, not just extending.** Every real
   consumer (`apps/homecloud/src/pages/Dashboard.jsx`, `apps/home/src/pages/Dashboard.jsx`'s
   quota widget) found by grepping every `usedBytes`/`quotaBytes`
   reference across the whole frontend tree before touching anything —
   including one hardcoded path in `apps/homecloud/src/components/UploadZone.jsx`
   that a path-only search of `api.js` would have missed entirely.
3. **`admin.js`'s fallback removal needed real thought**, not a delete —
   see Changed — HomeCore, above.
4. **The big one: HomeMedia, HomeSync, and HomeNotes were all about to
   break in production.** Each fetches real HomeCloud files through its
   own `homecloudClient.js`, which used the *same* URL for identity
   verification and file operations — correct before the split (same
   server), silently wrong after it. `apps/homemedia-backend`'s test
   suite failing immediately after the old routes were deleted is what
   surfaced this. Fixed across all three: `apps/homemedia-backend/src/homecloudClient.js`,
   `apps/homesync-backend/src/homecloudClient.js`, and
   `apps/homenotes-backend/src/homecloudClient.js` now use the new
   `HOMECLOUD_BACKEND_INTERNAL_URL`, distinct from `HOMECLOUD_URL`
   (identity, still HomeCore) — and every one of their test harnesses now
   boots the real `apps/homecloud-backend` service (which itself boots a
   real HomeCore), verified via Node's `require()` module cache to
   correctly reuse one HomeCore instance across all three rather than
   silently booting three divergent ones (a token from one wouldn't have
   verified against another).

### Verified
- **Real end-to-end, not just isolated test suites**: actual HomeCore and
  `homecloud-backend` processes, actual nginx running the real gateway
  config (Docker service names substituted for `127.0.0.1`, everything
  else identical), actual `curl` calls through that gateway — register,
  upload, list files, check quota, download (byte-for-byte diff against
  the original), create a share, download it anonymously via the
  unprefixed route (byte-for-byte diff again), and confirm HomeCore can
  reach `homecloud-backend`'s internal usage endpoint for real (caught
  and fixed one test-setup mistake this way: forgetting to set
  `HOMECLOUD_BACKEND_INTERNAL_URL` correctly fell back rather than
  silently passing).
- 145 tests across the whole ecosystem, all actually run from a clean
  install: `homecore` 44, `apps/homecloud-backend` 39,
  `homemedia-backend` 18, `homesync-backend` 20, `homenotes-backend` 24.
- Both edited frontends (`apps/homecloud`, `apps/home`) rebuilt clean
  with `npm run build` after every change, not just read through.
- Confirmed directly: `docker-compose.yml` and `scripts/Dockerfile`
  parse as valid YAML/Dockerfile syntax; the migration script's exact
  `npm install better-sqlite3` packaging approach verified working
  outside Docker (this sandbox has no Docker daemon to build the real
  image against).

## [0.8.0] — Phase 4 of `MIGRATION_PLAN.md`: admin panel's cross-service usage field

### Added
- `apps/homecloud-backend/src/internalUsage.js` — `GET /internal/users/usage`,
  authenticated with the same `HOMECORE_INTERNAL_SECRET` Phase 3
  introduced (one shared secret for machine-to-machine calls between
  these two services in either direction, not a second one to generate
  and keep in sync). Returns usage only for users who actually have
  files — the caller defaults anyone missing to 0.
- `apps/homecloud-backend/test/internalUsage.test.js` — 4 tests: no
  header, wrong secret, server's own secret unset (fails closed even with
  a header provided), and the real shape (only non-zero users appear).

### Changed
- `homecore/src/admin.js`'s `GET /api/admin/users`: `usedBytes` now tries
  `apps/homecloud-backend`'s internal endpoint first (2s timeout), falling
  back to the original local `SUM(size) ... GROUP BY user_id` query
  against `homecore/src/db.js`'s own `files` table if that call fails.
  Always falls back today, in every real deployment — `homecloud-backend`
  isn't wired into `docker-compose.yml` yet (that's Phase 5) — which is
  exactly the point: today's live behavior is unchanged, the real path is
  already built and proven.
- `homecore/test/admin.test.js`: two new tests, not just incidental
  coverage — one uploads a real file through HomeCore's own still-live
  `/api/files/upload` and confirms the fallback path reflects it
  correctly; the other spins up a lightweight stand-in HTTP server
  (not the full real `homecloud-backend` — that contract is already
  covered by `internalUsage.test.js` against the genuine thing) to prove
  `admin.js` actually prefers a reachable answer over the fallback, not
  just "doesn't crash when both exist."

### Deliberately not done — still your call, per `MIGRATION_PLAN.md`
- The Admin page still lives in `apps/homecloud/src/pages/Admin.jsx`,
  same as it did before Phase 4. Moving it to `apps/home` remains flagged
  as a UX decision, not executed without confirmation.

### Verified
- New endpoint: 4/4. `homecore`: 72/72 (+2, both real behavioral tests,
  not just re-runs). Every other suite unaffected:
  `apps/homecloud-backend` 39/39, `homemedia-backend` 18/18,
  `homesync-backend` 20/20, `homenotes-backend` 24/24. 173 tests across
  the ecosystem, all actually run.

## [0.7.0] — Phase 3 of `MIGRATION_PLAN.md`: `activity_log` retired

`activity_log` is gone. Every activity feed — HomeCloud's own per-user
panel, the admin cross-user view, and HomeCore's cross-app audit feed —
now reads from the one shared `hc_activity_events` table, written to by
both a same-process bridge (auth/admin actions) and a new HTTP endpoint
(everything `apps/homecloud-backend` does, now that it's a separate
process).

### Added
- `POST /internal/events` (`homecore/src/internalEvents.js`) — a new,
  shared-secret-authenticated endpoint (`HOMECORE_INTERNAL_SECRET`, fails
  closed if unset) so a genuinely separate Tier 1 process can emit into
  HomeCore's event bus without a per-request user token to forward.
  `apps/homecloud-backend/src/db.js`'s `logActivity()` calls this,
  fire-and-forget, exactly as `docs/ARCHITECTURE.md` §4's Tier 1 rule
  describes — never awaited by its callers, and a failed call (HomeCore
  down, bad secret, network blip) only costs an activity-feed entry, never
  the upload/move/delete/share action itself.
- `homecore/src/homecore/events.js`: `toAction()`, the exact inverse of
  the existing `toEventType()` (both now live here, moved from
  `homecore/src/homecore/db.js` — see "Changed" below), and an
  `applicationId` filter on `listEvents()`.
- Tests: `homecore/test/internalEvents.test.js` (secret validation, body
  validation, a real emitted event landing in `hc_activity_events`),
  `homecore/test/activity.test.js` (the moved `GET /api/activity` keeps
  its original response shape and per-user scoping — previously
  untested), `apps/homecloud-backend/test/activity.test.js` (genuine
  end-to-end: an action through that service's real HTTP API reaching
  HomeCore over the network, plus a resilience test confirming the action
  itself still succeeds when HomeCore is unreachable).

### Changed
- `homecore/src/db.js`: `activity_log` is no longer created; an explicit
  `DROP TABLE IF EXISTS activity_log` removes it from any existing
  on-disk database. `logActivity()` no longer writes to it directly — the
  `onActivity()` listener bridge (unchanged) is now the only write path,
  landing in `hc_activity_events` instead.
- `GET /api/activity` moved from `homecore/src/activity.js` (deleted) to
  `homecore/src/homecore/homecloudActivity.js` — same URL, same
  `{action, targetName, createdAt}` response shape (`apps/homecloud`'s
  `Settings.jsx` needed no changes), now reading `hc_activity_events`
  filtered by `applicationId` (HomeCloud only) and `actorUserId`.
- `homecore/src/admin.js`'s `GET /api/admin/activity` — same move, same
  reasoning, same unchanged response shape (`Admin.jsx` needed no
  changes); see "Real gap found" below for why this wasn't optional.
- `ACTION_EVENT_MAP`/`toEventType()` moved from `homecore/src/homecore/
  db.js` to `homecore/src/homecore/events.js` — needed by a second
  caller (the new internal-events route) as well as the original
  in-process bridge, so one shared home beat two copies.
- `apps/homecloud-backend/src/db.js`'s `logActivity()`: real
  implementation, replacing the documented no-op from `[0.6.0]`. Same
  3-argument signature, same unawaited call sites in `files.js`/
  `folders.js` — only what the function *does* changed, exactly as
  planned.

### Real gap found (not in the original plan text)
- `homecore/src/admin.js`'s `GET /api/admin/activity` reads `activity_log`
  directly too, separately from `homecore/src/activity.js` — dropping the
  table would have silently 500'd the admin activity panel. Caught by
  tracing every *reader* of the table before dropping it, not just the
  writers the plan named. Fixed the same way as the per-user feed.

### Known, accepted gap
- `hc_activity_events` has been populated by the `onActivity()` bridge
  since HomeCore's event bus was introduced, so any install running since
  then keeps its full history. An install with `activity_log` rows older
  than that bridge loses just that window's history — there's no backfill
  for it. Judged not worth a one-time migration script for a pre-1.0
  family server; noted here rather than silently accepted.

### Fixed
- Root `package.json`'s `version` field had never been bumped past its
  initial `0.1.0`, despite git tags reaching `v0.6.0` — `VERSIONING.md` is
  explicit that this field is "the one you tag releases with," so it
  should have tracked each tag. Found while preparing this tag, not
  something this pass otherwise depended on: checked directly, nothing in
  the running code reads *this* file's version (`health.js`/`system.js`/
  `seed.js` all read `homecore/package.json`'s own, separately-versioned
  field instead) — so this was a documentation-accuracy gap, not a live
  bug. Fixed going forward (bumped to `0.7.0` here); past tags are left
  as-is rather than rewriting history.

### Verified
- `homecore` 70/70 (up from 64 — 6 new: 3 `internalEvents.test.js` + 3
  `activity.test.js`), `apps/homecloud-backend` 35/35 (up from 33 — 2 new,
  the end-to-end cross-service test). `homemedia-backend` 18/18,
  `homesync-backend` 20/20, `homenotes-backend` 24/24 — re-run, unaffected.
- The `DROP TABLE` itself checked against more than a fresh test database
  (which never has the table to begin with, so could never have caught a
  migration bug either way): a one-off script built a simulated
  pre-`v0.7.0` database with real `activity_log` rows, booted current
  code against it, and confirmed the table drops cleanly while
  pre-existing `users` rows survive untouched.

## [0.6.0] — Phase 2 of `MIGRATION_PLAN.md`: real file/folder/share logic moves

The big one. `files.js`, `folders.js`, `publicShare.js`, and their tables
moved from `homecore/` into `apps/homecloud-backend`, which now actually
does something.

### Added
- `apps/homecloud-backend/src/db.js`: `files`/`folders`/`shares` tables,
  moved from `homecore/src/db.js`. One deliberate schema change: no
  foreign keys to `users(id)` anymore — can't reach across two separate
  database files. Checked directly first: no account-deletion route
  exists anywhere today (only disable/quota/role/2FA-reset in
  `admin.js`), so this drops no live behavior — a real, named gap for
  whoever adds account deletion later, not a live bug now.
- `apps/homecloud-backend/src/files.js`, `folders.js`, `publicShare.js` —
  moved, with exactly two behavioral changes from the originals: auth
  applies at mount time via `@home/homecore-client` instead of a local
  middleware import, and the quota limit comes from
  `req.user.quotaOverride` (see the `homecore/src/auth.js` change below)
  instead of a local `users` table query. Every route, status code, and
  error message was diffed against the original and confirmed identical
  otherwise — one real mismatch caught this way in an early draft of
  `publicShare.js` (wrong status codes, wrong rate-limit option name)
  before it ever reached a test run.
- **New:** `GET /api/homecloud/files/quota` — didn't exist in the
  original. HomeCore's own `/api/auth/me` could compute `usedBytes` with
  a direct query in the merged process; once split, that field is stale
  for anyone actually using this service (checked directly — the adapted
  quota test failed against it, `0 !== 1468006`, which is what surfaced
  this). This is the real, reachable replacement, exposing what this
  service already computes locally for its own quota enforcement.
- Routes settled at `/api/homecloud/files`, `/api/homecloud/folders` —
  `MIGRATION_PLAN.md`'s Phase 5 originally left this as an open decision;
  Phase 2's own tests needed something concrete to call, so it got
  decided here instead. The public share-download route stayed at the
  unprefixed `/api/share/:token`, deliberately — link stability for
  already-shared URLs matters more there than API-prefix consistency.
- `apps/homecloud-backend/test/files.test.js`, `folders.test.js`,
  `publicShare.test.js` — moved from `homecore/test/`, adapted for two
  real services instead of one (registration against HomeCore, requests
  against this service, one exception: the quota check now calls this
  service's own new `/quota` endpoint instead of HomeCore's `/me`).

### Changed
- `homecore/src/auth.js`'s still-live `/api/auth/me` gains an additive
  `quotaOverride` field (the raw limit, not the computed usage) —
  `quotaBytes`/`usedBytes` stay exactly as they were, since
  `apps/homecloud`'s current frontend still depends on them until Phase 5
  flips the switch. Confirmed additive, not breaking: HomeCore's own
  suite re-run immediately after this one-line change, still 64/64.

### Known, temporary gap (see `apps/homecloud-backend/src/db.js`'s comment)
- `logActivity()` in the new service is a genuine no-op for now. File/
  folder actions performed through it do not appear in anyone's activity
  feed until Phase 3 lands the real HTTP-emit-to-HomeCore replacement.
  Every call site was moved unchanged specifically so Phase 3 only has to
  change what the function *does*, not rewrite every caller a second
  time.

### Verified
- New suite: 33/33 (5 from Phase 1 + 2 new `/quota` tests + 26 moved and
  adapted from `homecore/test/`). One real failure surfaced and fixed
  along the way (the `/quota` gap above), not swept under a passing
  count.
- Every other backend suite re-run afterward: `homecore` 64/64 (including
  the `/me` change), `homemedia-backend` 18/18, `homesync-backend` 20/20,
  `homenotes-backend` 24/24.
- Confirmed directly (not assumed): the originals in `homecore/src/`
  still exist and still pass their own tests — nothing deleted yet, per
  the plan's explicit "delete in the same commit that flips the switch."
  Confirmed `homecloud-backend` still isn't wired into
  `docker-compose.yml`/`gateway/nginx.conf` — that's Phase 5.

## [0.5.0] — Phase 1 of `MIGRATION_PLAN.md`: `apps/homecloud-backend` shell

### Added
- `apps/homecloud-backend/` — new, independent service: own `package.json`
  (`@home/homecore-client` as its only auth dependency, no local JWT
  verification), own `Dockerfile`, own SQLite file (`db.js` — no tables
  yet; Phase 2 moves `files`/`folders`/`shares` here from `homecore/`).
- `GET /api/homecloud/health` — public, matches the sibling apps'
  `/api/<app>/health` convention.
- `GET /api/homecloud/whoami` — temporary, proves the HomeCore
  auth-delegation pattern actually works end-to-end for this service
  (rejects a missing token, rejects a garbage token, accepts a real
  HomeCore-issued one and returns that user) rather than just importing
  `requireAuth` unused. Replaced by real routes in Phase 2.
- `apps/homecloud-backend/test/` — 5 real assertions (health, the three
  whoami cases, a clean 404), following the same test-harness pattern as
  `homemedia-backend` (a real isolated HomeCore instance booted per test
  file, not a mock).

### Verified
- New suite: 5/5. Every existing suite re-run after adding the new
  workspace member and root install, to confirm neither disturbed
  anything: `homecore` 64/64, `homemedia-backend` 18/18, `homesync-backend`
  20/20, `homenotes-backend` 24/24.
- Confirmed **not** wired into `docker-compose.yml` or
  `gateway/nginx.conf` — checked directly, matching the plan's explicit
  Phase 1 scope. That's Phase 5.

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
