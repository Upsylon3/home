# Architecture

> **A note on section references in code comments:** `HOME_MASTER_SPECIFICATION.md`
> and `HOME_ARTISTIC_DIRECTION.md` — cited throughout the codebase as
> "per §N" — are now both present at the repo root. Cross-checking a
> sample of citations found a historical §10 route-nesting deviation.
> Core now exposes `/api/core/auth` and `/api/core/admin`, while retaining
> the original top-level prefixes as compatible aliases. The personal
> HomeCloud feed has the explicit `/api/core/activity/homecloud` path;
> existing cross-app `/api/core/activity` and `/activity/me` keep their
> different audiences and response shapes. Shared router instances preserve
> sessions, authorization and rate-limit budgets across prefixes. See
> `API.md` for the additive migration and compatibility policy.
> This document itself reflects the actual code, verified directly
> against both the spec and the implementation, not just one or the
> other.

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
`hc_notifications`, `hc_sessions`, `hc_delegation_grants`,
`hc_delegation_credentials`.

Seven applications are registered today: `homecloud`, `homemedia`,
`homesync`, `homenotes`, `hometasks`, `homemonitor`, `homevault` — pre-seeded by HomeCore's own
startup code (see §6). This is exactly the "before adding a fifth"
point earlier notes on this shortcut flagged for reconsidering — the
pattern still held up fine at this scale (one more `INSERT OR IGNORE`
function, no real complexity added), so it stayed. A sixth application
is a reasonable point to actually build the real admin-driven install
flow instead of extending this further. HomeAI is not registered — it
doesn't exist yet.

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
  HomeCloud, HomeMedia, HomeSync, HomeNotes, HomeTasks, HomeMonitor,
  HomeVault
  Each has its own database, own process, own deploy. May declare a
  small number of HARD dependencies on another app's STABLE PUBLIC API
  (never its database) — HomeMedia, HomeSync, and HomeNotes each declare
  exactly one: HomeCloud's file-storage API (apps/homecloud-backend).
  HomeVault declares zero — the first app with no dependency on
  HomeCloud at all, since it stores only its own encrypted blobs (see
  §3's database-tables note). "May declare" always meant zero-or-more,
  not exactly-one; HomeVault is just the first app to actually be at
  zero.
  Contains ZERO optional/enhancement cross-app behavior.

Tier 2 — HomeBridge
  One separate, optional service. Live Notes/Tasks search through Home's /search
  remains stateless. Explicitly configured automation owns a separate database
  for encrypted operational credentials/intents and rule/receipt metadata. Contains every
  optional cross-app behavior — see ROADMAP.md. Detects which apps are
  present via Tier 0's registry and activates only the bridges whose
  required apps are actually there. If it's stopped or never installed,
  every Tier 1 app keeps working exactly as if it never existed.
```

HomeBridge v0 runs under the opt-in Compose `bridge` profile. It forwards only
the live user's bearer token to selected, enabled sources' public APIs; it
never opens a sibling database. Its fixed upstream origins come from operator
configuration, not registry URLs. Partial failures remain visible alongside
successful results. See [decision 001](decisions/001-homebridge-search.md) for
scope, privacy, limits and opt-out. Home hosts the client; Tier 1 apps have no
HomeBridge detection or cross-app calls.

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
endpoints) repeated in every app. Core now implements the authority and
separate shared verifier; Monitor/Tasks implement narrow action consumers.
HomeBridge now implements the opt-in worker and owner controls.

The first scheduled scope is now recorded in
[decision 002](decisions/002-scheduled-monitor-followup.md): persistent critical
Monitor alerts become the consenting administrator's personal follow-up
tasks. Two audience-bound capabilities cover only a curated alert read and
create-once task action. Core issues hash-only, 30-day, account-bound grants
with live revocation and private server-to-server mint/renew routes. Browser
session middleware remains separate. Monitor owns stable incident identity,
evaluation freshness and notification retry intent; Tasks owns durable
create-once receipts and transactional daily limits. Both expose only scoped
own-resource APIs and contain no Bridge detection or alert-to-task mapping.
Bridge's opt-in worker owns qualification, encrypted canonical delivery intent,
source pinning and the alert-to-task mapping. Home Settings provides explicit
consent, renewal/confirmation, disable and independent Core revocation. Core
also permits a credential to irreversibly surrender only its own grant so
pending revocation survives restart without a browser token. Live search still
uses only the current user session and starts without automation storage/key.

## 5. The gateway

A single public entry point (`gateway/nginx.conf`, published at
container port 8080) that puts every frontend behind one browser origin.

**Shared login (fixed in 1.9.0):** the single origin only makes a shared
login *possible* — browsers share `localStorage` per origin, so every
frontend has to read and write the same key, and for a long time they
didn't. An earlier correction in this section recorded that each app kept
its own key (`home_token`, `homecloud_token`, `homemedia_token`,
`homenotes_token`, `homevault_token`) and so each independently prompted
for login. That was the cause of "I have to sign in to every app" even
with the gateway in place. All five now go through one module,
`design/session.js` (copied to each app's `src/session.js` by
`design/sync-assets.sh`), which uses the single key `home_session_token`.
Signing in to any app signs you in to all of them; signing out of one
signs out of all. On first load after the upgrade, an existing per-app
token is adopted and the old keys are deleted, so nobody is logged out by
the change. There is still no cookie, no token forwarded on navigation
and no silent re-auth against HomeCore — it is one stored token, read by
every app. `hc_sessions` therefore records one session per sign-in
instead of one per app.

What the single origin also costs, as the direct flip side: one shared
*attack* surface. A same-origin script can read the token whatever the
key is called, which is exactly the premise behind `docs/SECURITY.md`'s
"Shared-origin XSS" threat-catalog entry — sharing the key changes
nothing about that.

Routing, as implemented:

| Path | Goes to |
|---|---|
| `/` | Home (the dashboard) |
| `/cloud/` | HomeCloud's frontend |
| `/media/` | HomeMedia's frontend |
| `/notes/` | HomeNotes' frontend |
| `/sync/` | HomeSync's plain info page (no real UI — the Android app is the actual client) |
| `/api/homemedia/` | HomeMedia's backend (its `/upload` and `/stream/` paths have their own rules with request/response buffering turned off, so big uploads and videos stream instead of being held in full by the gateway) |
| `/api/homesync/` | HomeSync's backend |
| `/api/homenotes/` | HomeNotes' backend |
| `/api/homebridge/` | Optional HomeBridge service (4900); offline JSON when the profile is absent |
| `/api/homecloud/` | HomeCloud's backend (`apps/homecloud-backend`) |
| `/api/share/` | HomeCloud's backend too — deliberately unprefixed and outside `requireAuth` (a share link has to work for someone with no account at all); see `apps/homecloud-backend/src/publicShare.js` |
| `/api/` | HomeCore (catch-all — identity, admin, activity, the application registry; must stay registered after every more specific rule above) |

**An app being down never takes the gateway down (1.13.0).** nginx used to
look up each app's container name once, at startup, and refuse to start if
any was missing. Now every location puts its upstream in a variable, so names
are looked up per request through Docker's DNS (`resolver 127.0.0.11`):
- The gateway starts with any app, or every app, stopped. The compose
  `depends_on` workaround is gone, and "run only HomeCloud" works
  (`docker compose up gateway home homecore homecloud homecloud-backend`).
- An app that starts later, or restarts with a new address, is found within
  about 10 seconds, with no gateway restart.
- A request for an app the gateway can't reach (nginx's own 502 or 504) gets
  a **503** with `Retry-After`: a small styled page naming the app for a
  frontend, `{"error": "HomeTasks is offline right now..."}` for an API. Only
  the gateway's own failures are rewritten: an app's own error answers (such as
  HomeCore's `503` "degraded" health check, which HomeMonitor reads) pass
  through untouched.
- Because a variable in `proxy_pass` can't strip a path prefix the old way,
  each prefixed frontend (`/tasks/`, `/cloud/`, ...) uses an explicit
  `rewrite ^/tasks/(.*)$ /$1 break;`. API locations keep the full path, as
  before.
- **Home's own container** (`apps/home/nginx.conf`) got the same treatment.
  It proxies two paths as a fallback, and those used to be looked up at
  startup, so the dashboard crash-looped whenever HomeCloud's backend or
  HomeCore was missing, and the gateway then reported "Home is offline". Every
  other app's container still needs its own backend to start, deliberately: an
  app is a frontend and a backend as a pair, and compose makes the frontend
  wait for its backend. They also still name `homecore` directly, since nothing
  works without HomeCore anyway (Tier 0).
- `gateway/test/gateway-smoke.sh` runs the real config in a real nginx against
  fake apps that start, crash and disappear, and does the same for Home's own
  container (98 checks; also run in CI).

**One Content-Security-Policy, sent here (1.14.0).** Every app shares this one
origin and one session token, so a script injected into any page could read the
token that opens all of them. The gateway therefore sends one policy on every
answer (`SECURITY.md`, "Shared-origin XSS"):
- Scripts only from the app's own origin, plus exactly one inline script, allowed
  by its sha256: the theme setter at the top of every `index.html`. Styles,
  fonts, images, media, workers and `fetch` are same-origin too (images and
  media also from `blob:`, which HomeMedia's `AuthImage` needs).
- No `<object>`, no frames, no `<base>` changes, forms submit only here, and
  nobody can put Home in an `<iframe>`.
- Only `/vault/` also gets `'wasm-unsafe-eval'`, chosen by a `map` in
  `nginx.conf`, because HomeVault's Argon2id runs as WebAssembly.
- It lives in the gateway, not in each app, because it is a decision about the
  whole origin; every backend's own `helmet` CSP is switched off for that reason.
- Editing the theme script changes its hash, and every app would then show a
  blank page. The smoke test recomputes the hash from the real files and fails
  first, printing the new value.
- The two "offline" answers carry their own smaller policies, because nginx drops
  the server-level header in a location that sets its own `add_header`.

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
- **Application-manifest permissions remain declarative for browser sessions.**
  The catalog has no caller-app identity or general grant enforcement model.
  Scoped background capabilities enforce their separate action/audience
  boundary; they do not turn the manifest catalog into browser-session ACLs.
  See `SECURITY.md`'s "sibling application overreach"
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
- **Registration UI is duplicated**: both `apps/homecloud/src/pages/Register.jsx`
  and `apps/home/src/pages/Register.jsx` implement the same form against
  the same `/api/auth/register` endpoint. Home's copy exists so a fresh
  local dev stack can be bootstrapped without starting HomeCloud's
  frontend too (see `docs/DEVELOPMENT.md`'s Windows launcher). A single
  account-creation flow living in HomeCore itself, that every frontend
  links to instead of reimplementing, would remove the duplication —
  worth doing if a third frontend ever wants its own "create account"
  link, not urgent before that.

## 7. Status by application

| App | Status |
|---|---|
| HomeCore | Built |
| Home | Built |
| HomeCloud | Built |
| HomeMedia | Built |
| HomeNotes | Built |
| HomeSync backend | Built and tested |
| HomeSync Android app | Written; builds and passes its unit tests in CI (`android.yml`), never run on a device — see `docs/DEVELOPMENT.md` |
| HomeVault | **v0 built** — core loop (create/unlock/recover a vault, add/view/edit/delete items) implemented and tested; **self-reviewed twice, not independently reviewed** — see `docs/SECURITY.md`'s "HomeVault v0" section before trusting it with anything real |
| HomeTasks | **Built**: backend and web app (Today / Upcoming / All / Done, projects, due dates, priorities, search, repeating tasks), tested; the web app was driven end to end in a headless browser. Reminders and assignment are deliberately not built yet, see `docs/ROADMAP.md` |
| HomeMonitor | **v0 built**: admin-only dashboard for CPU, memory, disk, each app's health, backup freshness and disk growth (with a rough "full in N days" forecast), plus alerts delivered as HomeCore notifications. Tier 1: it reads the app registry and posts notifications through two small new HomeCore endpoints, `GET /internal/apps` and `POST /internal/notifications` (shared-secret, machine to machine). No Docker socket, by design. Tested; the web app was driven in a headless browser against a real HomeCore, measuring the real machine |
| HomeBridge | **Built**: optional stateless Notes/Tasks search plus separately configured Monitor follow-up automation, encrypted operational state, owner consent/disable and direct Core revocation |
| HomeAI | Not started |

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
