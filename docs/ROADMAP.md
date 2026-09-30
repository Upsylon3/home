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
2. **HomeSync Android: confirm the build, then run it.** 1.1.4 had the
   app's first real Gradle build, which failed at resource linking and
   was fixed (a missing Material Components dependency). The Gradle,
   Kotlin and Compose upgrades made in that same release were never
   compiled, so the first step is a fresh Gradle sync on a machine with
   the Android SDK, and the second is a real device or emulator run,
   which has never happened — see `DEVELOPMENT.md`. Not a blocker for
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
6. **Run `docker-compose build && docker-compose up` end-to-end** to
   confirm the `node:22-slim`, `nginx:1.30-alpine` and `alpine:3.22`
   base-image bumps (see `SECURITY.md`)
   actually builds and boots every service — done from an environment
   without Docker available, so this was reasoned through (same Debian
   base, no Node-20-specific detail anywhere else in any Dockerfile,
   the native `better-sqlite3` build confirmed to have no conflicting
   engine requirement) but never run.
7. **Pin the gateway's base image.** `gateway/Dockerfile` is still
   `FROM nginx:alpine` (a floating tag) while the frontends are on
   `nginx:1.30-alpine` — see `SECURITY.md`. A one-line change, but do it
   together with item 6, since both need a Docker rebuild to confirm.
8. **Triage Dependabot's first PRs** (`.github/dependabot.yml`, added in
   1.1.4). Majors are deliberately left out of the weekly group so each
   one gets read on its own. `better-sqlite3` is the one to be careful
   with: a bump to 13 was tried and reverted in 1.1.4 (see its
   changelog entry for why).

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
