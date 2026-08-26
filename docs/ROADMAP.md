# Roadmap

Two parts: concrete near-term work the verification pass behind this doc
set actually surfaced, and the longer-term cross-module ideas brainstorm
(condensed from `HOME_CROSS_MODULE_BRIDGES.md`) — explicitly speculative,
none of it committed.

## Near-term backlog (concrete, surfaced by checking the repo)

1. **~~Write HomeSync Android's missing `data` package.~~ Written as of
   `v0.3.0`** — `SessionManager`, `SettingsStore`, `ApiClient` /
   `HomeSyncApi` (+ its request/response types), `AppDatabase`,
   `SyncedMediaDao`, `SyncedMediaEntity` all exist now, traced against
   every consumer's call signatures and against the real backend routes'
   JSON shapes — see `CHANGELOG.md` `[0.3.0]`. **Not yet compiled with a
   real Android toolchain** (no Android SDK / Gradle / reachable Maven
   repo in the environment that wrote it) — a real `./gradlew build` or
   Android Studio Gradle sync is the actual next step, and the thing that
   turns "carefully traced" into "verified." See `SERVICES.md#homesync`.
2. **Patch `setup.sh` / `setup.ps1`** to match the restored gateway: drop
   the `LAN_IP` templating (unused by `docker-compose.yml` now) and the
   `8081`/`8082`/`8083` port references in their final summary; point
   everything at `:8080` with the `/cloud`, `/media`, `/sync` paths. See
   `SETUP.md` for the corrected reference table to copy from.
3. **Commit the icon set.** Regenerate (or recover) the `icons/*.svg` +
   wordmark files described in `DESIGN_SYSTEM.md`, add them to
   `frontend/public/`, `home/public/`, and `homemedia/public/`, and point
   `homecore/seed.js`'s icon paths at real files instead of ones that
   don't resolve.
4. **TLS at the gateway.** Blocking prerequisite for HomeVault (per its
   own threat model) and generally overdue for anything beyond a fully
   trusted LAN — see `SECURITY.md`.
5. **A real permission-enforcement pass.** HomeCore's permission system
   is currently declarative only (apps state what they'd use; nothing
   checks it before granting access to another app's resource). Several
   of the bigger ideas below depend on this landing first.
6. **A decision on HomeBridge's background-trigger auth** (scoped
   service credential vs. per-app internal endpoints) — see
   `ARCHITECTURE.md` §4's open question — before HomeBridge's first
   scheduled (not request-triggered) bridge is built.

## Deferred features, by service (already decided, just not built)

- **HomeCloud:** multi-file/folder drag-drop batch upload, file
  versioning, encryption at rest.
- **HomeMedia:** video poster-frame thumbnails (needs ffmpeg), duplicate
  detection, shared/multi-user albums, mobile upload integration.
- **HomeSync:** true resumable/chunked upload, a numeric
  battery-percentage threshold, in-place-edit detection, real app icon +
  matching typography.
- **HomeVault:** everything — see `SECURITY.md` for the prerequisites
  that come before any of it.

## Cross-module ideas brainstorm (condensed, speculative)

Everything below rides on infrastructure that already exists — the
shared event bus and the application registry — so most of these are "a
new listener, zero new plumbing" rather than new infrastructure per idea.
None of this is committed; it's raw material for when HomeBridge (Tier 2,
see `ARCHITECTURE.md` §4) actually gets built.

**The showcase-level ideas:**

- **A true cross-app timeline.** Home's "Recent" widget already pulls
  from the shared event bus. The big version: every module emits into
  the same feed, and the dashboard becomes an actual life timeline. Cheap
  relative to its value — worth calling out as the single best
  effort-to-payoff idea on this list.
- **Global search** across HomeCloud filenames, HomeMedia photos/EXIF,
  HomeNotes, HomeTasks, and (carefully — see the security note below)
  HomeVault item titles, but only when already unlocked.
- **"This needs attention" becomes a real task, automatically.** Any
  module's warning state can optionally spawn a HomeTasks entry instead
  of a notification that gets swiped away — HomeSync hasn't synced in 9
  days → a task, not just a badge. Turns HomeTasks into the household's
  actual attention-router.
- **Life-event bundles.** A template that spins up a coordinated set
  across modules for a real moment — "Trip to Portland" → a HomeMedia
  album auto-collecting anything shot in that date range, a HomeNotes
  packing list, a HomeTasks checklist. The kind of feature that makes the
  ecosystem feel like one thing rather than eight apps sharing a login.
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

**Smaller pairwise ideas, for coverage:** quota-aware throttling before
HomeSync fails a batch; attaching a HomeCloud file to a note/task by
reference; storage-growth *forecasting* ("full in ~40 days") instead of a
static percentage; file Q&A / semantic search over HomeCloud contents;
tagging photos by originating device; promoting a note checklist item
into a real HomeTasks item with one click; natural-language task
creation via HomeAI; multi-device sync health at a glance for a
household. Two worth flagging distinctly rather than lumping in:
**face grouping** in HomeMedia is biometric-adjacent and deserves its own
consent design and mini threat-model pass, not a casual bullet point next
to "auto-album suggestions"; and a HomeTasks item **linking** to a
HomeVault item (e.g. a passport number) must stay a pointer, never a
copy — opening it means unlocking at HomeVault's own origin.

**The one deliberate non-bridge:** HomeAI never reads HomeVault. On
purpose. HomeVault's entire design is that the server never holds a key
capable of decrypting vault contents — HomeAI indexing over it would
require exactly that. Worth stating explicitly here so it isn't
reintroduced later as a casual "nice to have."

**The same blockers, showing up repeatedly across the ideas above** —
worth fixing once rather than working around per-idea: permission
enforcement still being declarative (item 5 above), and HomeCloud's
file authorization being strictly owner-only (blocks any genuinely
multi-user version of the ideas above — a shared album, a
household-shared life-event bundle).
