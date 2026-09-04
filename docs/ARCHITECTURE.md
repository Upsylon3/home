# Architecture

> **A note on section references in code comments:** many comments across
> this codebase cite specific sections of `HOME_MASTER_SPECIFICATION.md`
> and `HOME_ARTISTIC_DIRECTION.md` (e.g. "per §7.6"). **Neither file
> exists anywhere in this repository.** If you have copies of these from
> elsewhere, add them at the repo root — 25 files across `homecore/`,
> several `apps/*`, and `docs/` reference them. If not, the comments are
> still meaningful as written (they describe how the current code
> behaves and why), just not independently checkable against a numbered
> source. This document reflects the actual code, verified directly —
> not those two files, which this pass never had access to.

## 1. The vision

Build a coherent, self-hosted personal/family software ecosystem called
**Home** — not a pile of unrelated web apps that happen to share a login.
At the center is **HomeCore**, a shared platform providing identity,
sessions, permissions, an application registry, and an event bus.
Individual products (HomeCloud, HomeMedia, HomeSync, HomeNotes, and
future ones) consume those capabilities instead of reinventing them.

> Build the infrastructure once, then build applications on top of it.

## 2. Product principles

1. **Self-hosted first.** The user owns the server, data, and accounts.
   The system works on a local network with no third-party cloud
   dependency; internet access is optional (remote access, updates).
2. **One ecosystem, not duplicated apps.** No second user database for
   HomeMedia, no second file store for HomeNotes, no second notification
   system for a future HomeTasks. Everything routes through HomeCore.
3. **Modular.** Running only HomeCloud should work fine. Installing
   HomeMedia later shouldn't require rebuilding HomeCloud.
4. **Graceful degradation.** If HomeMedia is offline, Home still loads —
   it shows HomeMedia as unavailable instead of breaking.
5. **Secure by default.** Authorization lives server-side. Frontend
   hiding is never treated as security.
6. **Mobile is first-class**, not a shrunk desktop layout.
7. **Understandable and maintainable.** A modular monolith first;
   split into separate services only when there's a concrete reason —
   not because microservices are common elsewhere.

## 3. HomeCore

The shared platform: identity (users, sessions, 2FA, recovery),
authorization (roles, permissions, ownership), events (activity feed,
notifications), the application registry (install/enable/health), and
system health. A real, separate service (`homecore/`) — own process, own
database, own deploy. File/folder/share storage is deliberately *not*
one of HomeCore's responsibilities; that's `apps/homecloud-backend`'s
job, a Tier 1 app like any other, which happens to be the one every
other Tier 1 app currently has a hard dependency on (see §4).

**Database tables** (prefixed `hc_`): `hc_applications`,
`hc_permissions`, `hc_application_permissions`, `hc_activity_events`,
`hc_notifications`, `hc_sessions`.

Four applications are registered today: `homecloud`, `homemedia`,
`homesync`, `homenotes` — pre-seeded by HomeCore's own startup code (see
§6 on why this is a shortcut worth reconsidering before adding a fifth).
HomeVault, HomeTasks, HomeMonitor, and HomeAI are not registered — they
don't exist yet.

## 4. The three-tier layering rule

Two layers ("independent" vs. "interactive") turn out not to be quite
enough — HomeMedia has no independent existence without HomeCloud by
design (it exists to browse HomeCloud's own files), so it isn't "fully
standalone" *or* "an optional bridge." Three tiers instead:

```
Tier 0 — Foundation
  HomeCore (identity, sessions, permissions, app registry, event bus)
  + the gateway / TLS termination
  Nobody's app. Everyone depends on it. Not modified by an app-building
  change — only registered against.

Tier 1 — Independent apps
  HomeCloud, HomeMedia, HomeSync, HomeNotes (future: HomeTasks,
  HomeMonitor, HomeVault)
  Each has its own database, own process, own deploy. May declare a
  small number of HARD dependencies on another app's STABLE PUBLIC API
  (never its database) — HomeMedia, HomeSync, and HomeNotes each declare
  exactly one: HomeCloud's file-storage API (apps/homecloud-backend).
  Contains ZERO optional/enhancement cross-app behavior.

Tier 2 — HomeBridge
  One separate, optional service (not yet built). Contains every
  optional cross-app behavior — see ROADMAP.md. Detects which apps are
  present via Tier 0's registry and activates only the bridges whose
  required apps are actually there. If it's stopped or never installed,
  every Tier 1 app keeps working exactly as if it never existed.
```

**Why the gateway is Tier 0, not Tier 2:** it's tempting to file it under
"the thing that connects apps," but it doesn't act on app data — it just
routes requests and (eventually) terminates TLS. It's infrastructure
every app needs to be reachable at all, same category as HomeCore.

**The rule, for anyone building a Tier 1 app:**
- Own database, own process. Call HomeCore's APIs freely (that's Tier 0).
- Call at most one other app's *stable public API*, only as a declared,
  deliberate hard dependency — never discovered by writing the
  integration first and justifying it after.
- May **emit** events to the shared bus, fire-and-forget — your app must
  work identically whether anything is listening or not.
- Never branch on whether another Tier 1 app is installed. "If HomeTasks
  is installed, also create a task" is a Tier 2 concern, full stop, even
  if it looks like two lines to add directly.
