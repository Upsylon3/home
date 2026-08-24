# Developer guide

A condensed version of the root `README.md`'s concepts primer, code tour,
and API reference — same content, reorganized, with duplicate
explanations merged. If you're brand new to web development, read §1
first; if you already know the basics, skip to §2.

## 1. Concepts, for anyone new to this

### Frontend, backend, API

Nearly every app here is two programs talking to each other:

- The **frontend** is what you see and click — it runs in your browser.
- The **backend** is a program running elsewhere (here: your own
  computer/server) that does the real work: checking passwords, saving
  files, remembering who owns what.

Think of a restaurant: you sit at a table (**frontend**), a waiter
(**API**) carries your order to the kitchen (**backend**) and brings the
result back. An **API** (Application Programming Interface) is just a
fixed menu of things one program can ask another to do.

### Requests, responses, and status codes

The frontend and backend talk over **HTTP**. Every exchange is one
**request** (aimed at an **endpoint** like `/api/auth/login`, using a
**method** — `GET` read, `POST` create/act, `DELETE` remove) followed by
one **response** — data (usually **JSON**) plus a 3-digit **status
code**: `200`/`201` success, `400` bad input, `401` not logged in, `403`
logged in but not allowed, `404` doesn't exist, `413` too big, `429` slow
down (rate limited), `500` server broke.

### The database

