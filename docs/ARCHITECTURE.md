# Architecture

## 1. The vision

HOME is a private digital place for a person's or family's everyday life:
their files, memories, writing, plans and phone backups. The user owns and
operates it. Shared identity and familiar behavior make the applications feel
like capabilities of one personal environment. Local operation has no mandatory
third-party cloud dependency. See the [product contract](#product-contract).

Home is the quiet entrance, Cloud the storage foundation, and Core the shared
platform working behind the scenes. Useful daily applications lead the product;
remote access, automation and multi-server connections support them as optional
capabilities. Building infrastructure does not make an application's intended
feature set complete.

## 2. Product principles

Users own accounts, data and configuration. Apps are modular, authorize requests
in their backends and remain usable when optional integrations are absent.
Keep infrastructure appropriate to a small project.

## 3. HomeCore

`homecore/` owns users, roles, sessions, 2FA, preferences, the app/permission
catalog, activity and notifications. Other backends verify user identity through
`packages/homecore-client`. HomeCloud owns files/folders/shares, not Core.

Each service owns a separate SQLite database and process. Files live in
HomeCloud's upload directory; a database alone is not the complete storage.

## 4. The three-tier layering rule

| Tier | Responsibility |
|---|---|
| 0: Core and gateway | Identity, registry and common entry point |
| 1: Applications | Own process/database; public APIs for declared hard dependencies |
| 2: HomeBridge | Optional cross-app search and consented automation |

Tier 1 rules:

- Call Core APIs; never open a sibling database.
- Declare at most one hard dependency on another app's stable public API.
  Media, Sync and Notes depend on Cloud storage; Vault, Tasks and Monitor do not.
- Do not detect optional sibling apps or add enhancement behavior to them.
  Optional interactions belong in Bridge.
- Events may be emitted without making the primary action depend on delivery.
- Apps remain functional with optional apps/Bridge stopped, subject to declared
  hard dependencies.

Bridge search forwards the current user's token to fixed configured Notes/Tasks
APIs. It stores no search query/index or browser session. Optional Monitor-to-Tasks
automation uses explicit owner consent, separate scoped Core capabilities and
encrypted operational state. Core and the target apps remain the authority.
See [search](#cross-app-search) and
[automation](SECURITY.md#automation-contract) for those contracts.

## 5. The gateway

nginx exposes the entry point and routes apps under one origin. Frontends share
`home_session_token` through `design/session.js`; this is a bearer token in
localStorage, not a cookie or a separate login per app. The shared origin is
also a shared XSS boundary.

| Path | Destination |
|---|---|
| `/` | Home dashboard |
| `/cloud/`, `/media/`, `/notes/`, `/tasks/`, `/monitor/`, `/vault/` | App frontends |
| `/sync/` | Sync information page; Android is the client |
| `/api/homecloud/`, `/api/homemedia/`, `/api/homenotes/`, `/api/homesync/`, `/api/homevault/`, `/api/hometasks/`, `/api/homemonitor/` | Corresponding backend |
| `/api/homebridge/` | Optional Bridge, or an unavailable response |
| `/api/share/` | Public Cloud share-token routes |
| `/api/core/` and remaining `/api/` | Core, including compatible legacy aliases |
| `/federation/v1/` | Core's opt-in signed peer protocol; unavailable by default |

Specific API routes precede Core's catch-all. Missing upstreams produce bounded
unavailable responses; nginx resolves app names dynamically so it can start
without every app. Streaming upload/media paths disable buffering as configured.

The gateway sets the shared CSP; only Vault's prefix permits WASM compilation.
Optional Caddy terminates public HTTPS. Raw port 8080 is HTTP and must not be
forwarded to the internet. Details: [deployment](DEPLOYMENT.md) and
[security](SECURITY.md).

## 6. Deliberate constraints and gaps

- Bundled applications use an explicit catalog/install/enable lifecycle. Core
  manages registry availability, not package downloads or container processes.
- Manifest permissions are declarative for normal browser sessions. Separate
  owner-consented application keys enforce declared file-permission subsets at
  Cloud routes; they never become general sessions. Shared-origin browser apps
  remain trusted peers. Hosting untrusted browser code would require a separate
  origin/identity design; an app-name header cannot establish that boundary.
- Cloud data is owner-only. Public share links do not implement shared folders
  or general household ACLs.
- Account disable is the supported lifecycle; there is no cross-service account
  deletion flow.
- Shared internal secrets are operator-managed. Keep service ports private.
- Vault's bounded administrator reset calls Vault's API; Core supplies live
  authority, while deletion/audit remain in Vault's own database.
- Daily backups are per-database consistent. Managed installations also offer
  manual coordinated snapshots with every project container stopped throughout
  capture and verification; configuration requires its own protected backup.
  Manual verified exports copy published archives to operator-mounted storage;
  they do not include configuration or establish physical off-machine placement.
  Real off-machine copying and restore drills still matter.
- Runtime bundles contain prebuilt services and built web UIs, with persistent
  host folders and one-time registration codes. They default to loopback access.
  The public portal remembers addresses only; it is not an identity provider.
  Bundle upgrades and standard source imports retain an offline recovery copy.
  Imports preserve Core identity and settings, then start locally. Multi-server
  identities and offline peer records are prepared separately from local sessions.
  An explicit experimental opt-in adds signed two-owner pairing and fresh peer
  status, with separate private authority/replay state. Pairing grants no account
  access; guest authentication and integrated recovery remain unfinished. The
  [pairing design](PAIRING-DESIGN.md) defines these boundaries.

Use [API.md](API.md) for contracts, [DEPLOYMENT.md](DEPLOYMENT.md) for operations
and [ROADMAP.md](ROADMAP.md) for remaining work.

### Bundled application lifecycle

Fresh Core databases start with an empty installed list and a trusted seven-app
catalog. An administrator installs a catalog manifest, which creates a disabled
registration with declared routes, permissions and hard dependencies. Enablement
is a separate action. Dependencies must be installed before installation and
enabled before enablement; active dependants block disabling their foundation.
HomeCloud retains its existing protected status and cannot be uninstalled.

The additive `installed` column adopts existing registrations in place, including
disabled/custom entries, without changing IDs, routes, permissions or history.
Startup seeds permissions only; it does not reinstall removed apps or overwrite
registration metadata. Uninstall hides a registration and disables it while
retaining the row, all application data and historical references. Related
automation grants are revoked with audits in the same transaction. Reinstall
reuses the ID and requires a fresh enable action; revoked consent stays revoked.

The distribution already contains these services. Installation does not fetch
remote manifests, run arbitrary code or start/stop Docker. Direct browser
URLs/APIs retain their existing identity/role/ownership checks; registry visibility
does not sandbox those sessions. Application keys separately require live enabled
caller/Cloud registrations and declared permissions. Legacy explicit administrator
metadata registration/re-registration remains compatible, including its default
enabled state. New clients use the catalog's two-step flow. This is a bundled-app
lifecycle, not a third-party package marketplace.

## Product contract

HOME is a private personal/family environment. The user owns the hardware,
accounts, files and configuration. Local operation must work without internet
access, third-party identity or a project-operated directory/relay. Remote access,
external providers and integrations are optional.

- Preserve existing accounts, files, sessions and public APIs during compatible
  changes. Migrations should be additive and reversible.
- Apps declare identity, routes, health, permissions and hard dependencies.
  Installation/enablement is explicit; uninstall must not silently delete data.
- Each service owns its schema. Small structured records stay in the owning
  service; file bytes and file metadata belong to Cloud's public storage API.
- Core owns identity, sessions, roles, preferences, registry, activity and
  notifications. Use canonical `/api/core/` routes and preserve compatible aliases.
- Validate inputs, ownership, quotas and authorization in backends. Registry
  declarations alone are not authorization. New external application consumers
  must use owner-consented scoped keys, never the user's full browser session.
  Add further route/audience permissions only for a concrete consumer; unsupported
  key permissions and session-only routes fail closed.
- Failed activity/event delivery must not undo a successful primary operation.
  Optional cross-app reactions belong in Bridge.
- Vault encrypts titles/content in the browser, never gives usable keys to the
  backend and requires independent review before real secrets. HomeAI must never
  receive decrypted Vault data.
- New functionality needs loading, empty, error and unavailable states,
  keyboard/mobile access, health, backup and migration considerations.
- Use bounded logs/request identifiers and the existing API error contracts;
  never log credentials, raw tokens, Vault plaintext or sensitive file content.

| Application | Contract |
|---|---|
| Home | Shared dashboard, navigation and notification bell |
| Cloud | Owned files/folders/shares; storage API for other apps |
| Media | Browse Cloud files without a second file store |
| Notes | Markdown workspace with sanitized rendering and Cloud attachments |
| Sync | Android media backup with durable queue/retry/dedup and explicit permissions; retain whole-file retry and WorkManager battery constraints |
| Tasks | Personal projects, dates, priorities, repetition and optional reminders; explicit task-level assignment with owner control |
| Monitor | Admin-only, read-only health/storage/backup information; no Docker socket |
| Bridge | Optional cross-app search and explicitly consented automation |
| AI (future) | Optional consumer of authorized data; no bypass of ownership or Vault access |

### Application maturity and direction

"Built" means the listed baseline exists, not that the original application
vision is exhausted. A v0 label describes a bounded first iteration; it is not
permission to forget remaining work. This source audit distinguishes implemented
behavior from retained targets; it does not certify every browser/device journey.
The [roadmap](ROADMAP.md) owns unfinished work and its order.

| App | Current implemented baseline | Retained direction / limits |
|---|---|---|
| Home | Greeting, installed-app launcher, Cloud quota, Core health/activity, notifications, settings and administration | A useful personal daily overview; preserve hierarchy and quiet working space as more apps become useful |
| Core | Local identity/2FA/sessions, preferences, registry lifecycle, events/notifications, scoped Cloud application keys and fixed-purpose delegations | Current permission scopes are bounded; future AI/other consumers need explicit consent and appropriate audience/resource enforcement |
| Cloud | Owned files/folders, file/folder-tree uploads with a bounded queue, search/sort, ZIP downloads, share links and Trash; storage APIs for apps | Versioning and designed encryption at rest; public links are not same-HOME shared-folder ACLs |
| Media | Cloud-backed gallery/timeline, albums/favorites/search, EXIF, image thumbnails, bounded video posters, browser uploads and image/video/audio playback | Duplicate review and local-family shared albums; retain Cloud as the single file store |
| Notes | Markdown preview, folders/tags/search/favorites, debounced autosave, versions/restore and Cloud attachments | Save/draft safety, templates, designed offline editing and local collaboration; history is not conflict resolution |
| Sync | Android media categories and optional Downloads scanning, WorkManager scheduling/retry, live work state/stages/counts, hash dedup and aggregate backup summary | Durable run history, exact unmet-constraint diagnostics, changed-file detection and chosen document/folder access; physical/background validation remains open |
| Tasks | Personal projects/dates/priorities/search, completion history, fixed repeats, opt-in reminders and local task assignment | Richer recurrence; keep owner control and distinguish individual assignments from collaborative projects |
| Vault | v0 encrypted login/note/card items, create/unlock/recover, Trash, password/recovery-key changes, administrator reset and client benchmark | Independent review is still required before real secrets; broader structured secret workflows remain design targets |
| Monitor | v0 read-only CPU/memory/network/disk, application health, backup freshness, storage forecast and alerts | Preserve read-only scope; Docker Desktop metrics describe its VM, and health/freshness checks do not certify physical disks or recoverability |
| Bridge | Optional Notes/Tasks search and separately consented Monitor-to-Tasks automation | Additional personal summaries/search/workflows require concrete source APIs and consent; no mandatory cross-app coupling |
| AI | Not started | Optional private assistant for authorized data, with a first use case and consent/retrieval design; no decrypted Vault access |

The original Sync-to-Cloud-to-Media flow is already represented in the code:
phone media uses Cloud storage and Media browses those files without a second
original-file silo. Reuse that foundation. Similarly, Notes history/attachments,
Media EXIF/playback, Monitor networking/forecasting and Tasks reminders/assignment
must not be relisted as absent merely because a short app description omits them.

This guide replaces `HOME_MASTER_SPECIFICATION.md` (product contract),
`HOME_ARTISTIC_DIRECTION.md` and `DESIGN_SYSTEM.md` (design). Historical section
numbers in source comments identify their original rationale, not current headings.
Development, CI and release guides have moved into `CONTRIBUTING.md`.
Current endpoint contracts are in [API.md](API.md).

## Task ownership and assignment

A task always belongs to its original local Core user (`user_id`). A single
optional assignee receives access only to that task's title, notes, priority,
dates, completion state and owner/assignee identity labels. The owner can edit,
reassign, unassign, reopen or delete it; the assignee can read, complete or decline.
Administrators have no override into another person's tasks. Core resolves an
exact enabled username through its authenticated API; Tasks owns its ACL and
metadata-only assignment audit, never a sibling account database.

Projects, sibling tasks and the owner's reminder schedule/state are not shared.
Personal task lists, summaries and Bridge search keep their owner-only defaults;
the dedicated Assigned to me view uses an explicit assigned scope, including
completed tasks. Owner edits remain visible while assignment is active. Unassign,
reassign, decline or deletion removes access on the next request; already disclosed
copies cannot be erased. Assignees cannot reopen tasks or change reminders.

Completion by either participant keeps the original owner and private project.
A repeat creates one next occurrence with the same assignee and no reminder;
assignment/decline applies to each occurrence separately. Owner undo retains the
existing rule: remove the open next occurrence, refuse if it is already complete.
Versioned assignment writes reject stale lookups/clients; completion rechecks
access and repeat creation in one immediate transaction. No assignment email,
push, project collaboration or multi-server identity is introduced. Restored
assignment ACLs must be revoked offline before reopening Tasks.

## Android destination ledger

Room v2 adds a destination key to backup records and replaces global media-ID
uniqueness with `(destinationKey, localMediaId)`. The key hashes the canonical
configured gateway URL (including scheme/port/path) and the authenticated local
Core account ID, never a bearer token. Login responses establish that account;
legacy sessions verify identity through Core using a captured URL/token pair.
Queued work does not yet support multiple profiles.

The v1 ledger recorded no destination, so its rows keep their original IDs,
hashes, sizes and timestamps with an empty legacy destination. They remain
retained history and are excluded from destination deduplication/totals. A first
scoped run hashes/checks these files again; Cloud's per-user hash dedup avoids
uploading content the server already has. Do not assign all old rows to whichever
account happens to be active at upgrade. Offline totals require a previously
verified account; an unknown legacy session reports unavailable history.

This is a persistence prerequisite, not multi-server backup enablement. Device
IDs, settings, profiles and WorkManager inputs/names must still be scoped. No
application ID changes and no destructive Room fallback are permitted. Preserve
an offline database backup before upgrade; downgrade to v1 cannot read Room v2.
Use an isolated pre-upgrade recovery copy rather than deleting columns/history or
trying to recreate global uniqueness after scoped duplicates have been recorded.

## Media video posters

Posters use the browser's existing video decoder, not a new server executable.
This retains the current codec-support boundary and avoids adding FFmpeg/runtime
dependencies. An offscreen video captures its first decoded frame into a JPEG
with maximum dimension 640px; it stops after eight seconds and refuses canvas
capture above 16,777,216 source pixels. It never plays audio or stores originals.
Unsupported/corrupt sources, queue overflow and exhausted budgets retain the
generic video placeholder. It does not sample a representative scene.

Visible tiles request at most two concurrent decodes and queue at most 24 jobs.
The memory-only cache keeps at most 48 entries/4 MiB of JPEGs, expires successes
after five minutes and failures after 30 seconds, and keys entries by Cloud ID,
size, creation time and MIME type. A changed login clears entries and rejects old
results; sign-out unmount clears the cache. Library/favorites/album grids, covers
and the picker reuse it. Optional cover metadata times out after five seconds;
album names/counts remain usable if Cloud previews are unavailable.

An authenticated poster ticket probes Cloud ownership with one byte, then permits
at most eight range requests, 2 MiB per reservation and 16 MiB total, with a fixed
15-second deadline and no-store responses. Limits are reserved before network
awaits; ignored ranges and oversized streams fail closed. Each use still goes
through Cloud's authorized download. Public media responses carry a sandbox CSP
so navigating to an uploaded HTML/SVG cannot execute it as a HOME document.

This is a session cache of already delivered client pixels, not an authorization
or offline store. Existing Cloud file IDs have immutable bytes; any future file
replacement/version API must update poster invalidation. No schema migration or
new decoder dependency is required. Rolling back the backend makes new poster
requests fall back; ordinary playback endpoints remain compatible.

## Android backup feedback

The Home screen observes both unique manual/periodic WorkManager flows. Worker
progress reports scan/hash/server-check/upload stages and discovered/uploaded/
already-on-server/failed counts; terminal manual results carry the final counts.
The UI refreshes aggregate totals on actual work transitions, rather than a
four-second timer. Manual enqueue uses KEEP so another tap cannot replace an
active transfer. Hash/read failures request retry; cancellation is rethrown.

ENQUEUED is labelled queued/scheduled (or retry queued after an attempt), with an
explicit Android scheduling/network/battery wait explanation. It does not claim
the exact currently unmet constraint. Periodic work returns to Scheduled and
WorkManager may prune old work; the latest retained manual result is not a durable
run history. No file names, credentials or new persistence are stored in progress.
The application ID, Room schema, global work names and schedule constraints stay
compatible. Rollback ignores the additional progress/output fields.

## Cloud folder uploads

Cloud's browser queue sends at most three whole-file uploads concurrently and
retains at most 1000 rows. Folder selection/drop preserves relative paths of
files, validates depth/names, reuses owned folders with SQLite ASCII NOCASE
semantics and creates missing folders through the ordinary authorized API.
Each selection captures its starting folder and session; a changed session fails
closed. The server still enforces ownership, quota and upload validation.

Rows expose progress, failures and explicit retry/cancel; switching file tabs
retains the queue. Internal navigation/sign-out confirms cancellation, while
reload/close uses the native browser prompt. Refresh loses in-memory state.
Empty directories, chunked/resumable uploads and persistent queues are not
implemented. Cancellation/partial failure keeps folders/files already committed;
a retry after an ambiguous network failure can upload another copy. Rollback
restores the previous frontend: no API or database migration is involved.
## Personal Notes templates

An owner can save an active note as a named, immutable template snapshot after
the editor successfully flushes pending title/content/tag saves. The name is
1–100 characters, unique per owner using SQLite NOCASE, with at most 100 personal
templates. Lists expose summaries rather than whole Markdown bodies.
Starting from a template creates an independent note with the original title,
Markdown and tags. Folder, favorite state, Cloud attachment references and version
history are excluded. Markdown links remain literal text, so links in a template
still point to their original resources and keep their normal authorization.
Removing a template never removes source notes, generated notes or Cloud files.
Changing either a source or generated note never mutates the saved snapshot.

The owning Notes database adds `note_templates`; existing rows/APIs are unchanged.
Older binaries ignore the additive table on rollback. Retain it and its snapshots
rather than dropping user data. Template bodies use the existing sanitized Notes
editor and do not introduce shared/collaborative or cross-server permissions.

## Notes save safety

Notes serializes title/content/tag autosaves in the current editor. Internal
navigation offers save-and-leave, keep-editing or explicit queued-change discard;
save failures retain fields in memory for retry. Reload/close asks the browser's
native unsaved-work question, and intentional sign-out confirms discard. A request
already sent may complete even if queued edits are discarded. Attachment refreshes
update metadata without replacing draft text; version restore/Trash flush edits
first. A new note route owns a fresh queue, and late old-token failures cannot
clear a newer session. Core remains the authority and ordinary Notes APIs remain
unchanged.

Draft plaintext is not written to localStorage/IndexedDB or retained across logout,
session expiry or a confirmed page close. This prevents an implicit offline cache;
browser/OS termination can still lose unsaved work. Multi-tab/user conflicts and
persistent offline recovery need their own privacy and conflict design.

## Cross-app search

Home's Search submits explicitly to optional Bridge. Bridge verifies the live
user and enabled-source registry, then forwards the same bearer token to fixed,
operator-configured Notes/Tasks origins; source APIs enforce ownership. Never
trust registry URLs as proxy targets or follow upstream redirects. Vault is excluded.

Queries are 2–200 trimmed characters, sent in a POST rather than a URL.
Registry/source reads have five-second deadlines and 1 MiB response limits;
return at most 20 results per source with a limit notice. Keep query text,
upstream bodies and credentials out of logs; responses use `Cache-Control: no-store`.
There is no persistent index, result cache or browser-token storage.

Show partial/unavailable/limited results distinctly from an empty success.
Disabled sources are not contacted; registry failure fails closed. Retry is
explicit. Search-only operation needs no database or automation credentials.

## Design

HOME uses warm Atari-era materials with modern, accessible layouts. Keep daily
work calm and readable. The room metaphor gives each application a familiar purpose.
Shared identity and individual personality are equally important: each room
should be recognizable and suited to its work. Personal content, useful status
and clear actions lead; decorative effects and technical details stay secondary.
The product should feel owned, familiar and dependable rather than demanding
attention. Preserve HomeCloud's established conventions while the suite grows.

Use the original five-second test when reviewing a screen: can the person
recognize their own things, find the useful capability, understand the next action
and see an honest account of its state? The dashboard needs hierarchy for useful
recent information, apps, activity and status; it should stay useful without
turning into a wall of monitoring controls. Keep each app's working interface.

### Source of truth

Edit shared assets in `design/`, then run `design/sync-assets.sh`. Do not edit
the generated copies under apps.

| Source | Purpose |
|---|---|
| `tokens.css` | Colors, fonts, radii, depth and retro overrides |
| `components.css` | Buttons, panels, controls, storage gauges and shared states |
| `retro.js` / `RetroControl.jsx` | Off/Subtle/Full preference, shared through `home-retro` |
| `session.js` | Shared session-token handling |
| `icons/` / `AppIcon.jsx` / `Wordmark.jsx` | Canonical app marks and wordmark |
| `make-favicons.mjs` | Generated browser/PWA icons and Android adaptive foreground |

When an icon or brand color changes, run `node design/make-favicons.mjs`,
then sync assets. Commit the generated outputs. When adding an app, register
it with the sync/icon tools and reuse existing components.

CSS load order: tokens, app layout styles, shared components. Override supported
variables instead of forking shared files.

### Colors and type

Use named tokens, not copied hex values. Dark surfaces are warm brown-black;
light surfaces are cream/paper. Higher dark surfaces get lighter; raised light
surfaces get slightly darker.

| Token | Use |
|---|---|
| `--bg`, `--panel`, `--panel-raised` | Surface hierarchy |
| `--text`, `--text-dim` | Primary/secondary text |
| `--amber`, `--amber-dim` | Accent and attention |
| `--teal` | Healthy/informational |
| `--red` | Danger/error |
| `--on-accent` | Text on accent surfaces |

Vault stays restrained. Never copy another company’s branding.

Headings use Fredoka, reading text Inter, labels/numbers IBM Plex Mono.
Bundle fonts locally through `@fontsource`; no external font CDN.

### Retro intensity

| Mode | Behavior |
|---|---|
| Off | Warm palette/type; remove decorative stripes, wood, frames, raised effects and scanlines |
| Subtle (default) | Restrained stripes, hard button depth, cartridge folders, print frames and ruled notes |
| Full | Stronger depth/stripes and dark scanlines, still without glow |

New decoration needs an Off behavior. Do not add Full-only intensity to Subtle.
Use woodgrain on at most one hero surface per screen, currently the dashboard
and Tasks Today header. Forms and working lists stay quiet.

### Application character

- Home: entrance/dashboard, wood header and app controls.
- Cloud: archive, cartridge folders and clear file rows.
- Media: gallery, print frames and albums.
- Notes: study, restrained ruled-paper treatment.
- Tasks: desk, clear due/overdue/priority words and Today header.
- Monitor/Sync: quiet utility/status interfaces.
- Vault: restrained safe, thin brass details rather than loud decoration.

### Interaction and accessibility

- Familiar controls, consistent placement and clear wording.
- Visible keyboard focus, labels, adequate contrast and usable touch targets.
- Never communicate status only through color; write overdue/error states.
- Respect reduced motion. Motion communicates state; sound is off by default.
- Show actionable loading, empty, error and unavailable states.
- Check actual narrow layouts and Android interaction separately.
- No neon, blurred glow, decorative animation spam or copied trademarks.

### Icons and Android

Use the shared simple geometric icon family and common frame. Generate
favicons/adaptive foregrounds from those sources; keep the Android adaptive
mark in its safe zone. Native Android uses the shared palette and recognizable
actions while following platform navigation/permission conventions.
