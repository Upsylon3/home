# Migration plan: actually separating HomeCore from HomeCloud

`homecore/` is currently a rename, not a split (see `README.md`'s
"Tiered architecture" section and the notice at the top of
`homecore/src/app.js`). This is the concrete plan to make it real, based
on tracing exactly which SQL tables each existing route file touches.

Each phase below is sized to be its own branch (see `VERSIONING.md`) and
should leave the test suite fully green before merging — don't start the
next phase on top of a red one.

## What actually gets split, and why

Traced directly from the code (`grep`-ing every `FROM`/`INTO`/`UPDATE`
across `homecore/src/*.js`):

| Table | Touched by | Destination |
|---|---|---|
| `users` | auth.js, files.js, admin.js | **HomeCore** — identity |
| `recovery_codes` | auth.js, admin.js | **HomeCore** — identity (2FA) |
| `files` | files.js, folders.js, auth.js (usage), admin.js (usage) | **HomeCloud** — storage |
| `folders` | folders.js, files.js | **HomeCloud** — storage |
| `shares` | files.js, publicShare.js | **HomeCloud** — storage |
| `activity_log` | auth.js, files.js, folders.js, admin.js | **retired** — see below |
| `hc_*` (six tables) | `homecore/` subfolder only | **HomeCore** — already correctly isolated today |

The `hc_*` tables are good news: whoever built the HomeCore subfolder
already kept it from touching `users`/`files`/etc. directly — that half
of this split is already done. The work is entirely in the top-level
`homecore/src/*.js` files (`auth.js`, `files.js`, `folders.js`,
`admin.js`, `publicShare.js`, `activity.js`) and the `db.js` schema they
share.

### The one real design decision: `activity_log`

This table is the only one written by *both* sides (auth/admin actions
from the identity side, upload/share/delete from the storage side) — it
can't cleanly belong to only one database once split. Rather than picking
a side and duplicating writes across a network call every time, retire it
and route everything through the event bus that already exists for
exactly this:

- `db.js` already has an `onActivity()` listener hook that HomeCore uses
  to mirror every `logActivity()` call into `hc_activity_events` (see the
  comment above `logActivity()` in `homecore/src/db.js`) — this is
  already a well-built seam, not something to throw away.