- Must be fully functional with every other Tier 1 app and HomeBridge
  absent.

**HomeBridge's background-trigger auth — decided:** most bridges react
to a live request that already carries a user's token. Some won't (a
scheduled check firing with nobody browsing) and will need to call
another app's API *as* a user with nothing to forward. **Decided: a
scoped service credential HomeCore mints for HomeBridge**, recognized
for a narrow allow-list of actions — one new concept in one place,
instead of a second trust mechanism (shared-secret `/internal/...`
endpoints) repeated in every app. Not yet implemented — this is the
design to build against once HomeBridge's first scheduled bridge is
started.

## 5. The gateway

A single public entry point (`gateway/nginx.conf`, published at
container port 8080) that puts every frontend behind one browser origin,
which is what makes shared login real — every frontend reads/writes the
same `homecloud_token` key in `localStorage`, and that only works
same-origin.

Routing, as implemented:

| Path | Goes to |
|---|---|
| `/` | Home (the dashboard) |
| `/cloud/` | HomeCloud's frontend |
| `/media/` | HomeMedia's frontend |
| `/notes/` | HomeNotes' frontend |
| `/sync/` | HomeSync's plain info page (no real UI — the Android app is the actual client) |
| `/api/homemedia/` | HomeMedia's backend |
| `/api/homesync/` | HomeSync's backend |
| `/api/homenotes/` | HomeNotes' backend |
| `/api/homecloud/` | HomeCloud's backend (`apps/homecloud-backend`) |
| `/api/share/` | HomeCloud's backend too — deliberately unprefixed and outside `requireAuth` (a share link has to work for someone with no account at all); see `apps/homecloud-backend/src/publicShare.js` |
| `/api/` | HomeCore (catch-all — identity, admin, activity, the application registry; must stay registered after every more specific rule above) |

Every Tier 1 service uses `expose` (internal-only) instead of `ports` in
`docker-compose.yml` — only the gateway publishes a host port. **TLS is
not terminated anywhere in this chain** — see `SECURITY.md` for why
that's a blocking prerequisite before this is used for anything beyond a
trusted home LAN.

## 6. Known limitations

Worth naming explicitly so they don't get "fixed" by accident without
understanding why they're this way, or ignored until they cause a real
problem:

- **Every app's registry entry is pre-seeded** by HomeCore's startup code
  (`homecore/src/homecore/seed.js`), rather than through a real
  admin-driven install flow. Works because it's one more `INSERT OR
  IGNORE` in the same seeding step — not a pattern to keep copy-pasting
  for every future app without reconsidering it. A real "install an
  application" flow (discover → install → register → enable) is real
  future work.
- **HomeCloud's file authorization is strictly owner-only** — no shared
  files, no shared folders yet. This blocks any genuinely multi-user
  feature (a shared album, a shared life-event bundle). **Decided:**
  deliberately punted rather than designed speculatively — share
  *links* already cover the common "give one person one thing" case;
  real multi-user ACLs wait until a specific feature actually needs
  them.
- **Permission enforcement is declarative, not enforced.** Applications
  declare what permissions they'd use in their manifest, but no code
  path currently checks a permission before granting access to another
  app's resource. See `SECURITY.md`'s "sibling application overreach"
  and its decision to defer this until HomeVault needs it.
- **No account-deletion flow exists, only disable — decided permanent,**
  not a gap waiting to be filled. Building real cross-service deletion
  (there's no foreign key across the separate databases to cascade
  automatically) was judged not worth the complexity for a personal/
  family server; disable is considered the correct, permanent answer.
  An admin with direct database access can still manually purge a
  disabled account's data if truly necessary.
- **Shared secrets between services** (e.g. `HOMECORE_INTERNAL_SECRET`,
  read by `apps/homecloud-backend` directly from `homecore/.env`) are
  kept simple on purpose — no root-level shared `.env`, no secrets
  manager. Fine at this scale; revisit if it becomes a real operational
  annoyance, not before.

## 7. Status by application

| App | Status |
|---|---|
| HomeCore | Built |
| Home | Built |
| HomeCloud | Built |
| HomeMedia | Built |
| HomeNotes | Built |
| HomeSync backend | Built and tested |
| HomeSync Android app | Written, not yet build-verified — see `docs/DEVELOPMENT.md` |
| HomeVault | Threat model designed (`docs/SECURITY.md`), no code |
| HomeTasks, HomeMonitor, HomeAI, HomeBridge | Not started |

## 8. Future ecosystem map

```
                              ┌──────────────┐
                              │     HOME     │
                              └──────┬───────┘
       ┌──────────────┬──────────────┼──────────────┬──────────────┐
       ▼              ▼              ▼              ▼              ▼
  HomeCloud       HomeMedia      HomeNotes      HomeTasks      HomeMonitor
       └──────────────┴──────────────┼──────────────┴──────────────┘
                               ┌─────▼─────┐
                               │ HomeCore  │   Identity · Registry · Events
                               │           │   Auth · Permissions · Audit · Notify
                               └─────┬─────┘
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
                HomeSync         HomeVault         HomeAI
```

The end state isn't "a collection of apps" — it's meant to feel like a
private digital environment the user owns and operates, where a new
application only has to say "I need a user, storage, permissions,
notifications, and events" and HomeCore provides them.
