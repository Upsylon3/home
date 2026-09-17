# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning follows
[SemVer](https://semver.org/): one version number for the whole
ecosystem (see root `package.json`), bumped on any meaningful release.

## [1.1.3] — HomeVault: a deeper, adversarial self-review pass

No independent security/cryptography reviewer is available for this
project (see `docs/SECURITY.md`'s HomeVault status callout — that
remains the honest, unchanged bottom line). This is a second pass at
`apps/homevault/src/crypto.js` and the actual unlock/setup/recovery/
settings flows that's different in kind from the one that shipped with
[1.1.0]: not "does the code match the design doc" but deliberately
trying to find a way to break it, the way a real reviewer would start.

### Fixed
- **A mistyped recovery-key character was silently dropped rather than
  flagged.** `parseRecoveryKey` stripped anything outside its base32
  alphabet before decoding, so a single transcription error just
  produced a different, wrong 32-byte key — which safely failed to
  unwrap the vault (AES-GCM's own authentication tag still caught it;
  this was never a confidentiality issue), but with a generic "doesn't
  match this vault" message and no indication where the typo was, in
  exactly the flow that exists because the primary path already failed.
  Fixed by giving the recovery key format a trailing checksum character
  (CRC-8, deliberately non-cryptographic — its only job is catching an
  accidental typo before wasting an unwrap attempt, not resisting a
  deliberate attacker, who could trivially recompute it). A mistyped
  character now fails immediately with a distinct "Recovery key has a
  typo" message. 2 new tests
  (`apps/homevault/test/crypto.test.js`): a single flipped character is
  rejected before any unwrap is attempted, and a correctly-transcribed
  key (checksum included) still round-trips.
- **Copying the recovery key to the clipboard had no auto-clear.**
  Bitwarden and 1Password both clear the clipboard a short while after
  copying a credential, specifically because clipboard managers,
  clipboard history, and cross-device clipboard sync can otherwise keep
  an indefinitely-live copy of a key that can never be reissued if it
  leaks. Added a 30-second auto-clear (write an empty string,
  unconditionally, rather than reading the clipboard back first to
  check — avoids needing clipboard-read permission for this) to both
  places the recovery key can be copied (`Setup.jsx`, initial creation;
  `Settings.jsx`, regeneration), with a "Copied — clears in 30s" label
  so it's not a silent behavior change.
- A code comment in `crypto.js` described the "wrong password" verifier
  check backwards — "encrypting it and comparing the result," which
  would actually be broken given AES-GCM's random per-encryption IVs
  (the same plaintext encrypts to different ciphertext every time). The
  actual code was always correct — decrypt the stored verifier with the
  freshly-derived key and compare plaintext, relying on AES-GCM's own
  authentication tag to reject a wrong key before the comparison even
  matters. Fixed the comment to describe what the code actually does.

### Investigated, confirmed no issue
- No `Math.random()` anywhere in HomeVault's security-critical path —
  every salt, key, and IV goes through `crypto.getRandomValues` /
  `crypto.subtle.generateKey`.
- IVs are never caller-suppliable and are freshly generated per call;
  confirmed by tracing the actual encrypt call sites in `ItemDetail.jsx`
  that a title and its item data get independent IVs even within the
  same item, not just by reading the `encryptBytes` implementation and
  assuming callers use it correctly.
- Salt and KDF parameters are correctly persisted per-vault and passed
  in from stored server data on every unlock attempt, never
  regenerated locally (which would have permanently locked people out
  of their own vault).
- Recovery-key rotation exists (`Settings.jsx`) and correctly
  invalidates the previously-issued recovery key; the recovery key
  itself is never sent to or stored on the server, confirmed by
  checking the actual `api.vault.create()`/`rewrap()` payloads, not
  just the code that generates it.
- **A nuance worth recording, not a new hole**: the master- and
  recovery-wrapping keys are imported non-extractable
  (`importAesKeyRaw`), but the vault key itself has to stay extractable
  (`generateVaultKey`) so it can be re-wrapped under a new password or
  a new recovery key. Since the vault key is the one that actually
  matters, the non-extractable choice on the wrapping keys provides
  less real protection than it might look like — it doesn't change the
  already-documented "Shared-origin XSS" exposure in `docs/SECURITY.md`
  at all. Recorded here for honesty, not treated as something to fix,
  since there's no way to make the vault key non-extractable without
  breaking password/recovery-key rotation entirely.

Verified: all 207 tests pass (was 205; +2 recovery-key checksum tests),
`apps/homevault` builds clean.

## [1.1.2] — Clearing the [1.1.1] security review's open items

Follow-up to [1.1.1]: fixes the `vite`/`esbuild` advisories that
review deliberately deferred, plus one more finding surfaced while
checking compatibility for that fix — an EOL base image affecting
every service, not just the frontends.

### Fixed
- **All four `vite`/`esbuild` dev-server advisories**
  ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
  [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9),
  [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3),
  [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff))
  — `vite` bumped `^5.4.20` → `^8.3.0` and `@vitejs/plugin-react`
  `^4.3.1` → `^6.1.1` across all five frontends. `npm audit` goes from
  4 advisories (1 high, 3 moderate) to 0. Checked the vite 5→8 migration
  notes against every frontend's actual `vite.config.js` first — plain
  `react()` plugin, `server.port`/`proxy`/`base` only, nothing
  esbuild-specific or SSR-specific — so this landed with zero config
  changes needed, matching what Vite's own migration guide says to
  expect for a project shaped like this. Verified, not just built
  clean: each frontend's dev server was actually started and hit with
  a real request (confirmed React Fast Refresh injection and the JSX
  transform both still work), on top of all five production builds
  succeeding and the full test suite still passing.
