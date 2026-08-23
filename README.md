# Home — a beginner's guide to your own personal family cloud ecosystem

> **Naming note:** this project used to just be HomeCloud (a single file-storage
> app), and this document still carries a lot of content written when that was
> true. It has since grown into **Home** — a small ecosystem of apps
> (HomeCloud, HomeMedia, HomeSync, HomeNotes, and more later) that all share
> one login and one identity layer (HomeCore). **Home** is the dashboard/hub
> you land on; **HomeCloud** is now just one app inside it — the file-storage
> one. Where this document still says "homecloud" meaning *the whole project*,
> read it as "Home"; where it says "homecloud" meaning *the file-storage app
> specifically* (uploads, folders, quotas), that's still accurate as-is. See
> `ARCHITECTURE.md` for the current, precise picture — this file is the long
> beginner's walkthrough, not the source of truth for what's actually built.

This document has two jobs. First, it's a **lesson** — if you don't know what
an API is, what a "backend" does, or why any of this needs Docker or Node,
read Part 1 and you'll understand the whole picture. Second, it's the
**manual** — setup steps, a tour of every file, and reference tables, for
whenever you need to actually do something.

Skip around freely. If you already know web development basics, jump straight
to **Part 3: Setting it up**. If you just want to know how to manage your
family's accounts day-to-day, jump to **Part 5: Running this for your family**.

---

## Part 1: The concepts — what is any of this?

### What does this app actually do?

Home is a tiny, personal version of things like Dropbox, Google Photos, and
Bitwarden rolled into one — self-hosted, so *you* run the server (your own
computer, or one you control) instead of trusting a big company with your
family's files. Anyone in your family creates one account and, from one
dashboard, gets access to whichever of Home's apps are installed: HomeCloud
for file storage (upload, list, download, delete — recoverably, more on that
below), and others as they're added. One login, one identity, many rooms in
the same house — see `DESIGN_SYSTEM.md` for that metaphor in full.

The rest of Part 1 below explains the concepts using HomeCloud's own
file-storage feature set as the running example, since it's the most
fully-built app and the ideas (auth, JWT, roles, soft delete, etc.) are
shared platform concepts every app in Home relies on the same way.

### The restaurant analogy: frontend, backend, API

Nearly every modern app — homecloud included — is really **two programs
talking to each other**:

- The **frontend** is what you see and click on: the login screen, the
  upload button, the file list. It runs *inside your web browser* (or, once
  installed, feels like its own app on your phone — more on that later).
- The **backend** is a program that runs somewhere else (your computer, in
  this project) and does the real work: checking passwords, saving files to
  disk, remembering who owns what.

Think of a restaurant. You (the customer) never walk into the kitchen. You
sit at a table (the **frontend** — what you interact with directly), and a
waiter takes your order to the kitchen (the **backend** — where the actual
cooking/work happens) and brings the food back. The waiter is the **API**:
a defined, agreed-upon way for the dining room and the kitchen to
communicate — "table 4 wants a burger," not a free-for-all where customers
wander into the kitchen themselves.

**API** stands for **Application Programming Interface**. It's just a fixed
menu of things one program is allowed to ask another program to do, and what
it gets back. In homecloud, the API is a list of URLs the frontend can call,
like "create an account" or "give me the list of my files." You'll see the
full menu in the [API reference](#api-reference) section below.

### Requests and responses (HTTP)

The frontend and backend talk over **HTTP** — the same protocol your browser
uses to load any website. Every conversation is one **request** followed by
one **response**:

- The frontend sends a request: "Hey backend, here's a username and password,
  please log this person in." This is aimed at a specific **endpoint** (a
  URL, like `/api/auth/login`) using a specific **method** that describes the
  *kind* of action:
  - `GET` — "give me some information" (e.g., list my files)
  - `POST` — "here's some new data, do something with it" (e.g., log in, or
    upload a file)
  - `DELETE` — "get rid of this" (e.g., move a file to trash)
- The backend sends back a response: some data (often as **JSON** — see
  below) plus a **status code**, a 3-digit number summarizing what happened:
  - `200`/`201` — success
  - `400` — "you sent me something I don't understand" (e.g., missing
    password)
  - `401` — "you're not logged in, or your credentials are wrong"
  - `403` — "you're logged in, but you're not allowed to do that" (e.g., a
    non-admin trying to open the admin panel, or a disabled account trying
    to log in)
  - `404` — "that doesn't exist"
  - `413` — "that's too big" (used here for over-quota uploads)
  - `429` — "slow down" (used here when too many login attempts happen too
    quickly — see rate limiting, below)
  - `500` — "something broke on the server side"

**JSON** (JavaScript Object Notation) is just a plain-text way of writing
structured data that both the frontend and backend can easily read, e.g.:

```json
{ "username": "alex", "usedBytes": 10485760, "quotaBytes": 5368709120 }
```

If you ever open your browser's Developer Tools (F12) on a real website and
click the "Network" tab, this is exactly what you'd see flying back and
forth.

### Where do files and passwords actually live? (the database)

The backend needs to remember things between visits — who has an account,
what files belong to whom. It stores this in a **database**: think of it as
a very organized, very fast spreadsheet that the backend can search through
instantly.

homecloud uses **SQLite**, one of the simplest kinds of database — the whole
thing lives in a single file on disk (`homecloud.db`), no separate database
server required. It has two tables (think: two spreadsheet tabs):

- `users` — one row per account: username, hashed password, **role**
  (`admin` or `user`), whether the account is **disabled**, an optional
  personal storage quota, and a **token version** number used to force
  sign-outs (all explained below)
- `files` — one row per uploaded file: which user it belongs to, its
  original filename, where it's actually stored on disk, its size, when it
  was uploaded, and — if it's been deleted — when it was deleted (this is
  how Trash works)

The actual file *contents* (your PDFs, photos, whatever you upload) aren't
stored in the database — they're saved as ordinary files in a folder on
disk, one subfolder per user. The database just keeps track of *where* they
are and *who* they belong to.

### How does it know it's really you? (authentication, passwords, JWT)

**Authentication** is the process of proving who you are. homecloud does
this with a username and password, like almost everything else you've ever
logged into.

Three important ideas:

1. **Passwords are never stored as plain text.** Instead, when you register,
   the backend runs your password through a one-way scrambling function
   called **bcrypt** ("hashing") and stores *that* scrambled result. When you
   log in later, it scrambles what you typed the same way and checks if the
   scrambled versions match. This means even if someone stole the database,
   they wouldn't see anyone's actual password.

2. **Staying logged in with a JWT.** Logging in is just one request/response
   — but you don't want to retype your password on every single click. So
   after a successful login, the backend hands the frontend a
   **JWT (JSON Web Token)**: think of it like a wristband you get at a
   festival after showing your ticket once. It's a signed piece of text that
   says "this is user #7, issued at this time, valid for 7 days." The
   frontend stores this wristband (in the browser's `localStorage`) and shows
   it on every future request (in an `Authorization: Bearer <token>` header).
   The backend checks the wristband is genuine (it's cryptographically
   signed with a secret key only the backend knows — your `JWT_SECRET`) and,
   if so, trusts who it says you are — no database lookup needed on every
   request to re-verify the password.

3. **Being able to revoke the wristband early.** A plain JWT is normally
   valid until it naturally expires, with no way to cut it short — a problem
   if a phone gets lost or a password gets compromised. homecloud adds a
   **token version** number per user in the database. Every token includes
   the token version it was issued under. Changing your password, or using
   "sign out everywhere," bumps that number in the database — so any
   previously issued wristband (which still has the *old* number printed on
   it) is instantly rejected on its next use, even though it hasn't
   technically expired yet.

### Rate limiting: slowing down password guessing

If there were no limit, a computer program could try thousands of password
guesses against your login page per minute. **Rate limiting** caps how many
login/register/password-change attempts can come from one place in a given
window of time — here, 10 attempts per 15 minutes per IP address. A family
member who mistypes their password a few times will never notice this; an
automated guessing script will hit a wall almost immediately (getting back
that `429` status code from above).

### Roles: admin vs. regular family members

Every account has a **role**: `admin` or `user`. The very first account ever
created on your server automatically becomes an admin — this is meant to be
you. Admins get access to an **admin panel** (a page regular accounts can't
even navigate to) where they can reset a family member's forgotten password,
adjust someone's storage limit, or disable an account — all without ever
touching the database directly. This concept, "different accounts are
allowed to do different things," is often called **RBAC** (role-based
access control) in the industry.

### Trash: soft deletes instead of instant, permanent ones

When you delete a file in most consumer cloud storage, it doesn't actually
vanish immediately — it goes to a Trash/Recycle Bin first, in case you
change your mind or someone deletes the wrong thing. homecloud works the
same way: clicking "Delete" marks the file as deleted (a **soft delete** —
the database row and the file on disk both still exist, just hidden from
the normal view) rather than actually erasing it. You can restore it from
the Trash tab, or delete it "forever" (a **hard delete** — this is the one
that actually removes it from disk). Anything left in Trash for more than
30 days (configurable) gets automatically hard-deleted by a background job
that runs once a day.

### Backups: why "it's on the server" isn't enough

A database and an uploads folder living on one disk, in one machine, is
still just one copy of your family's data. If that disk fails, or the
machine is stolen, or you fat-finger a command, that's the only copy gone.
homecloud includes a small **backup service** — a separate container that
runs alongside the app and, once a day, packages the entire database and
every uploaded file into a single compressed archive, dropped into a
`backups/` folder on your actual host computer (not inside the Docker
volume the app itself uses) — see Part 5 for how to also get that folder
copied somewhere off of this one machine, which is the part that actually
protects you from a hardware failure.

### Shareable links: letting someone in without an account

Sometimes you want to send one file to someone who isn't part of your
homecloud family — a friend, a relative, a repair technician. A **share
link** is a special URL containing a long, random, unguessable **token**
(think: a password so long and random it'd take longer than the age of the
universe to guess) that maps to one specific file. Anyone with that exact
URL can download that one file, no login required — but they can't see any
of your other files, and you can **revoke** the link at any time (or set it
to expire automatically after a day, a week, or a month), instantly cutting
off access. This is the same idea as "Share" links in Dropbox or Google
Drive.

