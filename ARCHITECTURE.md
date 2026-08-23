# Architecture

Condensed from `HOME_MASTER_SPECIFICATION.md` (the original product/
architecture brief) and `HOME_LAYERING_ARCHITECTURE.md` (the rulebook that
formalized how modules are allowed to depend on each other, written after
real evidence showed what happens without one). Where the two agreed, this
keeps one copy. Corrected against the actual repo — see callouts marked
**[current state]**.

## 1. The vision

Build a coherent, self-hosted personal/family software ecosystem called
**Home** — not a pile of unrelated web apps that happen to share a login.
At the center is **HomeCore**, a shared platform providing identity,
sessions, permissions, an application registry, and an event bus.
Individual products (HomeCloud, HomeMedia, HomeSync, and future ones)
consume those capabilities instead of reinventing them.

> Build the infrastructure once, then build applications on top of it.

## 2. Product principles

1. **Self-hosted first.** The user owns the server, data, and accounts.
   The system works on a local network with no third-party cloud
   dependency; internet access is optional (remote access, updates).
2. **One ecosystem, not duplicated apps.** No second user database for
   HomeMedia, no second file store for HomeNotes, no second notification
   system for HomeTasks. Everything routes through HomeCore.
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

The shared platform. Not necessarily its own website — v0 lives embedded
inside HomeCloud's backend process (see §6).

Planned responsibilities: identity (users, sessions, 2FA, recovery),
authorization (roles, permissions, ownership), storage abstractions
(files, folders, quotas), events (activity feed, notifications), the
application registry (install/enable/health), and system health.

**Database tables** (implemented, prefixed `hc_` to avoid colliding with
HomeCloud's own tables since they currently share one SQLite file):
`hc_applications`, `hc_permissions`, `hc_application_permissions`,
`hc_activity_events`, `hc_notifications`, `hc_sessions`.

**[current state]** Three applications are actually registered:
`homecloud`, `homemedia`, `homesync` (seeded in `backend/src/homecore/
seed.js` on every startup). HomeVault, HomeNotes, HomeTasks, HomeMonitor,
and HomeAI are **not** registered — they don't exist yet.

## 4. The three-tier layering rule

Two pieces of real evidence shaped this, not just theory:

- **What went right:** `homemedia-backend` and `homesync-backend` were
  built independently and both arrived at the same discipline without
  being told twice — no identity or database of their own for anything
  HomeCloud already owns, every request authenticated by asking HomeCloud,
  every file byte actually stored by HomeCloud. Strong evidence the
  underlying idea holds up in practice, not just on paper.
- **What went wrong, and why it's instructive:** the gateway was dropped
  entirely for a period — each app ended up back on its own directly
  published port, and single-login stopped working. Nobody removed it on
  purpose; it was cross-cutting infrastructure with no single app owning
  it, so it quietly fell out when different sessions worked on different
  apps in parallel. **[current state]** The gateway has since been
  restored (see §5) — this is exactly the failure mode the tier rule
  below exists to prevent from recurring.

Two layers ("independent" vs. "interactive") turned out not to be quite
enough — HomeMedia has no independent existence without HomeCloud by
design (§12's whole premise is referencing HomeCloud's files), so it
isn't "fully standalone" *or* "an optional bridge." Three tiers instead:

```
Tier 0 — Foundation
  HomeCore (identity, sessions, permissions, app registry, event bus)
  + the gateway / TLS termination
  Nobody's app. Everyone depends on it. Not modified by an app-building
  session — only registered against.

Tier 1 — Independent apps
  HomeCloud, HomeMedia, HomeSync, (future: HomeNotes, HomeTasks,
  HomeMonitor, HomeVault)
  Each has its own database, own process, own deploy. May declare a
  small number of HARD dependencies on another app's STABLE PUBLIC API
  (never its database) — HomeMedia → HomeCloud is the one that exists
  today. Contains ZERO optional/enhancement cross-app behavior.

Tier 2 — HomeBridge
  One separate, optional service (not yet built). Contains every
  optional cross-app behavior — see ROADMAP.md. Detects which apps are
  present via Tier 0's registry and activates only the bridges whose
  required apps are actually there. If it's stopped or never installed,
  every Tier 1 app keeps working exactly as if it never existed.
```

**Why the gateway is Tier 0, not Tier 2:** it's tempting to file it under
"the thing that connects apps," but it doesn't act on app data — it just
routes requests and (eventually) terminates TLS. It's infrastructure every
app needs to be reachable at all, same category as HomeCore.

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

**HomeBridge's own open question — not yet decided:** most bridges react
to a live request that already carries a user's token. Some won't (a
scheduled check firing with nobody browsing) and will need to call
another app's API *as* a user with nothing to forward. Two options, not
yet chosen: (A) a scoped service credential HomeCore mints for HomeBridge,
recognized for a narrow allow-list of actions; (B) small
shared-secret-authenticated `/internal/...` endpoints on each Tier 1 app.
(A) is favored — one new concept in one place (HomeCore) instead of a
second trust mechanism repeated in every app — but this needs a real
decision before HomeBridge's first background-triggered bridge is built.

## 5. The gateway

**[current state — restored]** A single public entry point
(`gateway/nginx.conf`, published at container port 8080) that puts Home,
HomeCloud, HomeMedia, and HomeSync behind one browser origin, which is
what makes shared login real — every frontend reads/writes the same
`homecloud_token` key in `localStorage`, and that only works same-origin.

Routing, as actually implemented:

| Path | Goes to |
|---|---|
| `/` | Home (the dashboard) |
| `/cloud/` | HomeCloud's frontend |
| `/media/` | HomeMedia's frontend |
| `/sync/` | HomeSync's plain info page (no real UI — it's the Android app) |
| `/api/homemedia/` | HomeMedia's backend |
| `/api/homesync/` | HomeSync's backend |
| `/api/` | The shared HomeCloud/HomeCore backend (catch-all, must stay registered after the two more specific rules above) |

