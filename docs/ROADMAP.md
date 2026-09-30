# Roadmap

Two parts: concrete near-term work, and a longer-term cross-module ideas
brainstorm — explicitly speculative, none of it committed.

**Build order, decided:** HomeVault → HomeTasks → HomeBridge →
HomeMonitor → HomeAI. HomeVault first because it's security-critical and
already had a full threat model (`SECURITY.md`) — **v0 is now built**
(see `ARCHITECTURE.md`'s status table), so this is HomeTasks next: the
highest everyday-value, most conventional build (CRUD app, no new
architectural pattern needed). HomeBridge after that, once there are
enough real apps for its cross-app ideas (`ROADMAP.md`'s brainstorm
below) to actually matter. HomeMonitor and HomeAI last — lower urgency,
and HomeAI specifically benefits from permission enforcement landing
first (see below).

## Near-term backlog

1. **An independent security/cryptography review of HomeVault v0.** The
   single most important item on this list — see `SECURITY.md`'s v0
   status callout for exactly what's been verified by automated test
   versus what still needs human review. Nothing real should go into a
   HomeVault vault before this happens.
2. **HomeSync Android: run it on a real device.** The app now builds
   and passes its unit tests in CI (`android.yml`), after three rounds of
   fixes for problems the 1.1.4 upgrades had hidden (see `CHANGELOG.md`).
   What has never happened is running it: install the debug APK that the
   workflow saves on a phone or emulator, sign in, and do one backup. That
   is the first test of the parts CI can't reach, the sign-in flow, the
   WorkManager scheduling and the actual upload — see `DEVELOPMENT.md`. Not a blocker for
   anything else — other apps can proceed in parallel while this is
   pending.
3. **HomeVault follow-ups deferred out of v0**: soft-delete/undo for a
   deleted item, benchmarking Argon2id's parameters against real
   minimum self-hosting hardware (v0 ships OWASP's default, untested
   against, say, a Raspberry Pi specifically), and an admin-facing
   vault-reset action for HomeCore (today only the account holder can
   delete their own vault).
4. **Icon system finishing touches**: PNG/ICO favicon exports for every
   frontend but HomeCloud's, and an Android adaptive-icon split — see
   `DESIGN_SYSTEM.md`. Typeface and accent color are now final, not
   open questions.
5. **Fix the `/api/auth`, `/api/admin`, `/api/activity` route-nesting
   inconsistency** flagged in `ARCHITECTURE.md` — `HOME_MASTER_SPECIFICATION.md`
   §10 calls for these under `/api/core/...`; they're top-level instead,
   a holdover from before HomeCore existed. Not urgent (nothing's
   broken), but a real deviation worth resolving deliberately rather
   than leaving as an accident of history.
6. **Done: the whole stack builds and boots end to end.** `ci.yml`'s
   Docker job runs `docker compose build`, starts every container and
   checks the stack through the gateway, on GitHub's machines. It is green,
   which also confirms the `node:22-slim`, `nginx:1.30-alpine` and
   `alpine:3.22` base-image bumps (see `SECURITY.md`). Getting it green took
   three real fixes, all in `CHANGELOG.md`: the Dockerfiles predated the
   move to npm workspaces, HomeCloud's backend inherited the wrong port,
   and the gateway started before the services it forwards to. Kept here,
   rather than deleted, so the numbering that other files point at stays
   valid. What it does not cover is a real browser session or a device.
7. **Pin the gateway's base image.** `gateway/Dockerfile` is still
   `FROM nginx:alpine` (a floating tag) while the frontends are on
   `nginx:1.30-alpine` — see `SECURITY.md`. A one-line change, but do it
   together with item 6, since both need a Docker rebuild to confirm.
8. **Triage Dependabot's first PRs** (`.github/dependabot.yml`, added in
   1.1.4). Majors are deliberately left out of the weekly group so each
   one gets read on its own. With `ci.yml` in place, each PR shows a
   green or red result, so start with the green ones. `better-sqlite3` is the one to be careful
   with: a bump to 13 was tried and reverted in 1.1.4 (see its
   changelog entry for why).

9. **Move to a newer Node, once, on purpose.** Node 22 is in maintenance
   support until 2027-04-30, so nothing is urgent. Node 24 is the current
   Active LTS (supported to 2028-04-30) and Node 26 is due to enter LTS
   on 2026-10-28 (supported to 2029-04-30). When picking a target, change
   all 11 Dockerfiles, `node-version` in both places in
   `.github/workflows/ci.yml`, and the prerequisites in `DEVELOPMENT.md`
   together, and check first that `better-sqlite3`'s prebuilt binaries
   cover that Node version (the `slim` images have no compiler, so a
   missing prebuilt fails the Docker build). Dependabot is told to leave
   Node majors alone for exactly this reason.

10. **Let the gateway start when an app is missing.** Today every
   `proxy_pass` in `gateway/nginx.conf` names its container directly, and
   nginx resolves those names once at startup, so if any app container
   isn't running the gateway itself won't start, which takes the whole
   ecosystem down. That contradicts principle 4 in `ARCHITECTURE.md`
   (if HomeMedia is offline, Home still loads and shows it as
   unavailable) and makes "run only HomeCloud" impossible. `docker-compose.yml`
   now makes the gateway wait for every service, which fixes the crash
   loop but not the design. The proper fix is for nginx to look names up
   per request (`resolver 127.0.0.11` and a variable in `proxy_pass`),
   which changes how paths are rewritten and needs testing with a real
   stack, plus a friendly "this app is unavailable" page for a 502.

