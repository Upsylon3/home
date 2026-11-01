# API reference

All routes require `Authorization: Bearer <token>` unless noted
otherwise. Get a token from `POST /api/auth/login` (and, if 2FA is
enabled, `POST /api/auth/2fa/verify`). Admin routes additionally require
the signed-in user to have the `admin` role.

Paths below are as reached through the gateway (`http://<host>:8080/...`)
— see [ARCHITECTURE.md](ARCHITECTURE.md) §5 for how each prefix maps to
a backend service.

Application backends delegate identity to HomeCore. An invalid/disabled
session returns `401` from those backends. An unavailable or malformed
HomeCore response returns `502`, a verification timeout returns `504`, and
verification capacity exhaustion returns `503`; clients should keep their
session and allow retry for these failures. A successful verification may
be cached for up to five seconds, so account revocation propagates to an
application backend within that window. HomeCore itself checks immediately.

## HomeCore (`/api/auth`, `/api/admin`, `/api/activity`, `/api/core`)

Identity, sessions, 2FA, the application registry, permissions, and the
shared activity/notifications feed. No files live here.

### Scheduled-delegation authority

Decision 002's authority, action APIs and opt-in worker/controls are implemented.
Default Compose operation remains search-only; enrollment requires protected
automation storage and explicit owner consent in Home Settings.
Browser JWTs and opaque capabilities are separate principal types; ordinary
browser routes reject capabilities.

| Method | Path | Authorization and result |
|---|---|---|
| GET | `/api/core/delegations` | Full owner session; `{grants: [...]}` metadata only |
| DELETE | `/api/core/delegations/:id` | Full owner session; revoke own grant, idempotent `204`; foreign/missing `404` |
| POST | `/api/core/delegations/verify` | Capability bearer; exact `{audience, action}`; `{delegation: ...}` or `403` |
| POST | `/api/core/delegations/surrender` | Capability bearer; no body fields/query parameters; revoke only its own parent grant; `204` |
| POST | `/internal/delegations` | **Internal server only**, full administrator session; exact `{integrationId: "monitor-followup-v1", consent: true}`; `201` |
| POST | `/internal/delegations/:id/renew` | **Internal server only**, full owner administrator session; exact `{consent: true}`; `200` |

The gateway returns `404` for the internal issuance prefix. Direct Core ports
must remain private. Origin/Fetch Metadata browser requests are rejected by
issuance; these headers are defense in depth, not server authentication.
The enrollment server forwards the consenting owner's full session,
persists the returned capabilities encrypted, and returns metadata to browsers.
No shared internal secret can mint a grant. Pending-2FA sessions cannot mint.

Surrender is lifecycle-only authority: it never reads data or creates/renews a
grant. Either audience may surrender its own grant even after expiry, account
invalidation or registry disable. A malformed/non-capability bearer is `403`;
an unknown/rotated well-formed opaque credential receives the same blind `204`
without affecting replacement credentials. Audit actor is null with a
metadata-only `homecore.delegation.surrendered` event. This lets a disabled
Bridge retry revocation after restart without retaining a browser session.

Issuance/renewal returns `{grant, capabilities}`. Each capability contains
`id`, `audience`, `action` and a once-returned `token` (`hc_dg_` plus 256 random
bits); Core stores SHA-256 hashes only. The fixed pair is `homemonitor` /
`monitor.alerts.read` and `hometasks` / `tasks.automation.create-once`. No
caller-chosen subject, scopes or expiry are accepted. A grant lasts 30 days
from consent and binds the account's current token version. A second create
returns `409`; renewal preserves grant identity and rotates both credentials
atomically. Renewal requires fresh consent even after expiry or revocation.