Every other Tier 1 service now uses `expose` (internal-only) instead of
`ports` in `docker-compose.yml` — only the gateway publishes a host port.
**TLS is still not terminated anywhere in this chain** — see
`SECURITY.md` for why that's a blocking prerequisite before this is used
for anything beyond a trusted home LAN.

## 6. Known, deliberate v0 shortcuts

Worth naming explicitly so they don't get "fixed" by accident later
without the context of why they were made:

- **HomeCore lives embedded in HomeCloud's backend**, not as its own
  service. Reasonable for v0 — extracting it is real future work, not a
  bug.
- **HomeMedia and HomeSync's registry entries are pre-seeded** by
  HomeCloud's own startup code (`seed.js`), rather than through a real
  admin-driven install flow. Works because it's one more `INSERT OR
  IGNORE` in the same seeding step — not a pattern to keep copy-pasting
  for every future app without reconsidering it.
- **HomeCloud's file authorization is strictly owner-only** — no shared
  files, no shared folders yet. This will block any genuinely multi-user
  feature (a shared album, a shared life-event bundle) until solved once
  at the HomeCore/HomeCloud layer.
- **Permission enforcement is declarative, not enforced.** Applications
  declare what permissions they'd use in their manifest, but no code path
  currently checks a permission before granting access to another
  app's resource. This matters more than it sounds — see
  `SECURITY.md` §"sibling application overreach."

## 7. Development phases (as originally planned)

0. Architecture — specs, conventions, design system. *(done)*
1. Stabilize HomeCloud — remove crashes, add tests, security baseline.
   *(done)*
2. Introduce HomeCore internally — extract identity/permissions/events
   from HomeCloud. *(done, embedded)*
3. Build Home against HomeCore. *(done)*
4. Build HomeSync (Android backup client). *(backend done; Android app
   incomplete — see SERVICES.md)*
5. Build HomeMedia. *(done)*
6. HomeNotes / HomeTasks. *(not started)*
7. HomeMonitor. *(not started)*
8. HomeVault — dedicated security design before any code. *(design done,
   no code — see SECURITY.md)*
9. HomeAI — only after permission enforcement is reliable. *(not
   started; explicitly blocked on the enforcement gap in §6 above)*

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
                               │ HomeCore  │   Identity · Storage · Events
                               │           │   Auth · ACL · Audit · Notify
                               └─────┬─────┘
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
                HomeSync         HomeVault         HomeAI
```

The end state isn't "a collection of apps" — it's meant to feel like a
private digital environment the user owns and operates, where a new
application only has to say "I need a user, storage, permissions,
notifications, and events" and HomeCore provides them.