### Batch actions and zip archives

Selecting several files at once to download or delete together is a
**batch action**. Deleting several files is just repeating the same
single-file operation multiple times. Downloading several files at once is
a little more interesting: browsers can only save one file per download, so
to hand back "5 files" as a single download, the backend bundles them
together into a **zip archive** (the same `.zip` format you'd get from
"Compress" in Windows/macOS) on the fly and streams that one archive down
to you, which your browser or OS can then unzip back into individual files.

### Search and sort

With enough files, scrolling to find one gets tedious. **Search** narrows
the list to filenames containing whatever you type; **sort** reorders the
full list by name, size, or date, in either direction. Both happen entirely
in the frontend, instantly, since the app already has your full file list
loaded — there's no extra trip to the backend involved.

### The activity log: "who did what, and when"

Every meaningful action — uploading, deleting, restoring, sharing, an admin
resetting someone's password — gets recorded as one line in an
**activity log**: who did it, what they did, and when. You see your own
history in Account Settings; admins additionally see everyone's activity in
the Admin panel. This is the practical answer to "wait, where did my file
go?" — instead of guessing, you can just look it up.

### Folders: organizing files instead of one flat pile

Every file belongs to exactly one **folder** — or to the root ("Home") if
it's not inside any folder. Folders can nest inside other folders, forming
a tree, just like folders on your computer. Behind the scenes, this is
just one extra column on each file (which folder it's in) and a small
`folders` table recording each folder's name and its **parent** (the
folder it lives inside, or nothing if it's at the top level). The
**breadcrumb trail** you see at the top of the file browser ("Home /
Vacation / 2024") is built by walking up that parent chain from wherever
you currently are, back to the root.

Deleting a folder that still has files in it works like Trash for those
files too — they don't vanish, they move to Trash, and the folder itself
is what actually disappears. Moving a folder into one of its own
subfolders is deliberately blocked, since that would create a loop with no
actual "top" — same reason you can't put a box inside itself.

### Thumbnails and the gallery view

When you upload an image, the backend generates a small preview copy — a
**thumbnail** — resized down to a max of 320 pixels and saved as a
separate, much smaller JPEG file alongside the original. The **Grid**
view in the file browser shows these thumbnails as a photo-wall instead of
a plain filename list; clicking one opens a **lightbox** (a large, focused
view of just that image) rather than immediately downloading it.

One technical wrinkle worth knowing: a plain `<img src="...">` tag can't
attach the login "wristband" (the `Authorization` header) that every other
request in this app needs, since browsers don't let HTML tags add custom
headers. So thumbnails and the lightbox's full-size image are fetched with
JavaScript instead (the same authenticated `fetch()` pattern used for
downloads elsewhere), then converted into a temporary local URL the `<img>`
tag can point to. Files that aren't images just show a small badge with
their extension instead of a broken image icon.

### Two-factor authentication (2FA)

A password is "something you know." **Two-factor authentication** adds
"something you have" — in this case, a phone running an authenticator app
(Google Authenticator, Authy, and similar apps all work). Even if someone
learns your password, they still can't log in without that second factor.

The standard behind this is called **TOTP** (Time-based One-Time
Password): your authenticator app and the backend both know a shared
secret, and both independently compute the same 6-digit code by combining
that secret with the current time — the code changes every 30 seconds.
Setting it up means scanning a **QR code** (which just encodes that shared
secret) so your phone and the server end up with the same starting point.

Two safety nets are built in, since losing a phone would otherwise mean
losing access entirely: **recovery codes** — a one-time-use backup list
generated when you turn 2FA on, for logging in if your phone is
unavailable — and an **admin override**, letting an admin turn off 2FA for
someone who's lost both their phone and their recovery codes, after
confirming who they are some other way (a phone call, in person, etc.).

Behind the scenes, logging in becomes a two-step exchange instead of one:
a correct password gets you a very short-lived **pending token** — proof
you know the password, nothing more — and only submitting a correct code
alongside that pending token gets you an actual, fully logged-in session.

### PWA: "installing" a website like an app

A **PWA** (Progressive Web App) is a regular website that provides a couple
of extra files — a `manifest.json` (name, icon, colors) and a small
**service worker** script — that let a browser offer to "install" it. Once
installed, it shows up with its own icon on your phone's home screen or in
your computer's app list, opens in its own window without browser address
bars, and (thanks to the service worker) survives brief network hiccups
more gracefully. It is *not* a separate app-store app — there's nothing to
download or approve, it's the same website, just dressed up to feel like a
native app. This is how homecloud gives you an "app" experience on
everyone's phone without needing to build and submit a real mobile app.

### The tools that build and run all this

- **Node.js** is a program that lets you run JavaScript *outside* a browser
  — as a normal backend server, a build tool, whatever. Both this project's
  backend and its frontend build process run on Node.
- **npm** (Node Package Manager) comes bundled with Node. Nearly no one
  writes 100% of their own code — npm lets you download and use code other
  people already wrote and tested (a "package" or "dependency"). Every
  project has a `package.json` file listing which packages it needs, and
  running `npm install` downloads them all into a `node_modules` folder.
- **nvm** (Node Version Manager) lets you install and switch between
  different versions of Node itself, since some projects need newer or
  older versions. `nvm-windows` is the Windows equivalent.
- **React** is a popular library (a big pile of pre-written code) for
  building frontends out of reusable pieces called **components** — think
  Lego bricks. This project has components like `UploadZone`, `FileTable`,
  and `StorageGauge`, each responsible for one visual piece of the screen,
  which combine into full pages like `Dashboard`, `Settings`, and `Admin`.
- **Vite** is the tool that takes all the React component code you write
  (which browsers can't run directly) and compiles/bundles it into plain
  HTML/CSS/JavaScript a browser understands, either for local development
  (`npm run dev`) or a final production version (`npm run build`).
- **Express** is a small library that makes writing a backend web server in
  Node much easier — it's what turns "when a POST request arrives at
  `/api/auth/login`, run this function" into a few lines of readable code.
- **Docker** packages up a program *and* everything it needs to run
  (the right Node version, system libraries, etc.) into a single "container"
  — like a shipping container that runs identically no matter what computer
  it's shipped to. **Docker Compose** starts multiple related containers
  together (here: the backend, the frontend, and the backup service) with
  one command. This is why the Docker path in this README needs so much
  less explanation than the manual path — Docker handles all the "make sure
  the right tools are installed" work for you.
- **Environment variables** (the stuff in `.env` files) are configuration
  values kept *outside* the code — things like secret keys or size limits
  that you want to be able to change without editing and re-deploying actual
  code. `JWT_SECRET`, `QUOTA_BYTES`, and `TRASH_RETENTION_DAYS` are examples
  here.

If you've read this far, you now know every concept this project touches.
Everything below is putting those pieces to work.

---

## Part 2: What actually happens when you use the app

Walking through each action end-to-end:

**Opening the app.** Your browser requests `http://localhost:8080` (or
whatever address you're using). It gets back the React frontend —
HTML/CSS/JS files. Nothing about *your* account has happened yet; this is
just the "shell" loading.

**Registering the very first account.**
1. You type a username and password and click "Create account."
2. The frontend sends `POST /api/auth/register` with your username/password
   as JSON.
3. The backend checks the username isn't taken, checks the password is at
   least 8 characters, hashes the password with bcrypt. Since this is the
   very first account on the server, it's automatically given the `admin`
   role.
4. The backend generates a JWT for this new user (stamped with their
   current token version, starting at 0) and sends it back.
5. The frontend saves that JWT in `localStorage` and shows you the
   dashboard.

Every account registered *after* the first one gets the ordinary `user`
role instead.

**Logging in** is the same idea minus the "create a new row" step — the
backend just checks your password's hash matches what's stored (and that
the account isn't disabled), then issues a fresh JWT.

**Uploading a file.**
1. You drag a file onto the upload zone (or click to browse).
2. The frontend sends `POST /api/files/upload` with the file's raw bytes
   attached, plus your JWT in the `Authorization` header.
3. The backend verifies your JWT is genuine, not expired, and not
   invalidated (middleware — see below), then a library called **multer**
   streams the file onto disk into `/data/uploads/<your-user-id>/`, giving
   it a random internal filename so two people's "photo.jpg" never collide.
4. The backend checks: would this upload push you over your storage quota
   (your personal override, if an admin set one, or the server default
   otherwise)? If so, it deletes the file it just wrote and responds with a
   `413` error. Otherwise, it inserts a row into the `files` table.
5. The frontend adds the new file to the list you see, and the little
   "drive activity" LED blinks.

**Deleting a file (soft delete).** The frontend calls `DELETE /api/files/:id`.
The backend doesn't touch the actual file on disk — it just stamps a
`deleted_at` timestamp on that row. The file disappears from your main list
and reappears in the **Trash** tab. It still counts against your quota.

**Restoring, or emptying trash.** From the Trash tab, "Restore" clears that
timestamp (the file reappears in your main list, nothing on disk ever
moved). "Delete forever" (`DELETE /api/files/:id/permanent`) actually
removes the row and the file from disk, and frees up your quota. Anything
left untouched in Trash for 30 days gets this same treatment automatically,
via a check the backend runs once a day.

**Changing your password.** `POST /api/auth/change-password` checks your
current password, hashes and stores the new one, and — importantly —
increments your `token_version`. The backend immediately signs you a
*brand-new* token (so you're not logged out on the device you're using
right now), but every other device that was logged in as you presents an
*old* token version on its next request and gets rejected, forcing a fresh
login there.

**"Sign out everywhere."** Same token-version bump, but without changing
the password — useful if you just want to kick every session (e.g. a lost
phone) without needing to also pick a new password.

**Sharing a file.** Clicking "Share" and picking an expiration calls
`POST /api/files/:id/share`, which generates a long random token and stores
it in a `shares` table pointing at that file, then hands back a URL like
`https://your-server/api/share/<token>`. Anyone who opens that URL hits a
completely separate, unauthenticated route — no JWT, no login — that looks
up the token, checks it hasn't been revoked or expired, and streams the
file back if it's valid. "Revoke" just stamps a `revoked_at` timestamp on
that row, which the lookup checks on every request from then on.

**Selecting several files and downloading them together.** Checking boxes
next to multiple files and clicking "Download as zip" sends
`POST /api/files/download-batch` with the list of ids. The backend verifies
every id actually belongs to you, then streams a zip archive back
containing all of them (renaming any duplicate filenames so nothing gets
silently overwritten inside the archive), which your browser then saves as
one `.zip` file. Batch delete/restore, by contrast, is simply the normal
single-file action repeated once per selected file.

**Searching or sorting your file list.** Typing in the search box or
changing the sort dropdown doesn't talk to the backend at all — the full
list of your files is already sitting in the browser's memory, so filtering
and reordering it happens instantly, client-side.

**Opening a folder.** Clicking a folder tile calls `GET /api/files` and
`GET /api/folders` again, both with that folder's id attached, so you get
back only what's directly inside it (not everything nested further down).
Both responses also include a fresh breadcrumb trail for wherever you just
navigated to.

**Creating a folder.** `POST /api/folders` with a name and (optionally) a
parent folder id creates one row in the `folders` table. Two folders can't
share a name inside the same parent — the backend checks for that and
rejects a duplicate before it's created.

**Moving a file (or several) into a folder.** The "Move to…" dialog fetches
your entire folder tree in one request (`GET /api/folders/all`) to build
its picker, then calls `POST /api/files/:id/move` once per file with the
chosen destination — updating just that one column on each file's row.

**Deleting a folder.** If it's completely empty, `DELETE /api/folders/:id`
just removes it. If it still has files anywhere inside it (including
nested subfolders), the backend refuses and tells you how many files are
in the way, unless you confirm and it's retried with `?force=true` — at
which point those files move to Trash (not permanently deleted) and the
folder itself, along with any subfolders, is removed.

**Uploading an image.** Same upload flow as any other file, but
immediately afterward the backend also generates a thumbnail: it opens the
image with a library called `sharp`, auto-rotates it based on the photo's
embedded orientation data (so sideways phone photos display upright),
shrinks it to fit in a 320×320 box, and saves that as a separate small
JPEG. If anything about that fails — a corrupted file, an unusual format —
the upload still succeeds; there's just no thumbnail, and the file shows a
plain extension badge instead.

**Switching to Grid view.** The file list is already loaded in the
browser, so this doesn't need a new request — it just changes how the same
data is rendered. Each image tile then separately fetches its own
thumbnail as it appears on screen.

**Turning on two-factor authentication.** `POST /api/auth/2fa/setup`
generates a random secret and stores it against your account, but doesn't
require it yet. You scan the QR code it returns (or type in the secret
manually), then submit whatever 6-digit code your app is currently
showing to `POST /api/auth/2fa/confirm`. Only once that code checks out
does the backend actually flip `totp_enabled` on — this prevents someone
from locking themselves out by scanning the code wrong and never
realizing it. That same step generates and returns your recovery codes,
shown once.

**Logging in with 2FA on.** `POST /api/auth/login` still checks your
password first, exactly as before — but instead of a real session token,
it now returns a short-lived pending token and `requires2fa: true`. The
frontend shows a second screen asking for a code, which gets submitted
together with that pending token to `POST /api/auth/2fa/verify`. Only that
route accepts pending tokens; every other protected route in the app
explicitly refuses one, so a stolen pending token (which only proves a
correct password) can't be used to skip the second step.

**Using a recovery code instead of an authenticator code.**
`/2fa/verify` tries your submitted code as a TOTP code first; if that
doesn't match, it checks it against your unused recovery codes instead.
A recovery code that works is immediately marked used, so it can't be
replayed a second time.

**Admin actions** (only available to accounts with the `admin` role, and
only reachable via the `/admin` page, which the frontend won't even show a
link to for non-admins): listing every account and how much storage each
is using, resetting someone's password on their behalf, giving someone a
bigger or smaller quota than the server default, disabling an account,
force-disabling 2FA for someone locked out of their authenticator app, and
promoting/demoting other admins. Two safety rails are built in on the
backend itself (not just hidden in the interface): you can't disable your
own account, and you can't remove the last remaining admin — so it's not
possible to accidentally lock the whole family out of admin control.

**Checking the activity log.** Every action above (upload, delete, share,
password change, admin actions, and so on) writes one row to an
`activity_log` table as it happens. `GET /api/activity` returns your own
history (shown in Account Settings); admins additionally get
`GET /api/admin/activity`, the same feed across every family member (shown
in the Admin panel).

**Signing out.** The frontend just throws away the JWT it had stored.
There's nothing to tell the backend — the token simply won't be sent on
future requests, and it also expires on its own after the number of days
set by `JWT_EXPIRES_IN`.

---

## Part 3: Setting it up

Works the same on Windows, macOS, and Linux. There are two paths:

- **Docker** (recommended): one command, Docker handles installing the
  right Node version and system tools for you inside containers, and also
  runs the automated backup service alongside the app.
- **No Docker**: you install Node yourself and run the backend and frontend
  directly. More setup, and you'd need to set up your own backup approach,
  but useful if Docker isn't an option on your machine.

### Path A: Docker Compose

You'll need [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed and running first. On Windows, this requires hardware
virtualization to be enabled (Task Manager → Performance tab will show you
whether "Virtualization" says Enabled or Disabled) — if Docker Desktop
complains about this, that setting needs to be turned on in your PC's
BIOS/UEFI first.

1. **Set your JWT secret.** Copy the backend env example:

   **macOS / Linux (bash):**
   ```bash
   cp backend/.env.example backend/.env
   ```

   **Windows (PowerShell):**
   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

   Open `backend/.env` in any text editor (Notepad is fine) and change
   `JWT_SECRET` to a long random value — this is the secret key mentioned
   in Part 1 that signs your login "wristbands."

   To generate one, **macOS/Linux**:
   ```bash
   openssl rand -hex 32
   ```
   **Windows (PowerShell), no OpenSSL needed:**
   ```powershell
   -join ((1..64) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
   ```

   Paste whatever string you got in as `JWT_SECRET=...`. Also adjust
   `QUOTA_BYTES` (default per-user quota) and `TRASH_RETENTION_DAYS`
   (default 30) here if you want different defaults.

2. **Build and run:**
   ```bash
   docker compose up --build
   ```
   This reads `docker-compose.yml`, builds the backend, frontend, and
   backup containers (each following the recipe in its `Dockerfile`), and
   starts them all, wired together.

3. **Open the app:** [http://localhost:8080](http://localhost:8080)

   **Create the first account** — this automatically becomes the admin
   account (that should be you). Everyone else who signs up afterward gets
   a regular account.

Uploaded files and the SQLite database persist in a Docker "named volume"
(`homecloud_data`) — a chunk of disk space Docker manages for you outside
the containers themselves — so `docker compose down` and `docker compose up`
again won't lose anything. To wipe all data and start fresh, run
`docker compose down -v`.

Backups land in a `backups/` folder that appears right next to
`docker-compose.yml` on your actual computer (not hidden inside Docker) —
see **Part 5** for what to do with it.

### Path B: Running it without Docker

**macOS / Linux**, backend:
```bash
cd backend
cp .env.example .env   # edit JWT_SECRET (see Path A step 1 for how)
npm install
npm run dev             # listens on :4000
```

**Windows, starting from a completely clean machine (no Node/npm yet):**

1. Install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases)
   — download `nvm-setup.exe` from the latest release and run it. (This is a
   separate tool from "nvm" on macOS/Linux, but does the same job: letting
   you install and switch Node versions.)

2. Open a **new** PowerShell window (needed so it picks up the updated PATH
   from the installer), then:
   ```powershell
   nvm install 20
   nvm use 20
   ```
   If `nvm use 20` fails with a permissions error, close PowerShell, reopen
   it via right-click → **Run as administrator**, and try again.

3. Verify it worked:
   ```powershell
   node -v
   npm -v
   ```
   You should see something like `v20.x.x` and `10.x.x`. npm ships bundled
   with Node — there's nothing separate to install for it.

4. Set up the backend:
   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```
   Generate a JWT secret using Node itself, now that it's installed:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the printed string, open `.env` in Notepad, and paste it in as
   `JWT_SECRET=...`. Then:
   ```powershell
   npm install
   npm run dev
   ```

Leave that terminal window open and running — it's your backend, listening
on port 4000.

**One possible snag on Windows:** `better-sqlite3` (the database library) is
a "native module" — some of it is actually compiled C++ code, not plain
JavaScript. Usually `npm install` downloads an already-compiled version and
everything just works. But if the install fails with errors mentioning
`node-gyp`, `python`, or `MSBuild`, it means it's trying to compile from
source and needs two things first:
- **Python 3** from [python.org](https://python.org) (check "Add python.exe
  to PATH" during install)
- **Build Tools for Visual Studio** from
  [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/)
  — during setup, check the **"Desktop development with C++"** workload

Restart your terminal after installing these, then re-run `npm install`.

**Now the frontend, in a second terminal window** (same on every OS from
here, aside from how you `cd`):
```bash
cd frontend
npm install
npm run dev              # listens on :5173, proxies /api to :4000
```

Visit [http://localhost:5173](http://localhost:5173). Keep both terminal
windows open while you use the app — closing either one stops that half of
it. Without Docker, nothing is backing your data up automatically — see
Part 5 for a manual approach if you go this route.

---

## Part 4: A tour of the code, file by file

You don't need to read this section to *use* the app — it's here for when
you're curious what's actually inside each file, or want to start modifying
things.

```
homecloud/
├── docker-compose.yml       # tells Docker how to build & wire up all three containers
├── backups/                 # where nightly backup archives land (Docker path only)
├── backend/
│   ├── .env.example         # template for secret config values (copy to .env)
│   ├── Dockerfile           # recipe for building the backend's container
│   └── src/
│       ├── server.js        # entry point — starts Express, wires up routes, schedules trash purge
│       ├── db.js            # opens/creates the SQLite database, tables, migrations, activity logger
│       ├── auth.js          # register/login/me/change-password/logout-everywhere
│       ├── admin.js         # admin-only: list/reset-password/disable/quota/role + activity feed
│       ├── files.js         # upload/list/download/delete/trash/restore/share/batch-zip/move
│       ├── folders.js       # create/rename/move/delete folders, folder tree, breadcrumbs
│       ├── activity.js      # a user's own activity feed
│       ├── publicShare.js   # the public, unauthenticated share-link download route
│       └── middleware/
│           └── authMiddleware.js  # verifies JWTs, blocks disabled/revoked sessions, checks admin role
├── backup/
│   ├── Dockerfile            # tiny alpine container for the backup service
│   └── backup.sh             # the actual nightly tar + prune script
└── frontend/
    ├── nginx.conf             # (production only) serves the built app, proxies /api
    ├── Dockerfile             # recipe for building the frontend's container
    ├── vite.config.js         # dev-server settings (e.g. the /api proxy for local dev)
    ├── public/                # manifest.json, icons, and the service worker (PWA support)
    └── src/
        ├── main.jsx           # the very first file that runs in the browser; registers the service worker
        ├── App.jsx            # routing — decides which page to show, and protects /admin
        ├── api.js             # one shared place for every call to the backend
        ├── utils.js           # formatting helpers + shared activity-log label text
        ├── styles/index.css   # all visual styling — colors, fonts, layout
        ├── pages/
        │   ├── Login.jsx      # the sign-in screen, incl. the 2FA code step
        │   ├── Register.jsx   # the create-account screen
        │   ├── Dashboard.jsx  # main screen: folder browsing, Files/Trash/Shared-links tabs
        │   ├── Settings.jsx   # change password, sign out everywhere, 2FA, your activity feed
        │   └── Admin.jsx      # admin-only: manage every family member's account + activity feed
        └── components/
            ├── UploadZone.jsx   # the drag-and-drop upload box + progress bar
            ├── FileTable.jsx    # file list — active/trash view, row checkboxes, Share/Move buttons
            ├── GalleryGrid.jsx  # photo-wall grid of thumbnails, for the Grid view toggle
            ├── Thumbnail.jsx    # fetches + displays one thumbnail (or a fallback badge)
            ├── Lightbox.jsx     # full-size image viewer with download/share/move/delete
            ├── FolderGrid.jsx   # folder tiles — open/rename/delete
            ├── Breadcrumb.jsx   # "Home / Vacation / 2024" navigation trail
            ├── MoveDialog.jsx   # pick a destination folder for one or more files
            ├── ShareDialog.jsx  # create/copy a share link for one file
            ├── TwoFactorSection.jsx # 2FA setup wizard + manage/disable controls
            ├── Modal.jsx        # small reusable popup dialog (used by ShareDialog, MoveDialog)
            ├── StorageGauge.jsx # the "X GB of Y GB used" bar in the sidebar
            └── ActivityLED.jsx  # the little blinking dot that reacts to activity
```

**Backend, in more detail:**

- `server.js` — The switchboard. Starts the web server, turns on `helmet`
  (security headers) and JSON parsing, and routes `/api/auth/...` to
  `auth.js`, `/api/files/...` to `files.js`, `/api/folders/...` to
  `folders.js`, `/api/admin/...` to `admin.js`, `/api/activity` to
  `activity.js`, and `/api/share/...` to `publicShare.js`. It also runs a
  trash-purging sweep once at startup and then once every 24 hours, and has
  a catch-all error handler so a bug never leaks a raw error message to
  whoever's using the app.
- `db.js` — Runs once, when the server starts. Creates the `users`,
  `files`, `folders`, `shares`, and `activity_log` tables if they don't
  exist, and safely adds newer columns to existing tables even if they
  were created by an earlier version of this app — so upgrading never
  requires manually touching the database. It also promotes the oldest
  account to admin if, for some reason, no admin currently exists, and
  exports `logActivity()`, the one shared function every other file calls
  to record a line in the activity feed.
- `auth.js` — Registration (first account → admin, everyone else → user),
  login (blocked if the account is disabled; returns a pending token
  instead of a session if 2FA is on), `/me` (your info + usage + 2FA
  status), `/change-password` (re-hashes and bumps token version),
  `/logout-everywhere` (bumps token version without touching the
  password), and the full 2FA lifecycle: `/2fa/setup`, `/2fa/confirm`,
  `/2fa/verify`, `/2fa/disable`, and `/2fa/recovery-codes`. Login,
  register, change-password, and the 2FA routes all share a rate limiter
  capping attempts per IP address.
- `admin.js` — Every route here first checks the requester is logged in
  *and* has the `admin` role (`requireAuth` + `requireAdmin` middleware).
  Lists all users with usage and 2FA status, resets a password, sets a
  personal quota override, disables/enables an account, changes roles,
  force-disables 2FA for someone locked out, and serves the cross-family
  activity feed — with built-in guards against disabling your own account
  or demoting the last admin.
- `files.js` — Upload, list (active files only, scoped to a folder),
  list trash, soft-delete, restore, permanent-delete, download, thumbnail
  generation and serving, create/list/revoke share links, move a file to
  another folder, and batch zip download — all scoped so a user can only
  ever see or touch their *own* files. Also exports the trash-purging
  function that `server.js` calls on a timer (which also cleans up
  thumbnail files, not just originals).
- `folders.js` — Create, rename, move, and delete folders, list what's
  directly inside one, fetch the whole folder tree flat (for the "move to
  folder" picker), and build a breadcrumb trail by walking up the parent
  chain. Deleting a non-empty folder requires an explicit `force` flag and
  moves its files to Trash rather than deleting them outright; moving a
  folder into its own descendant is blocked via a recursive check.
- `activity.js` — One route: your own last 100 activity entries.
- `publicShare.js` — A completely separate router with no `requireAuth` at
  all, since share links are meant to work for people without an account.
  Looks up a token, checks it isn't revoked or expired, and streams the
  file back — rate-limited to slow down anyone trying to scan for valid
  tokens (though at 192 random bits each, that's effectively impossible).
- `middleware/authMiddleware.js` — "Middleware" just means a function that
  runs *before* your actual route handler. This one reads the
  `Authorization` header, checks the JWT's signature is genuine, explicitly
  rejects pending-2FA tokens (so an intercepted "just entered the
  password" token can never be used as a real session), then looks the
  user up fresh in the database to confirm the account isn't disabled and
  the token's version number still matches — this is what makes "sign out
  everywhere" and disabling an account take effect immediately instead of
  waiting for the token to naturally expire.

**Backup service:**

- `backup/backup.sh` — On a loop (default: once every 24 hours), archives
  everything in the shared data volume into a timestamped
  `.tar.gz` file inside `/backups`, and deletes any archive older than the
  configured retention window (default 14 days). Writes to a temporary
  `.partial` filename first and only renames it once the archive is
  complete, so a backup that gets interrupted mid-write is never mistaken
  for a finished, restorable one.

**Frontend, in more detail:**

- `main.jsx` — Mounts the React app, wraps it in a router, and — in the
  production build only — registers the service worker that makes the PWA
  installable.
- `App.jsx` — On load, checks if a JWT is already saved from a previous
  visit and, if so, asks the backend to confirm it's still valid. Routes
  `/`, `/login`, `/register`, `/settings`, and `/admin` — the last one
  redirects away immediately if the logged-in user isn't an admin.
- `api.js` — Every single network call in the app funnels through here,
  including the admin-only endpoints (grouped under `api.admin.*`) and
  share/activity endpoints.
- `pages/Login.jsx` — On submit, either stores the returned JWT and
  navigates to the dashboard, or — if the account has 2FA on — switches to
  a second screen asking for an authenticator/recovery code before
  completing login.
- `pages/Register.jsx` — Simple form; on submit, stores the returned JWT
  and navigates to the dashboard.
- `pages/Dashboard.jsx` — Folder browsing (breadcrumb, folder tiles,
  navigating in and out); tabs between your active files, Trash, and Shared
  links; a search box and sort control; checkbox-based multi-select with a
  batch action bar (download-as-zip, move, delete, restore); a warning
  banner once you're at 90%+ of your quota; and links out to Settings and
  (if you're an admin) the Admin panel.
- `pages/Settings.jsx` — Change your own password, sign out of every
  device at once, manage two-factor authentication, and see your own
  recent activity.
- `components/TwoFactorSection.jsx` — The 2FA setup wizard (QR code, code
  confirmation, one-time recovery-code reveal) plus the disable/regenerate
  controls once it's on, all in one self-contained panel used by Settings.
- `pages/Admin.jsx` — A table of every account with quick actions (reset
  password, set quota, toggle admin, disable/enable), each confirmed with a
  simple prompt/confirm dialog before it fires, plus the cross-family
  activity log below it.
- `components/UploadZone.jsx` — Drag-and-drop or click-to-browse upload,
  using `XMLHttpRequest` instead of `fetch` specifically because it can
  report upload progress percentage, powering the progress bar. Uploads
  land in whichever folder you're currently browsing.
- `components/FileTable.jsx` — One component, two modes: the normal file
  list (download/share/move/delete buttons, selection checkboxes) or the
  trash list (restore/delete-forever buttons), picked via a `mode` prop
  from whichever page is using it. This is what List view renders.
- `components/GalleryGrid.jsx` / `Thumbnail.jsx` / `Lightbox.jsx` — Grid
  view's photo-wall: `GalleryGrid` lays out tiles, `Thumbnail` fetches and
  displays (or falls back gracefully for) each individual preview image,
  and `Lightbox` is the full-size popup you get from clicking a tile, with
  the same download/share/move/delete actions available there too.
- `components/FolderGrid.jsx` — Renders the subfolders inside whatever
  you're currently browsing as clickable tiles, each with inline
  rename/delete controls.
- `components/Breadcrumb.jsx` — The "Home / Vacation / 2024" trail; every
  segment (including "Home") is clickable to jump straight back to that
  level.
- `components/MoveDialog.jsx` / `ShareDialog.jsx` / `Modal.jsx` — Small
  popups for moving one or more files to a different folder, or creating
  and copying a share link; `Modal.jsx` is the generic reusable popup shell
  underneath both.
- `components/StorageGauge.jsx` / `ActivityLED.jsx` — Small, purely visual
  components that just take numbers/booleans as input and render a bar or a
  dot accordingly.

**PWA files (in `frontend/public/`):**

- `manifest.json` — Name, icons, and colors used when the app is installed
  to a home screen.
- `icon-192.png` / `icon-512.png` / `apple-touch-icon.png` / `favicon.png` —
  App icons at the various sizes different platforms expect.
- `sw.js` — The service worker. Deliberately minimal: it never caches API
  calls (your file list, uploads, etc. always come from the live,
  authenticated backend), it only caches the app's own HTML/CSS/JS shell so
  the interface still loads through a brief network hiccup.

---

## Part 5: Running this for your family

### Everyone accessing it as easily as possible

The whole point of the Docker setup is that once it's running, using the
app is just visiting a web address in a browser — no installs, no
technical steps for anyone but you. A few ways to make that even smoother
for non-technical family members:

- **"Install" it to a home screen (recommended).** On a phone, open the
  site in the browser, then:
  - **Android (Chrome):** tap the ⋮ menu → "Add to Home screen" (Chrome may
    also prompt you automatically after a visit or two).
  - **iPhone/iPad (Safari):** tap the Share icon → "Add to Home Screen."
  This creates a real icon that opens the app in its own window, no address
  bar, exactly like the mobile "app" experience you're picturing — but
  there's no App Store install, since it *is* just the website underneath.
- **Bookmark it on desktop.** Same idea, lower ceremony — most browsers can
  pin a tab or create a desktop shortcut to a specific URL.
- **Give everyone the address once.** Whatever address you're running this
  at (see the networking note below), just share that link — that's the
  entire "how do I access it" instruction they need.

### Getting to it from outside your house

Running `docker compose up` makes the app reachable on your home network at
your computer's local address (and at `localhost:8080` on that same
computer). To have family members reach it while they're out — at school,
at work, traveling — without opening your home network up to the public
internet, the simplest and safest option is a private mesh network like
[Tailscale](https://tailscale.com/) (free for personal/family use) or
WireGuard: everyone installs a small app, and the server becomes reachable
at a private address only your devices can see — nothing exposed to the
open internet, no port-forwarding on your router required. This is worth
setting up before you consider giving remote access at all.

### Managing family accounts (the admin panel)

The first account created on a fresh server automatically becomes an
**admin** — make sure that's the account you create for yourself. From the
sidebar, admins see an **Admin panel** link (regular accounts don't). From
there you can, for any family member:

- **Reset their password** if they forget it — there's no email-based
  "forgot password" flow (that would require setting up outgoing email),
  so this is the practical substitute: they tell you, you reset it, you
  tell them the new one.
- **Adjust their storage quota** individually — useful if, say, one family
  member needs more space for a video project and another is fine with
  less than the server default.
- **Disable an account** temporarily (they simply can't log in until you
  re-enable it) — without deleting anything they've uploaded.
- **Promote another family member to admin**, if you want to share account
  management duties. (The system won't let you remove the last admin, so
  you can't accidentally lock everyone out of admin control.)

### Backups: making them actually protect you

The backup service (Docker path only) writes a compressed snapshot of the
entire database and every file to `backups/` on your host machine once a
day, keeping the last 14 days by default (`BACKUP_RETENTION_DAYS` in
`docker-compose.yml`). **This alone only protects you from mistakes inside
the app** (an accidental permanent delete, a bug) — it does *not* protect
you if that entire computer's disk fails, is stolen, or is destroyed, since
the backup would go with it. To actually cover that case, periodically copy
the `backups/` folder itself somewhere else: an external drive, a
different computer, a NAS, or a cloud storage sync folder. How often you do
this is up to how much data loss you could live with — for most families,
copying it off-machine weekly is a reasonable habit.

**Restoring from a backup**, if you ever need to:
```bash
docker compose down
docker run --rm -v homecloud_homecloud_data:/data -v ./backups:/backups alpine \
  sh -c "rm -rf /data/* && tar xzf /backups/<the-backup-file>.tar.gz -C /data"
docker compose up
```
(Replace `<the-backup-file>.tar.gz` with the actual filename from your
`backups/` folder, and adjust the volume name if `docker compose` created it
under a different project name — run `docker volume ls` to check.)

**Test this occasionally.** A backup you've never tried restoring isn't a
backup you can actually count on in an emergency.

---

## API reference

All routes except register/login/2fa-verify/public shares require an
`Authorization: Bearer <token>` header (the "wristband" from Part 1). Admin
routes additionally require the account to have the `admin` role.

| Method | Path                              | What it does                                |
|--------|------------------------------------|----------------------------------------------|
| POST   | `/api/auth/register`              | Create an account (first ever = admin)       |
| POST   | `/api/auth/login`                 | Log in (or start 2FA if it's enabled)        |
| POST   | `/api/auth/2fa/verify`            | Complete login with a 2FA/recovery code      |
| GET    | `/api/auth/me`                    | Current user + storage usage/quota/2FA status |
| POST   | `/api/auth/change-password`       | Change your password, revokes other sessions |
| POST   | `/api/auth/logout-everywhere`     | Revoke every session (incl. this one)        |
| POST   | `/api/auth/2fa/setup`             | Start enabling 2FA (returns QR/secret)       |
| POST   | `/api/auth/2fa/confirm`           | Confirm setup, enables 2FA, returns recovery codes |
| POST   | `/api/auth/2fa/disable`           | Turn off 2FA (requires password)             |
| POST   | `/api/auth/2fa/recovery-codes`    | Regenerate recovery codes (requires password) |
| GET    | `/api/files`                       | List active files in a folder (`?folderId=`) |
| GET    | `/api/files/trash`                 | List your trashed files                      |
| GET    | `/api/files/shares`                | List your active share links                 |
| POST   | `/api/files/upload`                | Upload a file (multipart, field `file`)      |
| POST   | `/api/files/download-batch`        | Download several files as one zip           |
| GET    | `/api/files/:id/download`          | Download a file                              |
| GET    | `/api/files/:id/thumbnail`         | Get an image file's small preview            |
| POST   | `/api/files/:id/share`             | Create a share link for a file               |
| POST   | `/api/files/:id/move`              | Move a file to a different folder            |
| DELETE | `/api/files/shares/:shareId`       | Revoke a share link                          |
| DELETE | `/api/files/:id`                   | Move a file to trash                         |
| POST   | `/api/files/:id/restore`           | Restore a file out of trash                  |
| DELETE | `/api/files/:id/permanent`         | Permanently delete a trashed file            |
| GET    | `/api/folders`                     | List subfolders in a folder (`?parentId=`)   |
| GET    | `/api/folders/all`                 | Your whole folder tree, flat                 |
| POST   | `/api/folders`                     | Create a folder                              |
| PATCH  | `/api/folders/:id`                 | Rename a folder                              |
| POST   | `/api/folders/:id/move`            | Move a folder under a different parent       |
| DELETE | `/api/folders/:id`                 | Delete a folder (`?force=true` if non-empty) |
| GET    | `/api/share/:token`                | *(no auth)* Download a shared file           |
| GET    | `/api/activity`                    | Your own recent activity                     |
| GET    | `/api/admin/users`                 | *(admin)* List all accounts + usage          |
| POST   | `/api/admin/users/:id/reset-password` | *(admin)* Set a user's password           |
| POST   | `/api/admin/users/:id/disabled`    | *(admin)* Disable/enable an account          |
| POST   | `/api/admin/users/:id/quota`       | *(admin)* Set/clear a personal quota override |
| POST   | `/api/admin/users/:id/role`        | *(admin)* Promote/demote admin status        |
| POST   | `/api/admin/users/:id/2fa/disable` | *(admin)* Force-disable 2FA for a locked-out user |
| GET    | `/api/admin/activity`              | *(admin)* Activity feed across every account |

---

## Notes on security & limits

- Passwords are hashed with bcrypt (12 rounds); plaintext passwords are
  never stored.
- Login, registration, and password-change attempts are rate-limited (10
  per 15 minutes per IP) to slow down brute-force guessing.
- Security headers are set via `helmet` on every response.
- Per-file upload limit is 1 GB (hard cap, set in `backend/src/files.js`).
- Per-user total storage quota defaults to 5 GB (`QUOTA_BYTES`), and admins
  can override it per family member from the Admin panel.
- Deleted files are recoverable from Trash for 30 days
  (`TRASH_RETENTION_DAYS`) before being permanently purged automatically.
- Changing a password or using "sign out everywhere" immediately invalidates
  every other active session for that account, not just future ones.
- Optional two-factor authentication (TOTP) is available per account, with
  recovery codes for a lost authenticator and an admin override for a
  worst-case lockout. The intermediate "pending" token issued between
  entering a password and entering a 2FA code is deliberately narrow — the
  main auth middleware explicitly refuses it, so it can't be used to skip
  the second step even if it were somehow intercepted.
- Share links use a 192-bit random token (not sequential or guessable) and
  are rate-limited separately from normal login attempts. Anyone with the
  exact link can download that one file with no login — treat a share link
  like you would a house key: fine to hand to someone specific, not
  something to post publicly. Revoke a link any time from the "Shared
  links" tab, or give it a short expiration up front.
- This is designed for trusted/home-network use. If family members need
  access away from home, use a private network layer like Tailscale (see
  Part 5) rather than exposing the server directly to the public internet.
  If you do expose it publicly, put it behind HTTPS (e.g. a reverse proxy
  like Caddy or Traefik with Let's Encrypt) — right now traffic, including
  passwords, is plain HTTP.
- There's no email-based password reset or email verification — the admin
  panel's password-reset feature is the intentional substitute, since email
  would require setting up an outgoing mail server.
- `npm run dev` (Vite's dev server) has a known advisory allowing other
  sites to reach it if you browse elsewhere while it's running — fine on a
  trusted machine, but don't expose that dev server to an untrusted
  network. This doesn't affect the Docker Compose setup, which serves a
  static production build via nginx.
- `react-router-dom` is pinned to 7.18.2, which fixes a real open-redirect
  advisory affecting earlier versions. A separate advisory affecting some
  7.x/8.x releases (a CSRF issue in React Router's server-rendering
  "framework mode," e.g. server actions/RSC) doesn't apply here — this app
  only uses React Router's plain client-side routing components
  (`BrowserRouter`, `Routes`, `Link`, `useNavigate`), none of that
  server-rendering machinery.
- The batch-zip feature uses `yazl`, a small zip-writing library with a
  single trivial dependency (a CRC32 checksum helper). An earlier draft
  used the more full-featured `archiver` library, but that pulls in an
  outdated `glob`/`minimatch` chain (used for wildcard directory scanning
  this app never actually needed) that trips vulnerability scanners like
  `npm audit`. Switching libraries removed the flagged dependencies
  entirely rather than just arguing the unused code path was harmless.

---

## A stability & bug-fixing pass

At one point this project got a dedicated audit specifically looking for
bugs, crash risks, and rough edges rather than new features. Worth knowing
about, since a couple of these were genuinely serious:

- **The big one: a single bad request could crash the entire backend for
  every family member, not just fail for whoever sent it.** Express 4
  doesn't automatically catch errors thrown inside an `async` route
  handler — an unhandled rejection there kills the whole Node process.
  This was verified directly (a minimal reproduction confirmed the crash),
  then found "in the wild": sending a non-string password (e.g. a JSON
  object instead of text) to the login endpoint crashed `bcrypt.compare`
  and took the server down. Every `async` route handler is now wrapped
  with a small utility (`asyncHandler`) that catches this properly instead,
  and login/register/password fields now validate their actual type before
  ever reaching bcrypt.
- **A real quota-bypass race condition.** The upload route checked "is
  this user under quota?" before an `await` (thumbnail generation), then
  wrote the database row after it — leaving a brief window where two
  uploads racing each other could each see "still under quota" before
  either one's write actually landed. Reordering so the only `await`
  happens *before* the check-then-write (which now runs as one
  uninterrupted step) closes this. Verified by actually firing two
  uploads at the same instant against a tight quota and confirming only
  one was accepted.
- **The backend now survives its own restarts more gracefully** — it
  closes the database properly and lets in-flight requests finish on a
  Docker stop/restart (`SIGTERM`), instead of just being killed mid-write.
- **A stale-response race in folder navigation.** Clicking between folders
  quickly could let a slower response for a folder you'd already left
  overwrite the correct, newer view with old data. Each request now carries
  a sequence number, and only the most recent one is allowed to update
  the screen.
- **Multi-file upload progress was broken.** Uploading several files at
  once shared a single progress bar behind the scenes, so it flickered
  between files and disappeared as soon as any *one* of them finished,
  even if others were still uploading. Each upload now tracks its own
  progress independently. (The "click to browse" button also only allowed
  selecting one file at a time, even though drag-and-drop already
  supported several — now both match.)
- **Error messages used to get stuck on screen.** An error banner from one
  action stayed visible indefinitely, even after later, unrelated actions
  succeeded. Every action now clears the previous error before attempting
  the next one.
- **The app didn't notice when it got logged out.** If a session expired,
  or another device used "sign out everywhere," the screen would just sit
  there with every subsequent action quietly failing, instead of returning
  to the login screen. It now reacts immediately.
- Thumbnails in Grid view now load lazily (only as they scroll near view),
  instead of a large photo library firing every single image request the
  moment the page opens.
- Smaller polish: modals and the image lightbox close on the Escape key;
  file-action buttons wrap instead of overflowing on narrow phone screens;
  file tables scroll horizontally instead of breaking layout on small
  screens; share-link expirations are now validated to a sane 1-365 day
  range instead of silently accepting negative or absurd values.

### A second, deeper pass

A follow-up review specifically re-read every file from scratch rather than
trusting memory of what had already been checked — which is exactly how
these were found:

- **Share links kept working after the file was "deleted."** Moving a
  shared file to Trash didn't revoke its public link — anyone who had the
  link could keep downloading it, which isn't what "I deleted this" should
  mean. Fixed so a share stops working the moment its file is trashed, and
  quietly resumes if the file is restored (verified all three states
  directly: works, then 404s once trashed, then works again after restore).
- **A stolen session token alone could silently strip 2FA protection, no
  password required.** Re-running 2FA setup on an account that already had
  it enabled would silently swap in a new secret and turn 2FA off — with
  no password check at all. Since the whole point of 2FA is protecting
  against exactly this kind of stolen-credential scenario, this defeated
  its own purpose. It now requires the current password to reset 2FA once
  it's already on, matching the same bar already used for disabling it —
  confirmed the legitimate first-time setup flow (which never needed a
  password) is completely unaffected, since the app's own UI never
  triggers this path once 2FA is already active.
- **A CORS misconfiguration that would have silently blocked everything.**
  If `CORS_ORIGIN` were ever left unset, the fallback was supposed to
  allow all origins — but wrapping `"*"` in an array (as the code did)
  means something different to the `cors` library than a bare `"*"`
  string: it treats the array form as a literal origin to match against,
  which no real browser ever sends, so it would have silently blocked
  every cross-origin request instead of allowing them. Verified the bug
  directly (no CORS header appeared at all), fixed it, then re-verified
  both the "allow everything" fallback and the normal "one specific
  origin" case still work correctly.
- **Batch actions could leave the screen out of sync with reality.**
  Selecting several files and deleting/moving/restoring them used
  `Promise.all`, which is all-or-nothing: if even one file in the batch
  failed, none of the others — even ones that had *already succeeded* on
  the backend — would be reflected on screen. Confirmed this with a real
  concurrent test (two files trashed successfully, one intentionally
  invalid) showing the backend correctly processed each independently
  while the old frontend logic would have discarded all the good news
  along with the one failure. Switched every batch action to
  `Promise.allSettled`, so successes are always reflected immediately and
  only genuine failures get reported.
- **Malformed input could crash a route into an ugly 500 instead of a
  clean error.** A batch-download request with a non-numeric id in the
  list, for instance, would throw partway through building the database
  query. Not a crash risk (Express catches synchronous throws fine — only
  `async` handlers needed the earlier fix), but still a rough edge: it now
  returns a clear 400 explaining what was wrong instead.
- **New activity types were missing their friendly labels.** The 2FA
  feature logs several new activity types (enabling/disabling it, logging
  in with a recovery code, etc.), but the label list that turns those into
  readable text was never updated to include them — so they'd have shown
  up as raw text like `2fa_login` in the activity feed instead of "Logged
  in with a two-factor code."
- **Docker builds weren't actually reproducible.** Neither Dockerfile
  copied `package-lock.json` or used `npm ci` — meaning a rebuild months
  from now could silently resolve different (possibly breaking) versions
  of dependencies than what was actually tested, without any change to
  the project's own code. Both now install from the exact locked versions.
- **The backup service could crash-loop instead of just skipping a bad
  cycle.** If any single step of a backup failed partway through (a full
  disk during the rename, a permission hiccup while pruning old backups),
  the whole script would exit under `set -e` — relying entirely on Docker
  to restart it, and looping forever if the underlying problem was
  persistent rather than transient. Verified the failure mode directly,
  then fixed it so one bad cycle is logged and skipped, and the next
  scheduled attempt just tries again normally.
- Two environment variables (`PORT`, `DATA_DIR`) were listed in
  `backend/.env.example` looking just as editable as the ones you're
  actually meant to change — but changing either would silently break the
  Docker setup, since `docker-compose.yml` hardcodes matching values
  elsewhere (the healthcheck port, and the data volume's mount path).
  Both now have a clear comment explaining not to touch them there.

### A third pass: an automated test suite, and what writing it found

Before this pass, none of the above fixes had a test guarding against
regressing later — every one of them was caught by manual, one-time
verification. This pass added a real automated suite instead, and along the
way found one more genuine issue:

- **`server.js` was split into `app.js` (the Express app itself — routes,
  middleware, error handling) and a thin `server.js`** that only starts the
  listener, the trash-purge timer, and OS signal handling. This changes no
  runtime behavior (verified: booted the refactored version and re-ran the
  exact same smoke tests as before) — it exists purely so tests can spin up
  the real app in-process without a real port, timer, or crash handler
  competing with a live deployment.
- **60 tests** now cover `auth`, `files`, `folders`, `admin`, `publicShare`,
  and all of HomeCore's `/api/core/*` routes, using Node's built-in test
  runner (`node --test`) — no new test-framework dependency. Each test file
  gets its own fresh, isolated temp SQLite database (Node's test runner
  gives every file its own process, verified directly), so nothing in one
  test file can leak into another. Run them with `npm test` inside
  `backend/`.
- **What writing the auth tests actually found: a shared rate-limit bucket
  across every auth-adjacent action.** `authLimiter` (10 requests per 15
  minutes) is attached to register, login, 2FA verify, password change, and
  every 2FA setup/disable route — but it's one shared limiter instance, so
  all of those count against the *same* 10-request budget, keyed only by IP.
  That's realistic behavior for a determined attacker, but it also means a
  handful of family members behind the same router IP doing entirely
  ordinary things in a short window (a couple of logins, someone setting up
  2FA) could plausibly lock each other out. Rather than change the actual
  limit (a product decision, not a bug), the fix made rate limiting
  *test-controllable* without changing it in production at all: a new
  `src/rateLimiter.js` wraps `express-rate-limit` behind a
  `DISABLE_RATE_LIMIT_FOR_TESTS` environment variable that only the test
  harness ever sets — a real deployment's `.env` never sets it, so nothing
  about the limiter's behavior changes for anyone actually running the
  server. One dedicated test (`rateLimiting.test.js`) deliberately runs
  *with* the real limiter still on, specifically to confirm it actually
  blocks the 11th request with a `429` — so the control itself is verified,
  not just disabled and forgotten about.
- A couple of bugs turned up in the *tests themselves* while writing them
  (a test using a freshly-registered account as if it were the admin, and
  a test whose own admin session went stale mid-test because demoting an
  account — even by itself — correctly forces that account to re-log-in).
  Both are noted in the test files' comments; neither was an application
  bug, just a reminder that test code needs the same care as the code it's
  checking.

---

## Building HomeMedia

The first real test of HOME_MASTER_SPECIFICATION.md's platform promise: "Installing HomeMedia later should not require rebuilding HomeCloud." This section covers what HomeMedia is, how it's built, and what's deliberately not in it yet.

### What changed in HomeCloud to make this possible

- **The photo gallery, lightbox, and their thumbnail viewer are gone from HomeCloud's own frontend.** `GalleryGrid.jsx`, `Lightbox.jsx`, and `Thumbnail.jsx` are deleted; the grid/list view toggle is gone too. HomeCloud is back to being what §2 of the spec calls it: a file manager, not a photo viewer. That's HomeMedia's job now, and having both apps offer a photo-browsing experience was exactly the overlap this build was told to remove.
- **HomeCloud's backend gained one new endpoint: `GET /api/files/all?type=image|video`.** A flat, cross-folder listing, filtered by top-level mime type — since HomeMedia needs to discover "all my photos" without walking the folder tree itself. It's still just "list my files" from HomeCloud's point of view, gated by the same `requireAuth` as every other route; HomeCloud doesn't know or care that HomeMedia is the one calling it.
- **Nothing else about HomeCloud changed.** No new tables, no new relationship to HomeMedia's data. If HomeMedia's container is stopped entirely, HomeCloud doesn't notice.

### How HomeMedia is actually built

Unlike HomeCore (which still lives embedded inside HomeCloud's own backend process — a deliberate v0 shortcut documented back in the HomeCore section), **HomeMedia is a genuinely separate service**: its own `homemedia-backend/` (Express, its own small SQLite database, its own container) and its own `homemedia/` frontend. This was a deliberate choice, not an oversight — Phase 5 of the spec exists specifically to prove a second application *can* be bolted onto the platform without touching HomeCloud, and embedding it the way HomeCore is embedded would have quietly sidestepped that proof.

A few things that fall out of that separation:

- **HomeMedia has no identity of its own.** Every request to `homemedia-backend` is authenticated by calling HomeCloud's own `/api/auth/me` (see `homemedia-backend/src/homecloudClient.js`) — so a disabled account, a password change, or "sign out everywhere" on HomeCloud takes effect on HomeMedia too, automatically, with no duplicated logic. There's a 5-second cache purely so a gallery page loading a few dozen thumbnails at once doesn't fire a few dozen simultaneous verification calls — not to compromise on how fresh "signed out" actually is.
- **HomeMedia stores no photos or videos.** Its own database (`homemedia.db`) holds only albums, favorites, and a cached EXIF extraction per file — every actual byte is fetched from HomeCloud on demand. Deleting HomeMedia's entire volume and starting fresh loses your albums and favorites, never a single photo.
- **One shared front door per app, not two origins to configure.** Same pattern `home/` already established: each frontend's nginx proxies `/api/` to HomeCloud's backend, so the browser never deals with CORS. HomeMedia's `nginx.conf` adds one more, more specific rule first — `/api/homemedia/` goes to its own backend, everything else falls through to HomeCloud's.
- **Thumbnails aren't duplicated wastefully.** HomeMedia generates and caches its *own* larger, gallery-quality thumbnails (640px, vs. HomeCloud's own 320px file-manager icon) — but only the first time a given photo is actually viewed in the gallery, not for everything ever uploaded to HomeCloud. A photo nobody's opened in HomeMedia never gets a HomeMedia-side thumbnail at all.
- **`<img>` tags can't carry an Authorization header.** Rather than the common shortcut of putting the token in the URL (which leaks into browser history and server logs), thumbnails and full images are fetched properly with the header attached and turned into object URLs — see `AuthImage.jsx`.
- **Tested against a real HomeCloud, not a mock of one.** `homemedia-backend`'s test suite (18 tests) boots an actual isolated HomeCloud test instance as its upstream — reusing HomeCloud's own test harness directly, since they live in the same monorepo — so these are genuine integration tests, including a real JPEG with real embedded EXIF tags (written with `sharp`, read back with `exifr`) rather than a hand-built fixture standing in for one.

### What's in v1, and what's deliberately not

**In:** a timeline-grouped photo/video library, search by filename, favorites, albums (create/rename/delete, add/remove photos, set a cover), a lightbox with keyboard navigation and an EXIF detail panel (camera, lens, exposure, GPS if present), video playback.

**Deliberately deferred, not forgotten:**
- **Video thumbnails.** A real poster-frame preview needs a video decoder (ffmpeg) this service doesn't carry — adding it is a real, justified dependency for a later pass, not a speculative one now. Videos show a generic tile in the grid instead of a real preview for v1.
- **Duplicate detection and shared/multi-user albums** — both listed in the spec's HomeMedia feature set, both real design problems (perceptual hashing; a whole ACL model) that deserve their own pass rather than a rushed corner of this one.
- **Mobile upload integration** — explicitly depends on HomeSync (Phase 4), which doesn't exist yet.
- **HomeMedia's own registry entry is pre-seeded by HomeCloud's backend at startup** (see `homecore/seed.js`), rather than through a real "install an application" admin flow. This works because it's one more `INSERT OR IGNORE` in the same seeding step that already registers HomeCloud itself — but it's a deliberate shortcut specific to knowing HomeMedia will exist in this deployment, not a pattern to keep copy-pasting for every future application without reconsidering it. A real admin-driven install/register flow (§45's discover → install → register → enable lifecycle) is a good candidate for whichever pass adds the *next* application.

### One honest limitation of this pass

Docker itself isn't available in the environment this was built in, so the full `docker-compose.yml` wiring (five services now, three of them new or changed) is verified by YAML syntax validation and by every individual piece being tested in isolation — not by an actual `docker compose up` end-to-end run. That's worth doing once as a first real deploy check after pulling this update.

## Building HomeSync

The Android backup client (§13) and its API. This section is more upfront about verification than any other in this document, because the honest answer is different here.

### Two very different confidence levels in this section

Everything backend-side — `homesync-backend/` — is tested exactly like every other service in this project: real integration tests against a real HomeCloud instance, 20 of them, all passing (`npm test` inside `homesync-backend/`).

`homesync-android/` is different. This environment has no Android SDK, no emulator, no device — so the Android app was never actually built or run. That's not a small caveat; it's the difference between "verified" and "written carefully." Concretely:

- **`sync/SyncLogic.kt` — the core hashing and dedup-planning logic — has zero `android.*`/`androidx.*` imports specifically so it could be compiled and run outside Android entirely.** It was: with the Kotlin compiler directly (`kotlinc`) and separately as real JUnit tests via `org.junit.runner.JUnitCore` — 7/7 passing, including a streaming-SHA-256 implementation checked against known test vectors and against Java's own `MessageDigest` computed independently. That JUnit test class lives at `app/src/test/java/.../SyncLogicTest.kt` and will run identically via `./gradlew test` once this is opened in Android Studio.
- **Everything else — Compose UI, WorkManager, Room, Retrofit, the Gradle setup itself — was written on well-established, standard patterns, but has not been compiled.** The first time this project actually builds will be when you open it in Android Studio. Don't take "17 Kotlin files, all consistent" as "guaranteed to compile" — treat the first build as a real first build, not a formality.

### What's actually in the app

- Sign in with the same HomeCloud account used everywhere else (§27, one identity provider) — full 2FA support, not just password login.
- Toggle Photos / Videos / Screenshots / Downloads independently.
- Wi-Fi-only and charging-only, mapped onto WorkManager's *native* `Constraints` (`NetworkType.UNMETERED`, `setRequiresCharging`) rather than the app polling connectivity/battery state itself — letting the OS own "is now an okay time" is both less code and more correct.
- A "Back Up Now" button for an immediate run, which still respects the Wi-Fi/charging settings — an explicit request to back up now isn't a request to also ignore your data plan.
- Content-hash-based deduplication, checked against the server *before* uploading, so backing up the same phone twice — or two phones with overlapping photos — doesn't create duplicate files in HomeCloud.
- A "last backup" summary (files, size, when), pulled from the server when reachable and falling back to a local cache otherwise.

### How the API is shaped, and why there's only one server address to type in

The person only ever enters *one* address on the login screen — HomeSync's, not HomeCloud's. `homesync-backend/src/authProxy.js` is a small, genuine proxy (forward the request, forward the response, nothing more) that exists purely so this is true: it forwards `/api/homesync/auth/login`, `/2fa/verify`, and `/me` straight through to HomeCloud. This mirrors exactly what `home/nginx.conf` and `homemedia/nginx.conf` already do for their browser frontends (proxy `/api/` to the shared backend) — there's just no nginx layer in front of a plain Node API service, so `authProxy.js` does the same job by hand. Three tests in `homesync-backend/test/authProxy.test.js` confirm login, a wrong password, and the full 2FA flow all work end-to-end through the proxy alone.

Every other HomeSync-specific route (`/devices`, `/check`, `/upload`, `/history`) follows the exact same pattern as HomeMedia's backend: no identity or storage of its own, every request verified against HomeCloud's `/api/auth/me`, every file actually stored by uploading it through to HomeCloud's own `/api/files/upload`. Files land in HomeCloud under `Category/Year/Month` (e.g. `Photos/2026/August`) — `homesync-backend/src/pathPlanner.js` decides the path (pure function, unit tested), `homecloudClient.js`'s `resolveFolderPath` creates any missing folders via HomeCloud's own folder API. HomeMedia already scans every folder for images/videos regardless of location, so anything HomeSync backs up shows up there automatically — the two were never explicitly wired together; it falls out of both following the same spec.

### Deliberately not in v1

- **True resumable/chunked upload.** If a large video's upload connection drops partway through, the next run retries the *whole file*, not just the missing bytes. A real byte-range-resumable protocol (tus-style) is a legitimate, separate piece of work — this is a scope decision, not an oversight, made reasonable by Wi-Fi-only being the default and most backup candidates being well under a few hundred MB.
- **A numeric battery-percentage threshold.** WorkManager's built-in `requiresBatteryNotLow` constraint is used instead of a custom "back up only above N%" setting — the OS-level constraint needs no polling code and covers the actual goal (don't drain a low battery) without extra surface area.
- **Editing a photo in place isn't detected.** The local dedup cache (`SyncedMediaEntity`) is keyed by MediaStore id alone; a photo edited after being backed up (same id, different bytes) won't be re-uploaded. Documented in `SyncedMediaEntity.kt`'s own comment, not hidden.
- **Real app icon design, bundled fonts matching the web apps' IBM Plex Mono/Inter pairing.** The launcher icon is a simple vector placeholder; typography falls back to the system font. Both are cosmetic, both worth a real pass once the app's architecture itself has been through a real build-and-run cycle.

### Manual dependency injection, on purpose

`HomeSyncApplication.kt` is a plain service locator, not Hilt/Dagger. With no way to actually build this project and catch an annotation-processor misconfiguration, adding one more thing that can silently be subtly wrong felt like the wrong tradeoff — especially for a dependency graph this small, where the usual case for a DI framework (a large web of interdependent objects) doesn't really apply yet.

### First-build checklist

1. Open `homesync-android/` in a recent Android Studio (Gradle sync will fetch the wrapper JAR itself — it isn't and can't be hand-authored as a binary file, only `gradle/wrapper/gradle-wrapper.properties` pointing at a Gradle version is included).
2. Let it fail. It might not — but if it does, that's the normal first-build experience for a project that's never been compiled, not a sign something is unusually broken.
3. Point the login screen at `homesync-backend`'s address (e.g. `192.168.1.50:8083` for a typical LAN deployment) — cleartext HTTP is deliberately allowed in `AndroidManifest.xml` for exactly this case; see its comment for why.

---

## Building HomeNotes

The Markdown notes app (§15) — a quiet, editorial writing space, and the first application in this ecosystem that isn't primarily about files or photos.

### Where note content actually lives

§2.2 of the spec is explicit: "do not build a second file storage system for HomeNotes." That's about file *storage* specifically — and note text is small, structured data, genuinely at home in a database row, not the kind of thing that warning is about. So the split here is:

- **Note content, folders, tags, and version history live in HomeNotes' own database** (`homenotes-backend`'s SQLite file) — the same reasoning HomeMedia already established for albums/favorites and HomeSync for devices/dedup records.
- **Attachments are real HomeCloud files.** Uploading an attachment goes straight through to HomeCloud's own `/api/files/upload`; HomeNotes only remembers which file ids are attached to which note. Removing an attachment from a note only removes that reference — same "never destroy the underlying file as a side effect" principle as removing a photo from a HomeMedia album.

Architecturally this is now a well-worn pattern: own backend, own frontend, own small database, no identity of its own (every request verified against HomeCloud's `/api/auth/me`), same dual-proxy nginx setup HomeMedia already uses so the browser only ever talks to one origin.

### What's actually in it

Nested folders, Markdown notes with a Write/Preview toggle (rendered with `marked` — a small, well-established parser, not a heavyweight WYSIWYG editor), tags with autocomplete-free free-form entry and per-tag note counts, favorites, full-text search across titles and content, a trash with restore/permanent-delete, autosave, version history, and attachments.

**A genuine bug this surfaced, worth naming:** force-deleting a folder that has notes in it needs to clear those notes' `folder_id`, not just mark them trashed — otherwise the folder row can't actually be deleted while something still references it. The first version of this got that wrong and threw a foreign-key error; the test that caught it (`noteFolders.test.js`) was then extended with a genuine 3-level-deep nested-folder case specifically because the original fix only handled one level correctly. Both are fixed and both are tested now, including the deep case.

**Version history's actual behavior, worth being precise about:** a snapshot is taken *before* an edit lands, not after — so what you see in history is "what this note looked like up until this point," not a copy of what you just typed. Snapshots are debounced (at most one every 5 minutes) so continuous typing during autosave doesn't produce one row per keystroke pause. Restoring an old version always snapshots whatever was live immediately before the restore, so restoring can never silently lose the version you restored *from*.

### Deliberately not in v1

- **Real-time collaborative editing.** Everything here assumes one person editing one note at a time — reasonable for a personal/family notes app, a real design problem (operational transforms or CRDTs) if it's ever needed.
- **Rich WYSIWYG editing.** A plain-text Markdown source pane plus a rendered preview was the deliberate choice over embedding a heavier rich-text editor library — less surface area, less that can subtly break, and Markdown source is already a completely reasonable writing experience on its own.
- **Offline mode**, mentioned as optional in the spec's own feature list. A real implementation needs a service worker, a local write queue, and actual conflict resolution — a legitimate future pass, not something worth doing halfway.

---

## Glossary


A quick-reference for terms used throughout this document.

- **API** — a fixed set of requests one program can make to another.
- **Endpoint** — a specific URL an API responds to, e.g. `/api/files`.
- **HTTP method** — the "verb" of a request: `GET` (read), `POST` (create),
  `DELETE` (remove), etc.
- **Status code** — a 3-digit number in a response summarizing what
  happened (`200` OK, `401` unauthorized, `429` too many attempts, etc.)
- **JSON** — a plain-text format for structured data, used in almost every
  API request/response.
- **Frontend** — the part of an app that runs in your browser.
- **Backend** — the part of an app that runs on a server, doing the real
  work and remembering data.
- **Database** — organized, searchable storage for data (here: SQLite).
- **Hashing** — one-way scrambling, used so passwords are never stored in
  readable form.
- **JWT (JSON Web Token)** — a signed token proving who you are, so you
  don't have to log in on every single request.
- **Token revocation** — invalidating a previously issued JWT early (before
  its natural expiry), used here for password changes and "sign out
  everywhere."
- **Rate limiting** — capping how many attempts (e.g. logins) are allowed
  from one place in a given time window, to slow down abuse.
- **Role / RBAC** — labeling accounts (e.g. `admin` vs. `user`) to control
  who's allowed to do what (role-based access control).
- **Soft delete** — marking something as deleted without actually removing
  it yet, so it can still be recovered (this is how Trash works).
- **Node.js** — a runtime that lets JavaScript run outside a browser.
- **npm** — Node's package manager; installs other people's reusable code.
- **nvm / nvm-windows** — a tool for installing/switching Node versions.
- **React** — a library for building frontends out of reusable components.
- **Vite** — the build tool that compiles React code into what a browser
  can run.
- **Express** — a library that makes writing a Node backend server easier.
- **Docker / container** — packages an app with everything it needs to run,
  so it behaves identically on any machine.
- **Docker Compose** — starts multiple related containers together with one
  command.
- **Environment variable / `.env` file** — configuration values (like
  secret keys) kept outside your actual code.
- **Middleware** — code that runs before a request reaches its final
  handler, often to check something (like "is this user logged in?").
- **Quota** — the maximum storage a user is allowed to use.
- **PWA (Progressive Web App)** — a website that can be "installed" to a
  device's home screen/app list via a manifest + service worker.
- **Service worker** — a small script a browser runs in the background,
  used here to cache the app's shell and enable PWA installability.
- **Share link / token** — a URL containing a long random string that
  grants access to one specific file without needing to log in.
- **Batch action** — performing the same action (download, delete, etc.) on
  several selected items at once instead of one at a time.
- **Zip archive** — a single compressed file bundling multiple files
  together, used here so "download 5 files" can be one browser download.
- **Activity log** — a chronological record of who did what, used to answer
  "wait, what happened to this file?" after the fact.
- **Breadcrumb** — a trail showing your current location in a folder
  hierarchy (e.g. "Home / Vacation / 2024"), built by walking up parent
  folders one at a time.
- **Recursive query** — a database query that repeatedly follows a
  relationship (like "folder inside folder") until there's nothing further
  to follow, used here to find every file nested inside a folder you're
  deleting, however deep.
- **Thumbnail** — a small, quickly-loading preview copy of an image,
  generated once at upload time instead of shrinking the full-size original
  every time it's displayed.
- **Lightbox** — a full-screen popup for viewing one image at a time,
  without navigating away from wherever you were browsing.
- **Object URL** — a temporary, browser-local URL (like
  `blob:https://...`) that points at data already sitting in memory (e.g. an
  image just fetched via JavaScript) so an `<img>` tag can display it
  without a second network request.
- **2FA (two-factor authentication)** — requiring a second proof of
  identity beyond a password, here a time-based code from an authenticator
  app.
- **TOTP (Time-based One-Time Password)** — the specific standard behind
  most authenticator apps: a shared secret plus the current time produce a
  code that changes every 30 seconds.
- **Recovery code** — a one-time-use backup credential for logging in if
  you lose access to your normal 2FA method.
- **Pending token** — a deliberately limited, short-lived token proving
  only "correct password," issued between the two steps of a 2FA login,
  and rejected everywhere except the route that completes that login.

---

## Extending it further

Already built: a trash bin, an admin panel, per-user quotas, rate limiting,
forced sign-out, PWA installability, shareable links, batch download/delete,
search/sort, an activity log, nested folders with move support, a
thumbnail-powered gallery view, and two-factor authentication with recovery
codes. Some natural next steps if you want to keep growing this:

- Multi-file (batch) upload and drag-drop of whole folders
- Automatic photo backup from phones (closer to a Google Photos-style
  camera roll sync — a bigger lift, likely its own companion mechanism)
- File versioning (keep history when a file is overwritten, not just when
  it's deleted)
- Encryption at rest for files on disk

## Tiered architecture

The repository is laid out as `gateway/` (Tier 0 routing), `homecore/`
(intended Tier 0 platform), `apps/` (Tier 1 applications — `home`,
`homecloud`, `homemedia` + `homemedia-backend`, `homenotes` +
`homenotes-backend`, `homesync-backend`, `homesync-android`), and `services/`
(operational/Tier 2 — currently just nightly backups). **Home** is the main
application at `/`; **HomeCloud** is mounted at `/cloud/`.

**Honest current-state caveat:** `homecore/` is named for its intended role
but has not actually been split apart yet — it still runs HomeCloud's own
file/folder/admin/activity routes in the same process, on the same database,
as the real HomeCore identity/permissions/registry code. See
`MIGRATION_PLAN.md` at the repo root for the concrete plan to separate them
into two independently-deployable services, matching how HomeMedia, HomeSync,
and HomeNotes already call HomeCloud's identity API instead of sharing its
database.