Backends remember things between visits in a **database** — an
organized, instantly-searchable spreadsheet. This project uses
**SQLite**: the whole thing is one file on disk, no separate database
server needed. Each service has its own — HomeCloud's holds `users` and
`files`; HomeMedia's and HomeSync's hold only their own small
albums/dedup-index data, never a copy of the files themselves (see
`ARCHITECTURE.md`'s "reference, don't duplicate" pattern).

### Authentication: passwords, JWT, revocation

1. **Passwords are never stored as plain text** — a one-way scrambling
   function (**bcrypt**, "hashing") stores the scrambled result;
   checking a login re-scrambles the attempt and compares.
2. **Staying logged in with a JWT (JSON Web Token):** after login, the
   backend hands the frontend a signed token — like a festival
   wristband. The frontend sends it on every future request
   (`Authorization: Bearer <token>`); the backend checks the signature is
   genuine without needing a fresh password check every time.
3. **Revoking a token early:** a plain JWT is normally valid until it
   naturally expires. A **token version** number per user, stamped into
   every issued token, lets "sign out everywhere" or a password change
   instantly invalidate every previously issued token, even ones that
   haven't technically expired.

### Roles, 2FA, and other safety mechanisms actually implemented

- **Roles (RBAC):** every account is `admin` or `user`. The first
  account ever created becomes admin automatically.
- **Rate limiting:** login/register/password-change attempts are capped
  per IP in a time window, to slow down automated guessing.
- **2FA (TOTP):** an authenticator app and the backend share a secret
  and both compute the same 6-digit code from the current time. Backed
  by one-time **recovery codes** and an admin override for a lost phone.
  Login becomes two steps: a correct password returns a short-lived
  **pending token** (proof of password only), and only a correct 2FA
  code alongside it completes login — the pending token is explicitly
  refused everywhere else, so intercepting it alone doesn't skip 2FA.
- **Soft delete (Trash):** deleting marks a row `deleted_at` rather than
  erasing it; restorable for 30 days, then auto-purged.
- **Share links:** a long random token in a URL grants access to one
  file with no login — revocable any time, expirable up front.

### The build tools

- **Node.js** runs JavaScript outside a browser (both the backend and
  the frontend's build process use it). **npm** installs other people's
  reusable code (a "package"), listed in each `package.json`.
- **React** builds frontends out of reusable **components**. **Vite**
  compiles that component code into plain HTML/CSS/JS a browser can run.
- **Express** is the library that turns "when a POST arrives at
  `/api/auth/login`, run this function" into a few lines of code.
- **Docker** packages a program with everything it needs to run into a
  portable **container**; **Docker Compose** starts several related
  containers together with one command — this is the recommended path
  (see `SETUP.md`).

## 2. Code tour

```
homecloud/
├── docker-compose.yml     # wires up every container
├── backups/               # nightly backup archives land here (Docker path)
├── gateway/                # single public entry point — see ARCHITECTURE.md §5
├── home/                    # Home: dashboard/launcher frontend
├── homemedia/                # HomeMedia's frontend
├── homemedia-backend/        # HomeMedia's own backend — no identity/storage
│                             #   of its own, see SERVICES.md
├── homesync-backend/         # The API the Android app talks to
├── homesync-android/         # The Android app itself (Kotlin) — see
│                             #   SERVICES.md for its current build gap
├── backend/                  # HomeCloud's API + embedded HomeCore
│   └── src/
│       ├── server.js          # entry point — starts Express, schedules trash purge
│       ├── app.js              # the actual Express app (routes/middleware/errors) —
│       │                       #   split from server.js so tests can boot it without
│       │                       #   a real port/timer/signal-handler in the way
│       ├── db.js               # opens/creates SQLite, migrations, activity logger
│       ├── auth.js             # register/login/me/change-password/2FA lifecycle
│       ├── admin.js            # admin-only account management + activity feed
│       ├── files.js            # upload/list/download/trash/share/batch-zip/move
│       ├── folders.js          # create/rename/move/delete, tree, breadcrumbs
│       ├── activity.js         # a user's own activity feed
│       ├── publicShare.js      # unauthenticated share-link download route
│       ├── rateLimiter.js      # wraps express-rate-limit; test-controllable
│       ├── middleware/authMiddleware.js  # verifies JWTs, checks revocation/role
│       └── homecore/           # identity/permissions/events/registry — mounted
│                               #   at /api/core, see ARCHITECTURE.md §3
├── backup/backup.sh          # nightly tar + prune, writes .partial then renames
└── frontend/src/
    ├── main.jsx / App.jsx      # mount point, routing, admin route guard
    ├── api.js                  # every backend call funnels through here
    ├── pages/                  # Login, Register, Dashboard, Settings, Admin
    └── components/             # UploadZone, FileTable, FolderGrid, MoveDialog,
                                 #   ShareDialog, TwoFactorSection, StorageGauge, ...
```

`homemedia-backend/`, `homesync-backend/`, `home/`, and `homemedia/`
follow the same shape as `backend/`/`frontend/` (own `src/`, own
Dockerfile, own nginx config where relevant) — see `SERVICES.md` for what
each one specifically does.

## 3. API reference

All routes except register/login/2FA-verify/public shares require
`Authorization: Bearer <token>`. Admin routes additionally require the
`admin` role.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | Create an account (first ever = admin) |
| POST | `/api/auth/login` | Log in (or start 2FA if enabled) |
| POST | `/api/auth/2fa/verify` | Complete login with a 2FA/recovery code |
| GET | `/api/auth/me` | Current user + usage/quota/2FA status |
| POST | `/api/auth/change-password` | Change password, revokes other sessions |
| POST | `/api/auth/logout-everywhere` | Revoke every session |
| POST | `/api/auth/2fa/setup` \| `/confirm` \| `/disable` \| `/recovery-codes` | 2FA lifecycle |
| GET | `/api/files` \| `/api/files/trash` \| `/api/files/shares` | List files/trash/shares |
| GET | `/api/files/all?type=image\|video` | Cross-folder listing (added for HomeMedia) |
| POST | `/api/files/upload` | Upload (multipart, field `file`) |
| POST | `/api/files/download-batch` | Download several files as one zip |
| GET | `/api/files/:id/download` \| `/thumbnail` | Download / get preview |
| POST | `/api/files/:id/share` \| `/move` | Create share link / move to folder |
| DELETE | `/api/files/:id` \| `/permanent` | Trash / permanently delete |
| POST | `/api/files/:id/restore` | Restore from trash |
| GET/POST/PATCH/DELETE | `/api/folders...` | Folder CRUD, tree, breadcrumbs |
| GET | `/api/share/:token` | *(no auth)* Download a shared file |
| GET | `/api/activity` | Your own recent activity |
| GET/POST | `/api/admin/...` | *(admin)* user management + activity feed |
| GET | `/api/core/...` | HomeCore's own routes — see `ARCHITECTURE.md` §3 |
| GET | `/api/homemedia/...` | HomeMedia's own routes (albums, favorites, EXIF) |
| GET | `/api/homesync/...` | HomeSync's own routes (devices, check, upload, history) |

## 4. Glossary

- **JWT** — a signed token proving identity, so you don't log in on
  every request. **Token revocation** — invalidating one early (password
  change, "sign out everywhere").
- **Rate limiting** — capping attempts from one place in a time window.
- **RBAC** — role-based access control (`admin` vs. `user`).
- **Soft delete** — marking as deleted without erasing (Trash).
- **Reverse proxy / gateway** — a server that routes requests to the
  right backend based on path; here, the one address everything is
  reached through (see `ARCHITECTURE.md` §5).
- **Origin** — scheme + host + port together; browsers treat same-origin
  as "the same site" for `localStorage` — the whole reason the gateway
  makes shared login possible.
- **PWA** — a website that can be "installed" via a manifest + service
  worker; currently only HomeCloud's frontend fully supports this (see
  `SERVICES.md`).
- **2FA / TOTP** — a second identity proof beyond a password; a
  time-based code from a shared secret.
- **Pending token** — a deliberately narrow token proving only "correct
  password," rejected everywhere except the route completing 2FA login.
- **Quota** — the max storage a user may use.
- **Object URL** — a temporary browser-local URL pointing at in-memory
  data, used so `<img>` tags can display an authenticated fetch's result.