Owner metadata includes ID, subject, integration, timestamps, capability
IDs/audiences/actions, `dailyCreateLimit: 20` and status (`active`, `revoked`,
`expired`, `invalidated`, `apps-disabled`). It never includes tokens or hashes.
Listing/revoking one's own grant remains possible after role loss with a valid
new session. Every verification reads current grant, enabled administrator,
token version and both required registry entries. Disabled/missing apps,
expiry, revocation, demotion and session invalidation refuse verification.
No successful check is cached. Unknown state fails closed.

The verified principal contains only `kind: "delegation"`, `subjectUserId`,
`grantId`, `credentialId`, `integrationId`, `audience`, `action`, `expiresAt`
and `dailyCreateLimit: 20`. The Tasks action enforces this limit transactionally.
`@home/homecore-client` exports
`createDelegationVerifier`, `verifyDelegation` and `requireDelegation` for
fixed route audiences/actions. The middleware sets only `req.delegation`;
it does not populate browser `req.user` or widen `requireAuth`.

Delegation replies use `Cache-Control: no-store`. Invalid input returns `400`,
missing/invalid owner sessions `401`, insufficient authority `403`, unknown
owner grant `404`, existing grant or unavailable required apps `409`.
Verification/issuance has a 120-request/minute IP limit (`429`). Shared-client
errors are retryable `502` (unavailable/malformed), `503` (busy) or `504`
(five-second request/body deadline). It rejects redirects and replies over
8 KiB, permits at most 100 pending checks and strips unknown principal fields.

### Session and platform routes

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | Create an account (first ever = admin) |
| POST | `/api/auth/login` | Log in (or start 2FA if enabled) |
| POST | `/api/auth/2fa/verify` | Complete login with a 2FA/recovery code |
| GET | `/api/auth/me` | Current user (id, username, role, quota override) |
| POST | `/api/auth/change-password` | Change password, revokes other sessions |
| POST | `/api/auth/logout-everywhere` | Revoke every session |
| POST | `/api/auth/2fa/setup` \| `/confirm` \| `/disable` \| `/recovery-codes` | 2FA lifecycle |
| GET | `/api/activity` | HomeCloud-scoped activity feed for the current user |
| GET | `/api/admin/activity` | *(admin)* HomeCloud-scoped activity feed, every user |
| POST | `/api/admin/users/:id/disabled` \| `/role` \| `/quota` | *(admin)* Account management |
| POST | `/api/admin/users/:id/2fa/disable` | *(admin)* Reset a lost-phone 2FA |
| POST | `/api/admin/users/:id/reset-password` | *(admin)* Set a new password for someone who forgot theirs; revokes their sessions |
| GET | `/api/core/health` | *(no auth)* Liveness/storage check |
| GET | `/api/core/system` | System info (version, uptime) |
| GET | `/api/core/users/me` | Identity fields HomeCore itself owns (displayName) |
| GET | `/api/core/users/me/sessions` | Active sessions for the current user |
| GET/POST/PATCH/DELETE | `/api/core/apps` \| `/apps/:id` | The application registry |
| GET | `/api/core/permissions` | The declared permission catalog |
| GET | `/api/core/activity` \| `/activity/me` | Cross-application activity feed |
| GET | `/api/core/notifications` | Notifications for the current user |
| PATCH | `/api/core/notifications/:id/read` | Mark one as read |

Registration atomically assigns the administrator role to exactly the first
created account. A username claimed by a concurrent registration returns
`409 { error: "That username is already taken." }`.

`POST /internal/events`, `GET /internal/users/usage`, `GET /internal/apps`
and `POST /internal/notifications` (not shown above) are machine-to-machine
routes authenticated with a shared secret (`HOMECORE_INTERNAL_SECRET`), not a
user token. They all use the one check in `homecore/src/internalAuth.js`.

