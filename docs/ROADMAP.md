# Roadmap

Only unfinished work is listed here. Completed changes belong in
[CHANGELOG.md](../CHANGELOG.md). App baselines and product identity live in
[ARCHITECTURE.md](ARCHITECTURE.md#application-maturity-and-direction).
Daily personal/family use on one HOME is the current priority. Optional
multi-server work does not block improving the applications.

## Platform consolidation: HOME mobile, Core accounts and Sync devices

Status: approved direction; implementation and full frontend inventory pending. This
section records new product decisions, not claims that the work is complete.
Keep changes in focused PRs with migrations, tests and rollback plans. Preserve
existing data and functionality; do not create parallel Android clients or
authentication authorities.

### 1. One HOME Android application

- Audit the entire existing `apps/homesync-android/` Kotlin/Compose project,
  its tests, permissions, WorkManager jobs, API clients and persistence.
- Evolve the existing native project into the general HOME Android client,
  including an application dashboard, Core login/profile, server selection and
  mobile-appropriate entry points to installed HOME applications. Decide the
  supported native versus embedded/web journeys per app before implementation.
- Migrate package/application identifiers, build paths and release workflows
  deliberately; preserve installed-client data or provide an explicit migration
  and rollback. Avoid a second competing Android project.
- Retain and reuse the current media-backup worker, device registration,
  deduplication, scheduling and settings as the HomeSync portion of the app.
- Provide a physical-phone install/test guide and APK build, then validate
  permissions, selected media, Doze, reboot, network transitions and upgrades.

### 2. HomeSync as the cross-device coordination service

- Define HomeSync's scope as device enrollment, state/health, opt-in
  synchronization, and backup orchestration, with HomeCloud remaining the
  authoritative file store and HomeMedia consuming Cloud media.
- Keep device synchronization distinct from Core's experimental *server-to-server
  federation*: server pairing proves server identity but does not grant user or
  resource access. Do not bypass the pairing design's authorization gates.
- Support multiple saved HOME servers on Android with per-server sessions,
  device IDs, backup settings, queue identity and deduplication history.
  Explicitly define whether each server is a backup destination or a selected
  interactive HOME; never implicitly replicate private data to every server.
- Migrate legacy single-server local data without losing backup history.
  Bind queued WorkManager work to an immutable destination identity, and test
  server switching, logout, retries, token isolation, changed files and
  destination-specific deduplication.
- Define conflicts, offline behavior, encryption/transport, trust, revocation
  and user-visible synchronization status before expanding to other app data.

### 3. Centralize account ownership in HomeCore and HOME

- ~~Move Core-backed account settings/administration into HOME and retire
  duplicate Cloud account controls after API/browser proof.~~ Existing Cloud
  bookmarks preserve storage preferences/audit and link to HOME. See
  [validation](VALIDATION.md#unified-home-accounts) for executed checks.
- Audit registration/login entry points across the remaining frontends;
  preserve owner setup, compatible auth APIs and existing sessions.
- ~~Replace stale Cloud account guidance in Media, Notes, Tasks and Monitor
  Settings with working HOME account links.~~ Their appearance controls and
  Vault's separate master-password controls remain app-owned. Continue the
  broader route/control inventory below; registration/login audit remains above.
- Avoid copying identity tables into other services or introducing another
  account authority. Use additive migrations, compatibility windows,
  disposable test fixtures and documented rollback.

### 4. Frontend completion and UX consistency audit

- Inspect every frontend route, visible control, placeholder, disabled action,
  unfinished workflow, dead navigation target, error/empty/loading state,
  mobile layout and settings screen. Classify each as implemented, intentionally
  minimal, incomplete, broken or aspirational; verify with source and tests.
- Produce a prioritized issue inventory with reproduction, owning app,
  acceptance criteria and dependencies. Do not confuse a placeholder input
  attribute with an unfinished feature, or reopen completed features.
- Fix confirmed dead ends and high-impact incomplete journeys in focused PRs;
  use the shared design system and preserve app-specific capabilities.
- Update API/architecture/security docs, validation evidence, roadmap and
  changelog as each slice lands. Never claim APK/device or browser validation
  from source inspection alone.

### Suggested delivery order

1. Inventory and architecture decisions, including account ownership and
   Android migration compatibility.
2. Core-backed unified HOME account/settings UX and safe Cloud redirects.
3. Rename/evolve the existing Android app into HOME while retaining Sync.
4. HomeSync multi-server profile/queue/data migrations and device UX.
5. Cross-device functionality expansion after explicit data/conflict/security
   designs; parallel frontend-completion fixes by severity.

## Next application work

Work in this order unless a confirmed regression or security fix takes priority.
Each item needs its own focused change and appropriate proof; this list does
not authorize changing a real installation or storing real secrets in Vault.

1. **Notes save safety.** Reproduce navigation before the 1.5-second autosave
   delay and failed-save/retry behavior. The editor currently cancels the pending
   timer on cleanup, and no durable draft or leave protection was found in this
   audit. Investigate possible lost edits before adding features; this is a
   source finding, not a reproduced browser result. Preserve unsaved text and
   make saved/saving/failed states dependable. Full offline editing additionally
   needs explicit cache privacy, conflict and recovery behavior.
2. **Notes templates.** Restore the deferred reusable-note workflow: create a
   personal template and start an independent editable note from it. Define
   title/content/tag copying and ownership; reuse Notes' existing APIs and
   sanitized editor. Templates must not require another server or collaboration.
3. **Cloud folder upload.** Add folder selection/drop with preserved directory
   hierarchy, a bounded upload queue and per-file outcomes/retry. Multiple-file
   selection/drop already exists; do not rebuild it or flatten a folder tree.
   Use the owning user's existing folder/upload APIs, quota and path checks.
4. **Media video posters.** Replace generic video placeholders with bounded,
   cached poster generation through Cloud's authorized file API. Review decoder
   dependency/runtime cost, invalid videos, cache invalidation and fallback first.
   Photo thumbnails, playback, EXIF and browser upload already exist.
5. **Sync backup feedback.** Show actual queued, waiting-for-constraints, running,
   retrying, failed and completed work, with meaningful run progress/history.
   The current aggregate totals/last-upload summary and transient request message
   do not show a live backup queue. Use real worker state rather than an optimistic
   "backup requested" success; keep phone permission/charging limits visible.
6. **Sync changed-file detection.** Stop treating a previously backed-up local
   media ID as proof its contents are unchanged. Design modified-time/size/hash
   rechecks and test an in-place edit, unchanged runs, retry and deduplication.
   Preserve whole-file retry and WorkManager's battery constraints.

Entry points: [Notes editor](../apps/homenotes/src/pages/NoteEditor.jsx),
[Cloud uploads](../apps/homecloud/src/components/UploadZone.jsx),
[Media thumbnails](../apps/homemedia-backend/src/library.js),
[Sync worker](../apps/homesync-android/app/src/main/java/com/homeecosystems/homesync/sync/BackupWorker.kt).

## Further application scope

These are retained unfinished targets, not claims that a design or implementation
already exists. Start with a concrete use case and a short design where needed.

- **Cloud:** file version history/restoration with quota/retention semantics;
  encryption at rest with an explicit key-loss, backup and recovery model.
- **Media:** duplicate discovery/review without automatic deletion; shared albums
  for people on the same HOME. Design local user/resource permissions first;
  local family sharing does not require foreign accounts. Clarify any additional
  mobile-upload journey: browser upload and Sync-to-Cloud-to-Media already exist.
- **Notes:** same-HOME collaborative editing with ownership/conflict rules and
  the optional offline workspace from the original specification. Existing note
  versions are not offline storage or concurrent-edit conflict handling.
- **Sync:** user-selected document/folder backup through an appropriate Android
  picker/permission model. Media categories and MediaStore Downloads scanning
  do not establish arbitrary document-tree access. Retain selected-media and
  physical-device validation separately below.
- **Tasks:** configurable repeat intervals, chosen weekdays, completion-relative
  repeats and series end date/count. Define recurrence/undo behavior before
  implementation. Ordinary repeats, personal reminders and local assignment
  already exist. Retain the unfinished shared-activity event integration;
  assignment audits and reminder notifications are not a general Recent feed.
- **Vault:** assess structured TOTP/API-key workflows from the original vision
  after independent review. Login/note/card items, recovery, Trash, password
  changes and administrator reset already exist; text stored in a secure note
  is not a dedicated authenticator workflow. Do not label the whole vault unbuilt.
- **Home / Bridge:** design a personal daily overview with useful due work,
  recent content and backup information. Preserve the existing greeting, Cloud
  quota, activity and notifications; grow optional cross-app summaries through
  approved APIs/Bridge, with owner isolation and unavailable states. Keep Home
  calm and useful when optional applications are stopped. Audit app event coverage
  before promising a unified timeline: Notes/Tasks do not currently publish their
  ordinary edits/completions into Core's activity feed. Add minimal owner-scoped
  events without note bodies or secrets, and keep primary saves independent of
  event-delivery success.
- **Monitor:** retain the original database-health/diagnostics direction as a
  read-only design target. Determine what extra check results are useful beyond
  the current service-health and backup-freshness views, using owning-service
  APIs. Keep the shipped network metrics/forecast/alerts; do not reopen privileged
  host or container control as an assumed next v0 feature.
- **HomeAI:** not started. Retain the original optional private assistant
  direction: chat, summaries and authorized file/note Q&A/search, with local-model
  support considered before optional external providers. Choose a first use
  case, explicit per-app consent and retrieval permissions before implementation.
  Never give it decrypted Vault contents. Everyday app work comes first.

## Optional multi-server work

- Add typed guest authentication and explicit Tasks resource grants following the
  [pairing design](PAIRING-DESIGN.md). Complete planned key/origin rotation,
  source/runtime restore integration and isolated guest origins before enablement.
  Storage replication remains a separate design.

## Open validation

These are evidence gaps, not features to rebuild:

- **Multi-server pairing:** independent protocol/security review and two isolated
  public-HTTPS HOME drills before guest access. Local TLS fixtures do not prove
  internet reachability or physical restore. [Protocol checks](VALIDATION.md#multi-server-pairing).

- **HomeVault:** independent security/cryptography review before real secrets
  are stored. [Review handoff](VALIDATION.md#vault-review).
- **Client performance:** validate the existing KDF on representative older
  PCs/phones when available. [Optional benchmark](VALIDATION.md#vault-performance).
- **HomeSync:** physical-phone, selected-video/selection-removal, Doze/reboot
  and long-duration backup checks. [Device checks](VALIDATION.md#homesync).
- **Installer:** hands-on Windows/macOS, reboot and real outside-access checks.
  Linux container tests do not establish those results.
- **Off-machine backups:** physical NAS/removable-storage and recovery checks.
  [Export validation](VALIDATION.md#backup-exports).

## Later ecosystem ideas

The old cross-module brainstorm remains exploratory: a richer personal activity
timeline; additional authorized Cloud/Media search sources; life-event bundles;
turning a note checklist into tasks; device-origin media tags; and one portable
personal export across apps. A user-facing export is distinct from server backup
archives. Notes/Tasks search and consented Monitor-to-Tasks automation are already
implemented. Other warning-to-task rules need trustworthy source signals first.

Face grouping needs a separate biometric/privacy consent design. A link from a
task to a Vault item must remain a pointer opened in Vault, never copied plaintext.
These ideas are not committed features or reasons to add speculative services.

## Decisions that remain closed

- Sync uses whole-file retry and WorkManager battery constraints; resumable/chunked
  upload and a numeric battery-percentage threshold are not missing milestones.
- Monitor remains read-only without a Docker socket, host control actions or
  privileged SMART probes. Its v0 label does not authorize adding those powers.
- Account lifecycle is disable-only; cross-service hard deletion is not scheduled.
- Vault plaintext stays outside HomeAI and server-side cross-app search.

## Scope recovery audit

Reviewed 2026-11-05 against current source and the pre-cleanup
[roadmap](https://github.com/Upsylon3/home/blob/f7a842c8410b46c9749fe16cffe1091d2c4352ec/docs/ROADMAP.md),
[product specification](https://github.com/Upsylon3/home/blob/f7a842c8410b46c9749fe16cffe1091d2c4352ec/HOME_MASTER_SPECIFICATION.md)
and [artistic direction](https://github.com/Upsylon3/home/blob/f7a842c8410b46c9749fe16cffe1091d2c4352ec/HOME_ARTISTIC_DIRECTION.md).
The old roadmap explicitly retained unbuilt service features; the product spec
also contained broader aspirations, which remain design targets rather than
automatic implementation commitments. Cleanup had omitted templates and Sync
edit detection and flattened several app targets into a generic ideas paragraph.
This roadmap restores those distinctions without reopening completed or rejected work.

Keep dependency updates, security fixes and failing checks ahead of new features.