- Once split, HomeCloud can't call a same-process listener anymore. It
  instead **emits** to HomeCore's event bus over HTTP, fire-and-forget —
  exactly the Tier 1 rule in `docs/ARCHITECTURE.md` §4 ("may emit events to
  the shared bus... your app must work identically whether anything is
  listening or not"). If that call fails, the upload/delete/share still
  succeeds; only the audit-trail entry is missed, logged as a warning.
- `GET /api/activity` (today: "my own recent activity," reading
  `activity_log`) becomes a HomeCore route filtering `hc_activity_events`
  by `user_id` instead. One feed, one table, both apps write to it.
- This is also, for free, the first real piece of `docs/ROADMAP.md`'s
  cross-app timeline idea — the one it calls "the single best
  effort-to-payoff idea on this list."

## Phase 0 — extract the shared HomeCore-client library ✅ done (`v0.4.0`)

**Done as planned, with one correction:** the plan below assumed
`homecloudClient.js` was near-identical across all three backends. It
wasn't — only `verifyUser`/the cache/`HOMECLOUD_URL` (~40 lines)
duplicated; the app-specific calls were genuinely different per app and
correctly stayed put. Confirmed by diffing pairwise before writing
anything, not assumed. See `CHANGELOG.md` `[0.4.0]` for exactly what
moved where, and for a real test-infrastructure bug (broken paths from
the `backend/` → `homecore/` rename) found and fixed on the way.

Do this **first**, before touching any tables, because it's pure
refactor (no behavior change) and de-risks everything after it.

`homemedia-backend`, `homesync-backend`, and `homenotes-backend` each
independently wrote their own near-identical pair of files —
`homecloudClient.js` (call HomeCore's `/api/auth/me` to verify a token,
cache 5s) and an Express auth middleware wrapping it. Three copies of the
same ~80 lines is exactly the kind of thing the empty `packages/`
directory was clearly scaffolded for.

- Create `packages/homecore-client/` — one small package exporting
  `verifyToken(token)` and an Express `requireAuth` middleware.
- Point all three existing backends at it via npm workspace
  dependencies; delete their local copies.
- Run all three backends' test suites. They should be unaffected — same
  behavior, one implementation.
- This becomes consumer #4 the moment HomeCloud's new backend exists
  (Phase 2) — proving the extraction was worth doing before you needed
  it a fourth time, not after.

## Phase 1 — stand up an empty `apps/homecloud-backend` ✅ done (`v0.5.0`)

- New folder, own `package.json`, own `Dockerfile`, own SQLite data
  directory — same shape as `homemedia-backend`.
- Depends on `packages/homecore-client` for auth (no local JWT
  verification — delegates to HomeCore, per `docs/DEVELOPER_GUIDE.md`'s
  "delegated auth" principle, the same way its three siblings already
  do).
- A working `/api/health` endpoint and a passing (near-empty) test suite.
  Not wired into `docker-compose.yml`/`gateway/nginx.conf` yet.

**Done as planned.** Health endpoint at `/api/homecloud/health` (matching
the sibling apps' `/api/<app>/health` convention — note this doesn't
prejudge Phase 5's still-open question about whether the eventual real
routes keep HomeCloud's existing bare `/api/files` paths or adopt an
`/api/homecloud/` prefix; a health check nothing else calls is a
zero-risk place to pick the sibling-consistent form now). Added a
temporary `/api/homecloud/whoami` route specifically to prove the auth
delegation actually works end-to-end (rejects no token, rejects a garbage
token, accepts a real HomeCore-issued token) rather than just importing
`requireAuth` unused — Phase 2 replaces it with real routes. See
`CHANGELOG.md` `[0.5.0]`.

## Phase 2 — move file/folder/share logic and data ✅ done (`v0.6.0`)

- Move `files.js`, `folders.js`, `publicShare.js`, and the `files`/
  `folders`/`shares` table definitions from `homecore/src/db.js` into
  `apps/homecloud-backend`.
- Anywhere these files currently read `users` directly (quota checks in
  `files.js`) switches to reading the quota limit off the already-fetched
  identity response from `packages/homecore-client` (HomeCore's
  `/api/auth/me` already needs to return `quotaOverride` for this to
  work — check it does, extend it if not) — usage itself (`usedBytes`)
  stays a local query against HomeCloud's own `files` table, same as
  today.
- Move the matching test files; adapt them to spin up the new isolated
  service the way `homemedia-backend/test/` already does against a real
  HomeCore test instance (integration, not mocks — matches
  `docs/TESTING.md`'s existing standard).
- Don't delete the originals in `homecore/` until the new suite is fully
  green — keep both on the branch, delete in the same commit that flips
  the switch.

**Done largely as planned, with two things worth knowing:**

1. **The route-prefix decision Phase 5 (below) originally left open got
   made here instead**, out of necessity — Phase 2's own tests needed a
   real path to call. Routes moved to `/api/homecloud/files`,
   `/api/homecloud/folders` (matching the sibling apps' convention); the
   public share-download route stayed at the unprefixed `/api/share/:token`
   deliberately, for URL stability (see `apps/homecloud-backend/src/app.js`'s
   comment). Phase 5's job is now the concrete "point the frontend at
   these paths," not an open question.
2. **A real gap the adapted test suite caught, not something planned for
   up front:** `/api/auth/me`'s `usedBytes` field reads HomeCore's own
   (now cold, for anyone actually using the new service) `files` table —
   fine as an additive, backward-compatible field for the still-live old
   flow, but genuinely stale for the new one. The fix: a new
   `GET /api/homecloud/files/quota` endpoint, exposing what this service
   already computes locally for its own quota enforcement.
   `apps/homecloud`'s `StorageGauge.jsx` moves to this once Phase 5 wires
   the frontend up. This is exactly the kind of thing "verified by
   actually running the tests" is supposed to catch before it becomes a
   production surprise.

Every adapted test's status codes, error messages, and route list were
diffed against the original line-by-line before trusting them (one real
mismatch was caught this way in `publicShare.js` — see `CHANGELOG.md`).
Verified: new suite 33/33 (up from Phase 1's 5 — 5 original + 2 new
quota-endpoint tests + roughly 26 moved from `homecore/test/`). Every
other backend suite re-run afterward, unaffected: `homecore` 64/64,
`homemedia-backend` 18/18, `homesync-backend` 20/20, `homenotes-backend`
24/24. See `CHANGELOG.md` `[0.6.0]`.

## Phase 3 — retire `activity_log`

- Implement the HTTP-emit version of `onActivity()` in HomeCloud's new
  backend (see "the one real design decision" above).
- Move `GET /api/activity` into `homecore/src/homecore/`, backed by
  `hc_activity_events` filtered by user.
- Drop `activity_log` and `homecore/src/activity.js` once both sides are
  verified emitting correctly (check `hc_activity_events` fills up
  during a manual upload/delete/share pass).

## Phase 4 — admin panel's cross-service field

- `admin.js`'s user list needs one field it can no longer get via a SQL
  JOIN once split: `usedBytes` per user, computed from HomeCloud's
  `files` table.
- Add a small internal endpoint on the new HomeCloud backend —
  `GET /internal/users/usage`, shared-secret authenticated (same pattern
  as `docs/ARCHITECTURE.md` §4's HomeBridge "Option B," reused here since it's
  the same shape of problem: one trusted service calling another as
  itself, not as a user).
- `admin.js` (staying in HomeCore — it's genuinely a user-management
  concern; only this one field was ever storage-derived) calls that
  endpoint and merges the result in JS instead of SQL.
- **Separate, optional decision, needs your call rather than mine:** the
  Admin page currently lives in `apps/homecloud/src/pages/Admin.jsx`, but
  once its backend is 100% HomeCore, it's arguably a Home-the-hub concern
  (user administration isn't HomeCloud-specific — quota is about all
  storage, not just this one app). Moving it to `apps/home` fits the
  "Home is the hub" direction you asked for. This is UX-visible (a
  navigation change for you, day to day), so it's flagged rather than
  just done — say the word and it's a small, mechanical move once Phase 4
  lands.

## Phase 5 — wire it in

- `docker-compose.yml`: add `homecloud-backend` (own volume, own
  healthcheck, depends on `homecore`), point `apps/homecloud`'s frontend
  build at it instead of at `homecore`.
- `gateway/nginx.conf`: add a `/api/homecloud/` → `homecloud-backend`
  rule alongside the existing `/api/homemedia/`, `/api/homesync/`,
  `/api/homenotes/` ones, plus `/api/share/` → `homecloud-backend` for
  the public share-download route (kept unprefixed and unauthenticated —
  see Phase 2). **The path-prefix question this note used to leave open
  got decided in Phase 2** (out of necessity — its tests needed something
  concrete to call): `/api/files`/`/api/folders` became
  `/api/homecloud/files`/`/api/homecloud/folders`. This phase's actual
  remaining job is mechanical — update `apps/homecloud`'s frontend
  `api.js` to call the new paths (including `StorageGauge.jsx` moving
  from `/api/auth/me`'s `usedBytes` to the new
  `GET /api/homecloud/files/quota`, per Phase 2) — not a decision to
  make.
- `homecore/src/homecore/seed.js`: delete `seedHomecloudApplication()`'s
  special self-registration case — once HomeCloud is a real separate
  service, it gets pre-seeded exactly like HomeMedia/HomeSync/HomeNotes
  already are. Four Tier 1 apps, one seeding pattern, no special case.
  (Net simplification, not added complexity.)

## Phase 6 — cleanup and doc sync

- Delete the now-unused route files, table definitions, and the
  TRANSITIONAL notice at the top of `homecore/src/app.js`.
- Update `docs/ARCHITECTURE.md` §3/§6 and `README.md`'s "Tiered architecture"
  section — both currently describe the split as further along than it
  is; once it's real, they should say so plainly, matching this
  project's own stated standard of verifying claims against the repo
  rather than carrying forward stale ones.
- Bump to a new **MINOR** version per `VERSIONING.md` (this is a real new
  capability, verified working) and tag it.

## What this unlocks, concretely

- HomeCore becomes independently versionable/deployable for the first
  time — the prerequisite `VERSIONING.md` names for ever giving apps
  their own version numbers instead of one shared one.
- `packages/homecore-client` becomes the one obvious place any *future*
  app (HomeTasks, HomeMonitor) plugs into identity, instead of writing a
  fourth-then-fifth copy of the same client.
- HomeVault's threat model (`docs/SECURITY.md` Part B) explicitly lists a real
  permission-enforcement pass as a prerequisite for anything beyond
  HomeCloud/HomeMedia/HomeSync's current owner-only checks — a real
  HomeCore service with its own clean API surface is a meaningfully
  better place to build that than the current merged process.