- `GET /internal/apps` returns the registry as `{ apps: [{ slug, name, healthUrl, enabled }] }`
  (first user: HomeMonitor's health checks).
- `POST /internal/notifications` takes `{ applicationSlug, type, title, body?, data?, audience: "admins" }`
  and creates one notification for every enabled admin account. Answers
  `201 { delivered: n }`. `"admins"` is the only audience so far.

## HomeCloud backend (`/api/homecloud`, `/api/share`)

File storage: upload, folders, Trash, share links.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homecloud/health` | *(no auth)* |
| GET | `/api/homecloud/files/quota` | Usage/quota for the current user |
| GET | `/api/homecloud/files` | List files (optionally `?folderId=`) |
| GET | `/api/homecloud/files/all?type=image\|video\|audio\|application` | Cross-folder listing by mime type (used by HomeMedia) |
| GET | `/api/homecloud/files/trash` | List trashed files |
| GET | `/api/homecloud/files/shares` | List this user's share links |
| POST | `/api/homecloud/files/upload` | Upload (multipart, field `file`) |
| GET | `/api/homecloud/files/:id/download` \| `/thumbnail` | Download / preview |
| POST | `/api/homecloud/files/:id/move` | Move to another folder |
| POST | `/api/homecloud/files/download-batch` | Download several files as one zip |
| POST | `/api/homecloud/files/:id/share` | Create a share link |
| DELETE | `/api/homecloud/files/shares/:shareId` | Revoke a share link |
| DELETE | `/api/homecloud/files/:id` | Move to Trash |
| POST | `/api/homecloud/files/:id/restore` | Restore from Trash |
| DELETE | `/api/homecloud/files/:id/permanent` | Permanently delete |
| GET | `/api/homecloud/folders` | List folders (optionally `?parentId=`) |
| GET | `/api/homecloud/folders/all` | Full folder tree |
| POST | `/api/homecloud/folders` | Create a folder |
| PATCH | `/api/homecloud/folders/:id` | Rename |
| POST | `/api/homecloud/folders/:id/move` | Move to another parent |
| DELETE | `/api/homecloud/folders/:id` | Delete (must be empty) |
| GET | `/api/share/:token` | *(no auth)* Download a shared file |

## HomeMedia backend (`/api/homemedia`)

Photo, video and music library. Stores no media itself — every file byte
is fetched from HomeCloud on demand, and uploads made here are stored by
HomeCloud (in a top-level `HomeMedia` folder).

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homemedia/health` | *(no auth)* |
| GET | `/api/homemedia/library?type=image\|video\|audio` | Photo/video/music library (animated GIFs count as photos) |
| GET | `/api/homemedia/upload-folder` | Id of the HomeCloud folder uploads go to (created on first use) |
| POST | `/api/homemedia/upload` | Upload one file (multipart, field `file`, optional `folderId`); streamed straight to HomeCloud |
| POST | `/api/homemedia/:fileId/ticket` | Short-lived playback link for one file — what `<video>`, `<audio>` and `<img>` tags load, since they can't send a login header |
| GET | `/api/homemedia/stream/:ticket` | *(no auth — the ticket is the credential)* Streams the file, with Range support so seeking works |
| GET | `/api/homemedia/:fileId/exif` | Cached EXIF data for one file |
| GET | `/api/homemedia/:fileId/thumbnail` | Gallery-quality thumbnail (640px) |
| GET/POST | `/api/homemedia/albums` | List / create albums |
| GET/PATCH/DELETE | `/api/homemedia/albums/:id` | View / rename / delete an album |
| POST/DELETE | `/api/homemedia/albums/:id/items` \| `/items/:fileId` | Add / remove a photo from an album |
| POST/DELETE | `/api/homemedia/favorites/:fileId` | Favorite / unfavorite a file |

## HomeMonitor backend (`/api/homemonitor`)

Server, service and backup visibility. Browser routes are **administrators
only**: except `health`, they need a login and refuse signed-in non-admins
with `403`. The separate automation route accepts only its scoped capability.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homemonitor/health` | *(no auth)* |
| GET | `/api/homemonitor/status` | The latest reading: `system` (CPU %, memory, load, uptime, network), `disks`, `services` (up / degraded / down / unknown, with response time), `backups`, and the active `alerts` |
| GET | `/api/homemonitor/history?hours=24` | Chart samples (CPU, memory, fullest disk, network), oldest first; 1 to 48 hours |
| GET | `/api/homemonitor/disk-growth?days=90` | Daily disk usage per disk, plus a rough `forecast` (`daysUntilFull`, `bytesPerDay`) or `null` when there isn't enough history (about 3 days) or the disk isn't growing |
| GET | `/api/homemonitor/automation/alerts` | `homemonitor` / `monitor.alerts.read` capability only; curated incident projection |

The automation response is `{instanceId, evaluatedAt, conditions}`. Each
condition contains only `key`, `incidentId` (UUID or null before first opening),
`state` (`active`, `pending`, `resolved`, `unknown`), `severity` (`warning` or
`critical`), `title` (at most 200 characters, controls replaced with spaces)
and `openedAt` (ISO time or null). No diagnostics, paths, status snapshots or
notification bodies are included. At most 256 conditions and 256 characters
per key are returned; oversized projections fail with `503`, never truncate
away an incident. Query parameters are refused with `400`.

Instance and incident UUIDs survive restarts and severity changes. Unknown
readings, unreadable disks and missing targets retain open identity and return
`unknown`; only positive clear resolves it. Up/degraded services, healthy
backups and disks below the hysteresis margin supply positive clear. A later
opening gets a new incident ID. Resolved conditions retain the previous ID
while still observed. Legacy open alerts receive an ID during migration but
remain unknown until evaluated.

Alert state, evaluation timestamp and notification intent commit together.
Delivery failure cannot make a fresh feed carry old alert state. Notifications
retry from a durable ordered queue (100 per batch, capacity 1000); partial
delivery/crash before acknowledgment can duplicate notifications, as before.
Queue saturation rolls back evaluation, preserving the older freshness time.
`ALERTS_ENABLED=false` suppresses new notification intent and delivery; any
previously queued failure remains pending until delivery is enabled again.
Existing browser status/history response fields remain compatible.

No successful evaluation yet returns `503`. Otherwise the feed returns its
actual committed evaluation time, including when stale; consumers must enforce
the decision's two-minute age, 30-second future tolerance and strictly newer
observation checks. Reading the feed does not trigger collection. Responses
are `no-store`, and every request verifies authority live in Core. Browser JWTs
and wrong audiences return `403`; capabilities cannot read broad browser APIs.

Settings are environment variables, all optional (see `apps/homemonitor-backend/src/config.js`):
`MONITOR_INTERVAL_SECONDS` (30), `DISK_PATHS` (`label=path,...`), `BACKUP_DIR`,
`BACKUP_MAX_AGE_HOURS` (36), `DISK_ALERT_PERCENT` (80), `SERVICE_DOWN_CHECKS` (2),
`GATEWAY_URL` / `SERVICE_URLS` (where to reach each app's health endpoint),
`ALERTS_ENABLED` (`false` shows alerts on screen without sending notifications).

## HomeBridge (`/api/homebridge`, optional)

Tier 2 search remains stateless, with no retained query, result or browser
session. Automation is separately configured and off by default.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homebridge/health` | *(no auth)* Process health only |
| POST | `/api/homebridge/search` | Authenticated `{query, sources}`; 2–200 trimmed characters, one or both of `homenotes`, `hometasks`, without duplicates |
| GET | `/api/homebridge/automation` | Own session; `{configured, rule}` metadata, or `configured: false` with no state/key |
| POST | `/api/homebridge/automation/enroll` | Full administrator session; exact `{consent: true}`; enroll/renew own rule and confirm current Monitor instance |
| POST | `/api/homebridge/automation/disable` | Own session; exact `{}`; stop dispatch immediately and surrender the stored grant |

Mutations refuse query parameters and caller-chosen subjects/scopes. Enrollment
lists the owner's Core grants, creates or renews the fixed integration on
private Core routes, encrypts the pair while disabled, validates a fresh Monitor
projection and only then enables the rule. Failure compensates with surrender;
persisted revocation failures stay disabled and retry after restart. An orphan
grant remains visible/revocable directly through Core if storage itself fails.
Concurrent enrollment returns `409`; missing configuration `503`, rejected
consent `400`, non-admin `403`, upstream enrollment failure `502`.

Control replies contain `{rule}` and `200`, or `202` while revocation remains
pending. Rule metadata includes grant/source IDs, exact expiry, `enabled`,
`revocationPending`, `status`, bounded reason code, last checked/success/delivery
times, retry time, qualifying count and pending count. No credential, ciphertext,
key, payload or browser session is returned. A non-admin can still see/disable
their own existing rule with a valid session. Home Settings independently lists
Core grants and offers direct owner revocation when Bridge is unavailable.

The worker starts a cycle every five minutes. Four strictly newer critical
evaluations must span 15 minutes with no gap over ten minutes; feed age must
be at most two minutes and future skew at most 30 seconds. Warning, unknown,
missing/stale/non-new readings, outages and restart reset incomplete qualification.
Changed Monitor instance pauses for fresh consent. Qualified intent persists
its canonical bounded title/notes/key encrypted before dispatch. Every write
or retry reads the fresh source again; positive resolution cancels pending
delivery without modifying an existing task. Tasks also verifies Core live.

SQLite leases prevent overlapping cycles per rule and permit only four cycles
across workers sharing the database. Each cycle sends at most four pending
deliveries; disabled/unknown conditions cannot starve eligible incidents.
Leases last 60 seconds; expired workers recheck ownership before dispatch.
Requests refuse redirects, cap streamed replies at 256 KiB and cover headers
and bodies with a five-second deadline. Retry uses the next five-minute tick,
honoring longer numeric/date `Retry-After` values capped at 24 hours. Conflicts
pause for attention; auth refusal/expiry pause; outages retain canonical intent.
Delivered identities survive restart/renewal and discard pending payloads.

Returns `{groups, limit: 20}`. Each group has `source`, `name`, `status`
(`ok`, `disabled`, `unavailable`), `limited`, and `results`. Each result has
`source`, `id`, `title`, `excerpt`, `href`. Source-native matching/order apply:
Notes excludes Trash and searches title/content; Tasks searches title/notes,
including completed tasks. Titles/excerpts are bounded to 240/160 characters.
An unavailable source leaves other results intact. Missing/disabled apps are
never contacted. Registry failure returns 502, not unverified results. Request
validation returns 400, oversized request bodies 413; authentication uses the
shared HomeCore client. Responses are `no-store`; query text is a POST body,
not a gateway access-log URL. Upstream calls refuse redirects and enforce
five-second header/body deadlines and 1 MiB response limits. See
[the decision record](decisions/001-homebridge-search.md).

HomeTasks supports `/tasks/all?task=<id>` and `/tasks/done?task=<id>` resource
links, opening the existing editor through the owned-task API. These links
work independently of HomeBridge. HomeNotes links use `/notes/notes/<id>`.

## HomeTasks backend (`/api/hometasks`)

Tasks and projects. Browser routes except `health` need a login, and every
query is scoped to the person asking, so nobody can see or change anyone
else's tasks. Dates are plain `YYYY-MM-DD` strings. The browser sends its own
date as `?today=` for the date filters, because the server cannot know a
person's time zone.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/hometasks/health` | *(no auth)* |
| GET | `/api/hometasks/summary?today=` | Counts: `open`, `overdue`, `dueToday` |
| GET | `/api/hometasks/projects` | List projects, each with its `openCount` |
| POST | `/api/hometasks/projects` | Create a project `{ name }` |
| PATCH | `/api/hometasks/projects/:id` | Rename `{ name }` |
| DELETE | `/api/hometasks/projects/:id` | Delete the project only; its tasks stay, with no project |
| GET | `/api/hometasks/tasks` | List tasks. Filters: `status=open\|done\|all` (default open), `projectId`, `due=overdue\|today\|upcoming\|none` (with `today=`), `search` |
| POST | `/api/hometasks/tasks` | Create `{ title, notes?, priority?, dueDate?, repeat?, projectId? }`; priority is `none\|low\|medium\|high`; `repeat` is `none\|daily\|weekdays\|weekly\|monthly\|yearly` and needs a `dueDate` |
| GET | `/api/hometasks/tasks/:id` | Read one task |
| PATCH | `/api/hometasks/tasks/:id` | Change only the fields sent; `null` clears `dueDate` / `projectId`. A repeating task can't have its date cleared, and an undated task can't be made to repeat |
| POST | `/api/hometasks/tasks/:id/complete?today=` | Tick off (safe to repeat). For a repeating task the task stays in Done and the response also carries `next`, the new copy with the following due date, always after `today`. Ticking twice never creates two copies |
| POST | `/api/hometasks/tasks/:id/reopen` | Un-tick (safe to repeat). Removes the still-open next copy it created; answers `409` if that copy was already completed |
| DELETE | `/api/hometasks/tasks/:id` | Delete permanently (there is no Trash for tasks) |
| POST | `/api/hometasks/automation/tasks` | `hometasks` / `tasks.automation.create-once` capability only; scoped create-once inbox task |

The automation body must contain exactly `{title, notes, idempotencyKey}`;
no query parameters. Title is trimmed, nonempty plain text of at most 200
characters without control characters. Notes are required text of at most
5000 characters (tabs/newlines allowed). The key is a lowercase 64-character
SHA-256 hex digest. The worker derives it from integration version,
subject, pinned Monitor instance and incident, excluding grant ID and payload.
The action derives subject and integration namespace only from live Core
verification, never the request. It creates an open, non-repeating inbox task
with no date, project or priority escalation.

New creation returns `201` with `{receipt: {id, taskId, taskUrl, state: "active"}}`.
Identical replay returns `200` and the original receipt without changing the
task, even after manual edits/completion or grant renewal. Changed canonical
payload for the same subject/namespace/key returns `409`. Canonical payload
is the trimmed title and exact notes; only its SHA-256 hash is retained in the
receipt. Receipt records never retain task content. After manual deletion,
replay returns `200`, `state: "retired"`, the original task ID and `taskUrl: null`;
it never recreates the task. Receipts have no cleanup TTL.

Task and receipt insert atomically under a SQLite write transaction. At most
20 new creations per subject/integration/UTC day are accepted; deleted tasks
still count and successful replays do not consume capacity. Limit exhaustion
returns `429` with `Retry-After` seconds until UTC midnight. Renewal and
re-enrollment cannot reset receipts or limits. Validation returns `400`;
browser sessions, wrong audiences, expired/revoked grants or disabled accounts
return `403`. Every replay also verifies live authority. Core outage returns
retryable `502`/`503`/`504` without writing. Replies are `no-store` and expose
only receipt metadata. The capability cannot list/read/edit/complete/delete
tasks or manage projects. Tier 1 implements no scheduling or alert mapping.

## HomeNotes backend (`/api/homenotes`)

A Markdown notes workspace, with version history and folders.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homenotes/health` | *(no auth)* |
| GET | `/api/homenotes/notes` | List notes |
| GET | `/api/homenotes/notes/trash` | List trashed notes |
| GET | `/api/homenotes/notes/:id` | Read one note |
| POST | `/api/homenotes/notes` | Create a note |
| PATCH | `/api/homenotes/notes/:id` | Edit a note (creates a new version) |
| DELETE | `/api/homenotes/notes/:id` | Move to Trash |
| POST | `/api/homenotes/notes/:id/restore` | Restore from Trash |
| DELETE | `/api/homenotes/notes/:id/permanent` | Permanently delete |
| GET | `/api/homenotes/notes/:id/versions` | Version history |
| POST | `/api/homenotes/notes/:id/versions/:versionId/restore` | Roll back to a version |
| GET | `/api/homenotes/tags` | Tags in use across all notes |
| POST/DELETE | `/api/homenotes/notes/:id/attachments` \| `/attachments/link` \| `/attachments/:fileId` | Attach / link / remove a HomeCloud file on a note |
| GET/POST | `/api/homenotes/note-folders` | List / create note folders |
| GET | `/api/homenotes/note-folders/all` | Full folder tree |
| PATCH/DELETE | `/api/homenotes/note-folders/:id` | Rename / delete |

## HomeVault backend (`/api/homevault`)

A client-side-encrypted password/secrets manager. **Every field below
except `type` and the KDF parameters is opaque ciphertext to this
server** — it validates shape and ownership, never content. See
`docs/SECURITY.md`'s v0 status callout before relying on this for
anything real.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homevault/health` | *(no auth)* |
| GET | `/api/homevault/vault` | `{exists: false}` or `{exists: true, vault: {...}}` — everything needed to attempt unlocking, both wrap paths |
| POST | `/api/homevault/vault` | Create this user's vault (409 if one already exists) |
| PATCH | `/api/homevault/vault/rewrap` | Replace the master-password wrap path (change password, or complete a recovery) |
| POST | `/api/homevault/vault/regenerate-recovery` | Replace the recovery-key wrap path only |
| DELETE | `/api/homevault/vault` | Destroy the vault and every item in it — irreversible |
| GET | `/api/homevault/vault/items` | List active item summaries; `?trash=true` lists Trash instead (`trash` accepts only `true` or `false`) |
| GET | `/api/homevault/vault/items/:id` | Full item, including encrypted data |
| POST | `/api/homevault/vault/items` | Create an item (`type`: `login` \| `note` \| `card`) |
| PATCH | `/api/homevault/vault/items/:id` | Update an item's encrypted fields |
| DELETE | `/api/homevault/vault/items/:id` | Move an active item to Trash (204); a second delete returns 404 |
| POST | `/api/homevault/vault/items/:id/restore` | Restore an item from Trash without changing its ciphertext (204) |
| DELETE | `/api/homevault/vault/items/:id/permanent` | Permanently delete an item already in Trash (204); active or missing items return 404 |

Both lists return encrypted titles and public metadata, including nullable
`deletedAt`, never the full secret payload. Normal item reads and updates
exclude Trash. All operations remain scoped to the caller's own vault;
another user's item returns 404. Trash has no automatic expiration: encrypted
items remain recoverable until the owner explicitly deletes them permanently
or destroys the whole vault. Permanent deletion removes the live database row,
not historical backups or forensic remnants in SQLite/storage.

## HomeSync backend (`/api/homesync`)

The API the Android app talks to. No web frontend of its own.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/homesync/health` | *(no auth)* |
| POST | `/api/homesync/auth/login` \| `/auth/2fa/verify` | *(no auth)* Proxied straight through to HomeCore, so the Android app has one address to enter |
| GET | `/api/homesync/auth/me` | Proxied through to HomeCore |
| POST/GET | `/api/homesync/devices` | Register / list this account's devices |
| DELETE | `/api/homesync/devices/:id` | Remove a device |
| POST | `/api/homesync/check` | Ask "has this content hash already been uploaded?" before sending bytes |
| POST | `/api/homesync/upload` | Upload one file (multipart, field `file`) |
| GET | `/api/homesync/history` | Backup history (file count/size per run) |

## Health checks

Every backend exposes an unauthenticated `GET .../health` returning
`{status: "ok", homecoreUrl: "..."}` (HomeCloud's backend also reports
its own storage-write check). Use these for container healthchecks or
uptime monitoring — see each service's `docker-compose.yml` entry.
