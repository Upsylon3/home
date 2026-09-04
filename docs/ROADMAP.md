# Roadmap

Two parts: concrete near-term work, and a longer-term cross-module ideas
brainstorm — explicitly speculative, none of it committed.

## Near-term backlog

1. **HomeSync Android's first real build.** The app (including the
   previously-missing `data/` package) is written and statically
   reviewed, but has never been through a real Gradle sync or run on a
   device/emulator — see `DEVELOPMENT.md`. This is the single most
   important next step for HomeSync.
2. **Locate or recreate `HOME_MASTER_SPECIFICATION.md` and
   `HOME_ARTISTIC_DIRECTION.md`.** 25 files across this codebase cite
   specific sections of these two documents, and neither exists in this
   repository — see the callout at the top of `ARCHITECTURE.md`. If they
   exist elsewhere, add them at the repo root; if they're truly gone,
   the numbered citations in code comments should eventually be cleaned
   up to stop pointing at nothing.
3. **TLS at the gateway.** Blocking prerequisite for HomeVault (per its
   own threat model) and generally overdue for anything beyond a fully
   trusted LAN — see `SECURITY.md`.
4. **A real permission-enforcement pass.** HomeCore's permission system
   is currently declarative only (apps state what they'd use; nothing
   checks it before granting access to another app's resource). Several
   of the bigger ideas below depend on this landing first.
5. **A decision on HomeBridge's background-trigger auth** (scoped
   service credential vs. per-app internal endpoints) — see
   `ARCHITECTURE.md` §4's open question — before HomeBridge's first
   scheduled (not request-triggered) bridge is built.
6. **Icon system finishing touches**: PNG/ICO favicon exports for every
   frontend but HomeCloud's, an Android adaptive-icon split, and a final
   typeface decision (currently a placeholder sans-serif stack) — see
   `DESIGN_SYSTEM.md`.
7. **An account-deletion flow.** Only account *disable* exists today.
   Adding deletion needs to also tell `apps/homecloud-backend` (and
   every other Tier 1 app) to clean up that user's data — there's no
   foreign key across the separate databases to do it automatically.
   See `ARCHITECTURE.md` §6.

## Deferred features, by service (already decided, just not built)

- **HomeCloud:** multi-file/folder drag-drop batch upload, file
  versioning, encryption at rest.
- **HomeMedia:** video poster-frame thumbnails (needs ffmpeg), duplicate
  detection, shared/multi-user albums, mobile upload integration.
- **HomeNotes:** real-time collaborative editing, note templates.
- **HomeSync:** true resumable/chunked upload, a numeric
  battery-percentage threshold, in-place-edit detection.
- **HomeVault:** everything — see `SECURITY.md` for the prerequisites
  that come before any of it.

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
still being declarative (item 4 above), and HomeCloud's file
authorization being strictly owner-only (blocks any genuinely
multi-user version of the ideas above — a shared album, a
household-shared life-event bundle).