- **Every Dockerfile in the repo (all 11 — every frontend and every
  backend) was pinned to `node:20-slim`.** Found as a side effect of
  checking Node-version compatibility for the `vite@8` upgrade above,
  not something this review went looking for — and confirmed against
  Node's own release schedule, not assumed: **Node.js 20 reached
  end-of-life on 2026-04-30** and has received no security patches
  since. Unlike the `vite` advisories above, this one is not dev-only —
  it's every service's actual production base image. Bumped to
  `node:22-slim` (Maintenance LTS, security support through
  2027-04-30) in all 11 Dockerfiles, and `docs/DEVELOPMENT.md`'s
  "Node.js 20+" prerequisite to "Node.js 22+" to match. Checked first
  that this doesn't trip a `better-sqlite3` requirement this project
  can't meet yet: confirmed directly (not by reading the registry's
  "latest" dist-tag, which is an unrelated, much newer 13.x line with
  its own newer floor) that the version this project's `^11.3.0` range
  actually resolves to, 11.10.0, declares no `engines` constraint at
  all.

### Known limitation of this entry
- The Dockerfile change above was made from an environment without
  Docker available, so `docker-compose build && docker-compose up`
  was never actually run against it. The change itself is low-risk
  (same Debian base as `node:20-slim`, same package manager, nothing
  else in any Dockerfile references a Node-20-specific detail) and was
  reasoned through carefully, but reasoning through a Docker change
  and watching it boot are different kinds of confidence — see
  `docs/ROADMAP.md`.

Verified: all 205 tests still pass, all 5 frontends build clean against
`vite@8`, `npm audit` reports 0 vulnerabilities (was 4).

## [1.1.1] — Security review pass

A self-review of the whole codebase (no independent audit available —
see `README.md`), done by me (Claude) after the [1.1.0] release,
following the same "verify empirically, don't infer" discipline as
everywhere else in this project: every finding below was reproduced or
disproved directly, not assumed, before being written up or fixed.

### Fixed
- **Real, confirmed stored XSS in HomeNotes**
  (`apps/homenotes/src/pages/NoteEditor.jsx`): the Markdown preview
  rendered `marked.parse()` output straight into `dangerouslySetInnerHTML`
  with zero sanitization. Confirmed empirically that `marked` passes
  `<script>`, `onerror=`, and `javascript:` URIs straight through
  unescaped. Because every app sits behind the same gateway origin, a
  script injected via a note could read every app's token out of
  `localStorage` — HomeVault's included — a live, concrete instance of
  `docs/SECURITY.md`'s "Shared-origin XSS" threat, not just the
  abstract case it originally described. Fixed by extracting rendering
  into `renderMarkdownToSafeHtml()` (new file,
  `apps/homenotes/src/markdown.js`), piping `marked`'s output through
  `DOMPurify.sanitize()`. 11 new tests
  (`apps/homenotes/test/markdown.test.js`) cover real payloads
  (`<script>`, `<img onerror>`, `javascript:` hrefs, `<iframe>`,
  `<svg onload>`, `<style>`) plus legitimate-Markdown-still-works
  checks; confirmed the malicious-payload tests fail without the fix
  and pass with it (temporarily reverted, ran, restored — same
  discipline as the foreign-keys item below).
