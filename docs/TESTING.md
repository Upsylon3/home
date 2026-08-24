# Testing

## Current results — verified by actually running each suite

| Service | Suite | Result |
|---|---|---|
| HomeCloud backend (+ embedded HomeCore) | `backend/test/` — `npm test` | **63 / 63 passing** |
| HomeMedia backend | `homemedia-backend/test/` — `npm test` | **18 / 18 passing** |
| HomeSync backend | `homesync-backend/test/` — `npm test` | **20 / 20 passing** |
| HomeSync Android (`SyncLogic.kt` only) | `SyncLogicTest.kt`, run via `kotlinc`/JUnit outside Gradle | 7 tests present and structurally sound; not re-run in this pass (no Kotlin toolchain available), but statically confirmed to match what earlier docs claimed |
| HomeSync Android (everything else) | — | **Cannot run** — see `SERVICES.md#homesync` for the missing `data` package that blocks a build entirely |

**101 automated backend-side tests, run and confirmed passing.** All three
backends use Node's built-in test runner (`node --test`) — no extra
test-framework dependency — and each test file gets its own fresh,
isolated temp SQLite database. Earlier drafts of this project's docs
quoted slightly different numbers (60/61, 17/20) for these same suites;
the counts above are current as of this pass, not carried forward from
an older claim.

Run any suite yourself:
```bash
cd backend && npm install && npm test
cd homemedia-backend && npm install && npm test
cd homesync-backend && npm install && npm test
```

## Test strategy (per the master spec's §36, applied)

Every application should have four layers:

- **Unit tests** — business logic, permission checks, validation,
  transformations. Pure functions especially (e.g. HomeSync's
  `pathPlanner.js`, its dedup-planning logic) deserve full coverage
  since they're easy to get subtly wrong and hard to notice when they
  are.
- **API tests** — auth, authorization, successful requests, invalid
  input, unauthorized requests, ownership violations.
- **Integration tests** — database, storage, event flow, application
  registration. HomeMedia's and HomeSync's suites do this properly: real
  requests against a real, isolated HomeCloud test instance, not a mock
  standing in for one.
- **End-to-end tests** — the full user-facing sequence. For the core
  file flow: register → login → create folder → upload → view → download
  → share → delete → restore → logout.

## HomeSync-specific test plan (condensed from `HOMESYNC_TEST_PLAN.md`)

The spec's own required end-to-end sequence for HomeSync is: **discover
file → queue upload → upload → retry → resume → deduplicate → complete.**
What each stage needs to prove, beyond the obvious happy path:

- **Discover:** a new photo/screenshot/video is picked up without
  opening the app; a file in an unwatched folder is correctly ignored.
- **Queue:** a file discovered while Wi-Fi-only is on and only cellular
  is available sits **queued, not started** — same shape for
  charging-only. Queue state survives the app being killed before upload
  starts.
- **Retry:** a transient network blip or server 5xx retries
  automatically, without user intervention; an auth token expiring
  mid-queue re-authenticates and continues rather than failing every
  remaining item.
- **Resume — needs a decision before it can be properly tested:** does
  "resume" mean whole-file retry (matches the current design — see
  `SERVICES.md`'s "deliberately deferred" note on resumable upload) or
  true byte-range resumption? The test shape differs completely depending
  on the answer, so this is worth deciding explicitly rather than
  assuming one.
- **Deduplicate:** content-hash based, **not filename-based** — an
  edited copy saved under a new name is genuinely new content and must
  upload; the same bytes rediscovered under any name must not. Test both
  directions explicitly; it's easy to accidentally build one that only
  catches the filename case. Also worth testing: reinstalling the app
  entirely and re-scanning the same phone must not re-upload files
  already on HomeCloud from before the reinstall.
- **Complete:** backup history entry recorded with correct file
  count/size; a real notification fires through HomeCore's centralized
  system, not a local-only Android notification Home's dashboard never
  learns about.

**Android-specific realities, not from the spec but unavoidable for any
background-upload app:** Doze mode and OEM-specific battery optimization
(Samsung/Xiaomi are notably more aggressive than stock Android at killing
background work) are the most common real-world reason a backup app "just
stops working." Test on at least one close-to-stock device and one
heavily customized OEM device, not just an emulator. Scoped storage
(Android 10+) and the split media permissions (Android 13+) both need
testing across the versions they were introduced in, not just "current."

**Explicit non-goals for HomeSync testing:** restoring from HomeCloud
back to a phone (one-directional by design), multi-account switching on
one device, conflict resolution (no sync conflicts exist in a
one-directional upload), and load/scale testing beyond personal
household use.

## Definition of done (per the spec's §37)

Every application needs, not just a working happy path: loading state,
empty state, error state, offline/unavailable state, mobile + desktop
layout, keyboard support where relevant, auth, authorization, validation,
logging, a health endpoint, a version, documentation, backup
considerations, a migration strategy, and defined uninstall/data-retention
behavior. For HomeSync specifically: **uninstalling the app must never
delete anything already backed up to HomeCloud** — it's a one-way upload
client, and this is exactly the kind of mistake that's easy to make via
an over-eager "clear my data" feature and catastrophic if made.
