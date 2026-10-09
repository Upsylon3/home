# API reference

All routes require `Authorization: Bearer <token>` unless noted
otherwise. Get a token from `POST /api/auth/login` (and, if 2FA is
enabled, `POST /api/auth/2fa/verify`). Admin routes additionally require
the signed-in user to have the `admin` role.

Paths below are as reached through the gateway (`http://<host>:8080/...`)
— see [ARCHITECTURE.md](ARCHITECTURE.md) §5 for how each prefix maps to
a backend service.

## HomeCore (`/api/auth`, `/api/admin`, `/api/activity`, `/api/core`)

Identity, sessions, 2FA, the application registry, permissions, and the
shared activity/notifications feed. No files live here.

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

`POST /internal/events` and `GET /internal/users/usage` (not shown above)
are machine-to-machine routes authenticated with a shared secret
(`HOMECORE_INTERNAL_SECRET`), not a user token — see
`homecore/src/internalEvents.js`.

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

## HomeTasks backend (`/api/hometasks`)

Tasks and projects. Every route except `health` needs a login, and every
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
| POST | `/api/hometasks/tasks` | Create `{ title, notes?, priority?, dueDate?, projectId? }`; priority is `none\|low\|medium\|high` |
| GET | `/api/hometasks/tasks/:id` | Read one task |
| PATCH | `/api/hometasks/tasks/:id` | Change only the fields sent; `null` clears `dueDate` / `projectId` |
| POST | `/api/hometasks/tasks/:id/complete` | Tick off (safe to repeat) |
| POST | `/api/hometasks/tasks/:id/reopen` | Un-tick (safe to repeat) |
| DELETE | `/api/hometasks/tasks/:id` | Delete permanently (there is no Trash for tasks) |

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
| GET | `/api/homevault/vault/items` | List item summaries (encrypted title, not the full secret payload) |
| GET | `/api/homevault/vault/items/:id` | Full item, including encrypted data |
| POST | `/api/homevault/vault/items` | Create an item (`type`: `login` \| `note` \| `card`) |
| PATCH | `/api/homevault/vault/items/:id` | Update an item's encrypted fields |
| DELETE | `/api/homevault/vault/items/:id` | Permanently delete an item |

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