- **`docs/ARCHITECTURE.md` §5 incorrectly claimed the gateway's single
  origin gives every frontend a shared login**, via one common
  `homecloud_token` key in `localStorage`. Not what the code does, and
  never was: each frontend keeps its own key (`home_token`,
  `homecloud_token`, `homemedia_token`, `homenotes_token`,
  `homevault_token`) and logs in independently against HomeCore, with
  no session-sharing mechanism (no shared cookie, no cross-app token
  forwarding, no silent re-auth) anywhere in the codebase. Corrected;
  the doc now also explains what the single origin actually buys
  (simpler routing, one future TLS termination point) and the "shared
  attack surface" that's the real flip side of it.
- Explicit `algorithms: ["HS256"]` allow-list added to both
  `jwt.verify()` call sites (`homecore/src/middleware/authMiddleware.js`,
  `homecore/src/auth.js`'s `/2fa/verify`). **Investigated as a possible
  bug, then disproved**: confirmed directly against the pinned
  `jsonwebtoken@9.0.3` that a forged `alg: "none"` token is already
  rejected by default, and the classic RS256-signed-as-HS256 confusion
  attack has nothing to attach to here since this project only ever
  signs with one HMAC secret — no keypair exists anywhere for an
  attacker to redirect verification onto. Pinned the allow-list anyway
  as defense-in-depth against a future change, with a new regression
  test (`homecore/test/auth.test.js`) asserting a forged `alg:none`
  token is rejected.

### Added
- `foreign_keys = ON` pragma set explicitly in
  `apps/homecloud-backend/src/db.js` and
  `apps/homevault-backend/src/db.js`, plus real cascade-delete tests
  that didn't exist before
  (`apps/homecloud-backend/test/folders.test.js`,
  `apps/homecloud-backend/test/publicShare.test.js`,
  `apps/homevault-backend/test/vault.test.js`). **Investigated as a
  possible bug, then disproved**: the pinned `better-sqlite3` version
  already defaults foreign-key enforcement on, so `ON DELETE CASCADE`
  was never silently broken — set explicitly anyway as
  defense-in-depth against a future dependency change, not because
  anything was actually wrong.
- `docs/SECURITY.md`: documented the HomeNotes XSS finding and fix
  (Part A and the "Shared-origin XSS" threat-catalog row), a confirmed
  (not assumed) account of every backend's `CORS_ORIGIN` shipping unset
  (`*`) in `docker-compose.yml` today and why the practical risk is low
  given this ecosystem's Bearer-token-only auth, and a minor, low-severity
  note that `/api/auth/login` reveals whether a disabled account exists
  via a distinct error message (deliberate trade-off, left as-is).

### Investigated, confirmed no issue
- **Every `dangerouslySetInnerHTML`/raw-HTML-injection site outside
  HomeNotes** — re-confirmed via grep across every backend and
  frontend's `src/` tree that HomeNotes' (now-sanitized) site is the
  only one; no `.innerHTML` assignment, `eval()`, `new Function()`, or
  raw-HTML `res.send()` anywhere either.
- **IDOR / ownership checks** — spot-checked every route across
  HomeCloud, HomeMedia, HomeNotes, HomeSync, and HomeVault (HomeCloud's
  files/folders, HomeMedia's collections/library, HomeNotes'
  notes/noteFolders, HomeSync's devices/sync, HomeVault's items/vault)
  plus HomeCore's admin routes. Every route that touches one specific
  resource either scopes its query by `user_id` directly, or delegates
  the check transitively through another service's own
  token-scoped API (HomeMedia's `downloadFile(req.token, fileId)`,
  same "delegated auth" pattern `docs/ARCHITECTURE.md` already
  documents). HomeCore's admin routes intentionally act on any user —
  gated by `requireAuth, requireAdmin` on the whole router, not a bug.
- **Rate limiting coverage** — every brute-forceable HomeCore auth
  route (`register`, `login`, `2fa/verify`, `change-password`,
  `2fa/setup`, `2fa/confirm`, `2fa/disable`, `2fa/recovery-codes`) has
  `authLimiter`; HomeCloud's share-link route has its own
  `shareLimiter`. HomeVault's routes have none, correctly — nothing
  in `apps/homevault-backend` ever verifies a password server-side
  (see `docs/SECURITY.md`'s HomeVault architecture), so there's
  nothing there for a rate limiter to protect.
- **File upload handling** (`apps/homecloud-backend/src/files.js`) —
  confirmed empirically that `path.extname()` never returns a path
  separator even when fed a traversal-style filename, and every stored
  filename is a server-generated `crypto.randomUUID()`, never derived
  from user input; download/thumbnail routes only ever read
  `stored_name`/`thumbnail_name` off the DB row, never a client-supplied
  path. The user-supplied `original_name` is only ever used as
  `res.download()`'s suggested filename (a header value, not a path).
- **Error message information leakage** — every backend's fallback
  error handler logs the full error server-side but returns only
  `err.message` for errors deliberately thrown with a `.status` (safe,
  expected messages like "Destination folder not found") and a generic
  "Internal server error." for anything else; no stack traces or
  internal paths ever reach a client.

### Known, not fixed here
- `vite`/`esbuild`'s dev-server advisories have grown since [1.1.0]:
  `npm audit` now reports **four**, not one — including a new **high**-severity
  one ([GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff),
  a `server.fs.deny` bypass on Windows). All four are dev-server-only by
  their own descriptions, same as the original; fixing all of them
  still means the same `vite@8` breaking major upgrade already planned
  — not forced through here for the same reason as before (needs
  dedicated per-frontend dev/build verification time) — but the
  severity increase is worth moving up in priority. See
  `docs/SECURITY.md` and `docs/ROADMAP.md`.

Verified: all 205 tests pass (was 190; +11 HomeNotes markdown
sanitization, +1 JWT alg:none regression, +3 foreign-key cascade tests
across HomeCloud/HomeVault), all 5 frontends build clean.

## [1.1.0] — HomeVault v0

The first new application since the [1.0.0] handoff cleanup — a
client-side-encrypted password/secrets manager, per the build order
decided below. **v0 is built and tested; it has not had an independent
security review** — see `docs/SECURITY.md`'s v0 status callout before
storing anything real in it. This release also folds in a full pass
resolving every decision left open by the handoff cleanup, and adding
the two governing spec documents that were missing from the repo.

### Added — HomeVault v0
- `apps/homevault-backend` (port 4600) — stores only ciphertext and
  public KDF parameters; structurally cannot decrypt anything it holds.
  The first app with zero dependency on `apps/homecloud-backend`. 27
  tests.
- `apps/homevault` (port 5177) — vault creation with a one-time
  recovery-kit display, unlock, recovery (lost password → recovery key
  → set a new one), item list/create/edit/delete (login/note/card
  types), settings (change master password, regenerate recovery kit,
  delete vault). `src/crypto.js` — the actual envelope encryption
  (Argon2id via `hash-wasm`, AES-256-GCM via the Web Crypto API) — is
  framework-free specifically so it has its own 18 tests, run in
  complete isolation from any UI, the same way HomeSync's
  `pathPlanner.js` is tested apart from Android.
- Registered in HomeCore's application registry, the gateway, and
  `docker-compose.yml`, following the existing patterns exactly. Added
  to the Windows dev launcher (`scripts/dev-home-ui.ps1`) as a new
  optional checkbox.
- `docs/SECURITY.md`'s HomeVault section now states plainly what's been
  verified by automated test, what was followed exactly as designed,
  and what still needs human review — not just the original design.

### Added
- `LICENSE` — proprietary, all rights reserved. Deliberately the most
  restrictive default (easy to relax later, hard to undo the other way).
- The two governing spec documents (`HOME_MASTER_SPECIFICATION.md`,
  `HOME_ARTISTIC_DIRECTION.md`) to the repo root — previously cited by
  section number throughout the codebase but absent from the repository
  itself (flagged during the [1.0.0] cleanup). Cross-checked a sample of
  citations against them: the implementation matches the spec's intent
  everywhere checked, with one real, documented deviation — see
  `docs/ARCHITECTURE.md`'s note and the roadmap item on
  `/api/auth`/`/api/admin`/`/api/activity` not being nested under
  `/api/core` the way §10 suggests. Tightened `docs/SECURITY.md`'s
  permission-enforcement note with the precise citation (§28, layer 3).

### Fixed
- A moderate-severity `qs` advisory, pulled in transitively through
  every backend's `express`/`body-parser`, patched via an `overrides`
  pin rather than a breaking Express 5 upgrade — see root
  `package.json`'s comment. `npm audit`: 5 vulnerabilities → 1
  (moderate, dev-server-only — see below).
- A stale `TRANSITIONAL` comment reference in
  `apps/homecloud-backend/test/helpers/client.js`, and three stale
  pre-gateway comments in `theme.js` across `apps/home`,
  `apps/homemedia`, `apps/homenotes`, found while working nearby.

### Known, not fixed here
- `vite`/`esbuild`'s moderate dev-server advisory remains — fixing it
  needs `vite@8`, a breaking upgrade across all five frontends. Flagged
  in `docs/ROADMAP.md` and `docs/SECURITY.md` rather than forced through
  without dedicated testing time.

### Decided (see the linked doc for each; recorded so the reasoning isn't lost)
- Version: 1.1.0 for this release.
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
