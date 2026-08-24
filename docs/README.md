# Home ecosystem — documentation

This folder replaces the scattered set of planning docs written across
earlier iterations (a master spec, a threat model, an artistic direction
doc, a test plan, a brainstorm, a layering rulebook, an icon-system readme,
and a setup guide from a parallel branch). Same information, reorganized
into fewer files, deduplicated, and checked line-by-line against the
actual repository as of the **gateway-restored** branch — not against
memory of what was supposed to be true.

## Map

| File | What's in it |
|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | The vision, HomeCore, the three-tier layering rule (Tier 0/1/2), the gateway, product roadmap phases |
| **[SETUP.md](./SETUP.md)** | Installing and running the stack — Docker, manual, and the setup scripts (corrected for the gateway) |
| **[SERVICES.md](./SERVICES.md)** | What's actually built, per service — HomeCloud, Home, HomeMedia, HomeSync, HomeCore, and what's still just a plan |
| **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** | Concepts primer, code tour, API reference, glossary |
| **[SECURITY.md](./SECURITY.md)** | What's actually protecting the app today, plus HomeVault's not-yet-built threat model |
| **[TESTING.md](./TESTING.md)** | Test strategy and current, verified test results |
| **[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)** | Visual/artistic direction, and the status of the icon set |
| **[ROADMAP.md](./ROADMAP.md)** | Cross-module ideas brainstorm and the deferred-features backlog |

## Current status, at a glance

*(Verified directly against the repo — see each linked doc for detail and
for how each number was checked.)*

**Built and running**, wired into `docker-compose.yml`:
- **HomeCore** — identity, sessions, permissions, app registry, activity
  feed, notifications. Not a separate service yet — lives embedded inside
  HomeCloud's backend process (a deliberate, documented v0 shortcut).
- **HomeCloud** — file storage, folders, sharing, 2FA, admin panel. The
  stable foundation everything else builds on.
- **Home** — the dashboard/launcher frontend.
- **HomeMedia** — photo/video library, its own backend + database,
  references HomeCloud's files rather than copying them.
- **HomeSync backend** — the API the Android app talks to for phone
  backup. Fully built and tested on the server side.
- **Gateway** — a single public entry point (`:8080`) that puts Home,
  HomeCloud, HomeMedia, and HomeSync behind one origin, restoring the
  shared-login setup after it was previously dropped. TLS is **not**
  wired up yet — see [SECURITY.md](./SECURITY.md).
- **Backup service** — nightly snapshot of the data volume.

**Automated tests, currently passing:** 63 (HomeCloud backend) + 18
(HomeMedia backend) + 20 (HomeSync backend) = **101**, run and confirmed
directly, not taken from an older doc's word. See
[TESTING.md](./TESTING.md).

**Built but not verified to run:**
- **HomeSync's Android app** — the sync/hashing logic (`SyncLogic.kt`) is
  written with zero Android dependencies and its 7 unit tests are
  confirmed present and structured correctly. The rest of the app (UI,
  WorkManager, the data layer) has **never been compiled** — no Android
  SDK in any environment that's touched this code so far. More
  importantly, several files (`BackupWorker.kt`, `HomeViewModel.kt`,
  `LoginViewModel.kt`, `HomeSyncApplication.kt`) import a `data` package
  (`ApiClient`, `HomeSyncApi`, `SessionManager`, `SettingsStore`,
  `AppDatabase`, `SyncedMediaDao`, `SyncedMediaEntity`, and several
  request/response classes) that **does not exist anywhere in the
  repository**. As checked in, this module will not compile — this is a
  real gap, not a documentation nitpick, and it supersedes the more
  optimistic "should build, just untested" framing in earlier docs. See
  [SERVICES.md](./SERVICES.md#homesync).

**Not built at all — design/plan only:**
- **HomeVault** — has a full security design and threat model (see
  [SECURITY.md](./SECURITY.md)) but zero code in the repository.
- **HomeNotes, HomeTasks, HomeMonitor, HomeAI, HomeBridge** — named in the
  roadmap, nothing built.
- **The icon system** (9 app icons + wordmark, described in an earlier
  standalone doc) was designed in a separate session and **was never
  added to this repository** — no `icons/`, `wordmark/`, or `preview.html`
  exist anywhere in it. `homecore/seed.js` already references icon paths
  like `/icons/homecloud.svg` that don't exist on disk; Home's and
  HomeMedia's own frontends ship no icon files at all yet (only
  HomeCloud's frontend has real PWA icon PNGs). See
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

**A documentation/tooling mismatch worth knowing about:** a separate
branch added `setup.sh` / `setup.ps1` / a `SETUP_GUIDE.md` to automate
first-time setup. Those were written **before** the gateway was restored,
back when each app published its own port (`8080`/`8081`/`8082`/`8083`)
and a `LAN_IP` build variable filled in three separate frontend URLs.
`docker-compose.yml` in this branch no longer does either of those things
— everything is hardcoded to `http://localhost:8080/...` and only the
gateway's port is published. The scripts' secret-generation and
Docker-readiness checks are still correct and useful; their final
"here's where to open it" printout is not. Corrected instructions are in
[SETUP.md](./SETUP.md); the scripts themselves still need a small patch
to match (tracked in [ROADMAP.md](./ROADMAP.md)).

## What didn't move here

The repository's own root `README.md` (the long beginner's-guide-plus-API-
reference-plus-build-log that lives next to the code) stays where it is —
that's a living document meant to travel with the code, not a planning
artifact. This folder complements it: `DEVELOPER_GUIDE.md` here is a
condensed version of its concepts/reference material, and `SERVICES.md`
condenses its "Building HomeMedia" / "Building HomeSync" sections with the
verified current numbers. If the two ever disagree, trust whichever one a
person most recently corrected against the actual repo — and preferably
fix the other one to match.
