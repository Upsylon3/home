# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning follows
[SemVer](https://semver.org/): one version number for the whole
ecosystem (see root `package.json`), bumped on any meaningful release.

## [Unreleased]

Added the two governing spec documents (`HOME_MASTER_SPECIFICATION.md`,
`HOME_ARTISTIC_DIRECTION.md`) to the repo root — previously cited by
section number throughout the codebase but absent from the repository
itself (flagged during the [1.0.0] cleanup). Cross-checked a sample of
citations against them: the implementation matches the spec's intent
everywhere checked, with one real, documented deviation — see
`docs/ARCHITECTURE.md`'s note and the new roadmap item on
`/api/auth`/`/api/admin`/`/api/activity` not being nested under
`/api/core` the way §10 suggests. Tightened `docs/SECURITY.md`'s
permission-enforcement note with the precise citation (§28, layer 3).

Resolved every open decision flagged during the [1.0.0] handoff cleanup
in one pass, so future work isn't blocked re-litigating them. No code
behavior changed; this is documentation plus one new file.

### Added
- `LICENSE` — proprietary, all rights reserved. Deliberately the most
  restrictive default (easy to relax later, hard to undo the other way).

### Fixed
- A moderate-severity `qs` advisory, pulled in transitively through
  every backend's `express`/`body-parser`, patched via an `overrides`
  pin rather than a breaking Express 5 upgrade — see root
  `package.json`'s comment. `npm audit`: 5 vulnerabilities → 1
  (moderate, dev-server-only — see below).

### Known, not fixed here
- `vite`/`esbuild`'s moderate dev-server advisory remains — fixing it
  needs `vite@8`, a breaking upgrade across all four frontends. Flagged
  in `docs/ROADMAP.md` and `docs/SECURITY.md` rather than forced through
  without dedicated testing time.

### Decided (see the linked doc for each; recorded so the reasoning isn't lost)
- Version stays 1.0.0.
- TLS: private overlay network (Tailscale/WireGuard) is the supported
  path to remote access, not a public reverse-proxy cert — `SECURITY.md`.
- HomeVault stays on the shared origin, hardened with a strict CSP,
  rather than a separate origin — `SECURITY.md`.
- HomeBridge's background-trigger auth: a scoped service credential
  HomeCore mints, not per-app shared-secret endpoints — `ARCHITECTURE.md`.
- Permission enforcement: deferred until HomeVault actually needs it,
  not built speculatively ahead of a consumer — `SECURITY.md`.
- Shared secrets between services stay as a shared `.env` file; no
  secrets manager introduced at this scale — `ARCHITECTURE.md`.
- Build order: HomeVault → HomeTasks → HomeBridge → HomeMonitor →
  HomeAI — `ROADMAP.md`.
- HomeCloud's owner-only file sharing stays as-is until a feature
  forces a real multi-user ACL model — `ARCHITECTURE.md`.
- Account deletion stays disable-only, permanently — no hard delete
  flow planned — `ARCHITECTURE.md`.
- Home's per-app dashboard stat stays hardcoded per app rather than a
  generic manifest field, for now.
- Design: the `#C99A3B` accent color and the current placeholder
  sans-serif typeface are both final, not pending a future pick —
  `DESIGN_SYSTEM.md`.
- HomeSync: whole-file retry (not chunked/resumable upload) and
  WorkManager's built-in battery constraint (not a numeric threshold)
  are both final designs, not gaps — `ROADMAP.md`.
- The still-missing `HOME_MASTER_SPECIFICATION.md` /
  `HOME_ARTISTIC_DIRECTION.md` remain an open item, not resolved here —
  `ARCHITECTURE.md`.

## [1.0.0] — Handoff cleanup pass

A full audit pass with no new features: verified every claim in the docs
against the actual code and test suites, fixed what didn't match, and
replaced the documentation set with a smaller, current-state-only one.

### Fixed
- HomeCloud, HomeMedia, and HomeNotes' frontends now pass `basename` to
  `<BrowserRouter>`. Without it, refreshing the page, opening a bookmark,
  or following a direct link to anything other than the app's exact root
  path (e.g. `/cloud/settings`) silently redirected to Home instead of
  loading the intended page.
- HomeCloud's service worker now registers at a base-aware path instead
  of a hardcoded `/sw.js`, which the gateway routed to Home, not
  HomeCloud — the service worker never actually activated.
- The gateway's `/sync/` route now targets `homesync-backend`'s real port
  (`4300`); it previously omitted the port entirely, which would 502.
- Fixed a leftover `[homecloud]` log-line prefix in three places inside
  `homecore/` (a service that has not been called "homecloud" since it
  was split out).
- `apps/homecloud-backend/.env` and its local database directory were
  missing from `.gitignore` — a real secret or local file/folder database
  could have been committed by accident. Added, and added the
  `.env.example` this service was missing entirely.

### Changed
- Renamed the env var/const `HOMECLOUD_URL` / `HOMECLOUD_INTERNAL_URL`
  (misleadingly named — it points at HomeCore, not HomeCloud) to
  `HOMECORE_URL` / `HOMECORE_INTERNAL_URL` everywhere, and the matching
  `homecloudUrl` health-check field to `homecoreUrl`.
- Renamed the Docker volume `homecloud_data` (it actually held HomeCore's
  database — a naming leftover from before the two were split into
  separate services) to `homecore_data`. Renamed HomeCore's own database
  file from `homecloud.db` to `homecore.db` for the same reason.
- Removed three dependencies (`sharp`, `multer`, `yazl`) from
  `homecore/package.json` — leftover from before file storage moved to
  `apps/homecloud-backend`; nothing in HomeCore imports them anymore.
- Rewrote every source comment that narrated the HomeCore/HomeCloud
  split as it happened ("Phase N of MIGRATION_PLAN.md") into a plain,
  present-tense description of how the code works now. The file being
  cited no longer exists (see Removed) and the narration made the
  reason for a design choice harder to find, not easier.
- Corrected four `package.json` `description` fields that described a
  transitional state that's since been completed (e.g. `homecore`'s said
  it "currently runs both HomeCore and HomeCloud's file-storage API in
  one process," which stopped being true once they were split).

### Removed
- `scripts/migrate-legacy-homecloud-data.js` and its Dockerfile, and the
  `migrate-legacy-data` Compose service — a one-time tool for moving data
  out of the pre-split, single-process layout. Not needed for a new
  deployment.
- `MIGRATION.md`, `MIGRATION_PLAN.md`, `VERSIONING.md` — process
  narrative from the HomeCore/HomeCloud split and early repo setup, both
  now finished. Full detail is preserved in git history for anyone who
  needs it; the architectural facts that are still true today live in
  `docs/ARCHITECTURE.md` instead.
- Root `README.md` and `docs/` were rewritten from scratch — see below.

### Documentation
- Replaced the ~1,600-line root `README.md` with a standard project
  README: what this is, quick start, project layout, and links out.
- Replaced `docs/` (previously nine files including a stale index) with:
  `ARCHITECTURE.md`, `SECURITY.md`, `API.md`, `DEVELOPMENT.md`,
  `DEPLOYMENT.md`, `DESIGN_SYSTEM.md`, and `ROADMAP.md` — each describing
  current, verified state, not the process of getting here.
- Added root `CONTRIBUTING.md`.
- **No `LICENSE` file exists in this repository.** That's a decision for
  whoever owns the project going forward, not something to guess at; see
  `README.md`.

## Earlier history (condensed)

The full detail for everything below is in git history and each
commit's own message. This is an orientation summary, not a ledger.

- **[0.9.x]** HomeCore and HomeCloud split into two genuinely separate
  services, each with its own process, database, and container —
  HomeCore now owns only identity/sessions/permissions/the app registry/
  the shared event feed; HomeCloud's files/folders/sharing moved to its
  own `apps/homecloud-backend`. The backup service was generalized to
  cover every app's volume instead of one hardcoded one.
- **[0.4.0]–[0.6.0]** `packages/homecore-client` extracted (the
  token-verification logic HomeMedia, HomeSync, and HomeNotes'
  backends each used to duplicate).
- **[0.2.0]–[0.3.0]** The icon set (9 app icons + wordmark) and HomeSync
  Android's networking/local-database layer, both previously designed
  but not present in the repository, were built out and integrated.
- **[0.1.0]** First git commit. Docker Compose project name pinned
  (`name: home`) to stop volumes silently changing across re-extracted
  copies of the repo; `.gitignore` updated to match the actual tree.
- **Before [0.1.0]** HomeCloud built and stabilized first (accounts,
  auth, 2FA, quotas, trash, sharing, admin panel). HomeCore introduced
  next, initially embedded in HomeCloud's own process. HomeMedia and
  HomeSync's backends built as genuinely separate services from the
  start. The gateway was introduced, accidentally dropped for a period
  during parallel work on different apps, then restored — the incident
  that motivated `docs/ARCHITECTURE.md`'s Tier 0/1/2 layering rule.
  HomeNotes was added as a fourth Tier 1 app.