**Settled, not open questions anymore** (kept here so the reasoning
isn't lost): TLS approach (private overlay, not public certs —
`SECURITY.md`), HomeVault's origin (shared, with CSP — `SECURITY.md`),
HomeBridge's background-trigger auth (scoped service credential —
`ARCHITECTURE.md` §4), permission enforcement (deferred until HomeVault
needs it — `SECURITY.md`), account deletion (disable-only, permanently —
`ARCHITECTURE.md` §6), HomeCloud's owner-only sharing (staying
owner-only until a feature forces it — `ARCHITECTURE.md` §6), and the
generic per-app dashboard stat (staying hardcoded per app for now).


## Deferred features, by service (already decided, just not built)

- **HomeCloud:** multi-file/folder drag-drop batch upload, file
  versioning, encryption at rest.
- **HomeMedia:** video poster-frame thumbnails (needs ffmpeg), duplicate
  detection, shared/multi-user albums, mobile upload integration.
- **HomeNotes:** real-time collaborative editing, note templates.
- **HomeSync:** in-place-edit detection is deferred (not built, not
  ruled out). True resumable/chunked upload and a numeric
  battery-percentage threshold are **decided against** — whole-file
  retry and WorkManager's built-in `requiresBatteryNotLow` constraint
  stay as the permanent design, not gaps waiting to be filled.
- **HomeVault:** soft-delete/undo for an item, benchmarking Argon2id on
  minimum hardware, and an admin-facing vault-reset action — see item 3
  above. The core vault itself is built (v0).

## Cross-module ideas brainstorm (speculative)

Everything below rides on infrastructure that already exists — the
shared event bus and the application registry — so most of these are "a
new listener, zero new plumbing" rather than new infrastructure per
idea. None of this is committed; it's raw material for when HomeBridge
(Tier 2, see `ARCHITECTURE.md` §4) gets built.

**The showcase-level ideas:**

- **A true cross-app timeline.** Home's "Recent" widget already pulls
  from the shared event bus. The big version: every module emits into
  the same feed, and the dashboard becomes an actual life timeline.
  Cheap relative to its value — arguably the single best
  effort-to-payoff idea on this list.
- **Global search** across HomeCloud filenames, HomeMedia photos/EXIF,
  HomeNotes, HomeTasks, and (carefully — see the security note below)
  HomeVault item titles, but only when already unlocked.
- **"This needs attention" becomes a real task, automatically.** Any
  module's warning state can optionally spawn a HomeTasks entry instead
  of a notification that gets swiped away — HomeSync hasn't synced in 9
  days → a task, not just a badge.
- **Life-event bundles.** A template that spins up a coordinated set
  across modules for a real moment — "Trip to Portland" → a HomeMedia
  album auto-collecting anything shot in that date range, a HomeNotes
  packing list, a HomeTasks checklist.
- **Security events, converged.** HomeVault's "new login detected"
  pattern applies just as much to a new HomeCloud device, an admin
  action anywhere, a 2FA change — HomeMonitor is the natural place these
  converge into one feed.
- **One export, everything.** A single "download everything" pulling
  HomeCloud files, HomeMedia albums/metadata, HomeNotes, HomeTasks, and a
  HomeVault encrypted export (still ciphertext, still portable) in one
  action.
- **One consent screen for AI access.** When HomeAI wants to read across
  multiple apps, an explicit "HomeAI wants to read: Files, Notes, Photos
  — Allow?" screen — the permission-enforcement gap above, made
  user-facing instead of only a backend concern.

**Smaller pairwise ideas:** quota-aware throttling before HomeSync fails
a batch; attaching a HomeCloud file to a note/task by reference;
storage-growth *forecasting* ("full in ~40 days") instead of a static
percentage; file Q&A / semantic search over HomeCloud contents; tagging
photos by originating device; promoting a note checklist item into a
real HomeTasks item with one click; natural-language task creation via
HomeAI; multi-device sync health at a glance for a household. Two worth
flagging distinctly: **face grouping** in HomeMedia is biometric-adjacent
and deserves its own consent design and mini threat-model pass, not a
casual bullet point next to "auto-album suggestions"; and a HomeTasks
item **linking** to a HomeVault item (e.g. a passport number) must stay
a pointer, never a copy — opening it means unlocking at HomeVault's own
origin.

**The one deliberate non-bridge:** HomeAI never reads HomeVault. On
purpose. HomeVault's entire design is that the server never holds a key
capable of decrypting vault contents — HomeAI indexing over it would
require exactly that. Worth stating explicitly here so it isn't
reintroduced later as a casual "nice to have."

**Two blockers show up repeatedly across the ideas above** — worth
fixing once rather than working around per-idea: permission enforcement
still being declarative (see `SECURITY.md`), and HomeCloud's file
authorization being strictly owner-only (blocks any genuinely
multi-user version of the ideas above — a shared album, a
household-shared life-event bundle).
