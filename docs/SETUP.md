# Setup

Merged from the root `README.md`'s "Setting it up" section and a separate
branch's `SETUP_GUIDE.md`. **Corrected for the gateway:** the original
`SETUP_GUIDE.md` and its `setup.sh`/`setup.ps1` scripts were written
*before* the gateway was restored, when every app published its own port
(`8080`/`8081`/`8082`/`8083`). That's no longer how this runs — see the
callout in §1.

## 0. The three-machine picture

This is meant to run as one always-on server, reached from other devices:

| # | Machine | Runs | Needs |
|---|---|---|---|
| 1 | **Server** | Docker Compose: gateway, backend, 3 frontends, 2 app backends, backup | Docker Desktop, this repo |
| 2 | **Daily PC / phone browser** | Nothing installed | The server's address in a browser |
| 3 | **Phone (HomeSync)** | The Android app (built once in Android Studio) | The server's address — see `SERVICES.md` for the Android app's current build status before relying on this |

Single machine, no second device yet? Skip to §4.

## 1. Machine 1 — the server

### Fastest path: the setup script

```bash
./setup.sh              # macOS / Linux
```
```powershell
.\setup.ps1              # Windows (PowerShell)
```

It generates a real `JWT_SECRET`, checks Docker is installed and running,
and (after one confirmation) builds and starts everything. `--no-start` /
`-NoStart` prepares `.env` files only; `--yes` / `-Yes` skips the
confirmation prompt.

> **Known gap, correct as of this doc:** the script also detects this
> machine's LAN IP and writes it to a root `.env` file as `LAN_IP=...`,
> and its final summary prints four separate ports (`8080`–`8083`). Both
> of those match the **pre-gateway** setup, not this one.
> `docker-compose.yml` no longer reads `LAN_IP` at all — every frontend
> URL is hardcoded to `http://localhost:8080/...` — and only the gateway's
> port (`8080`) is published; `8081`/`8082`/`8083` don't exist as host
> ports anymore. The secret-generation and Docker-readiness parts of the
> script are still accurate and worth running; **ignore its final printed
> URL list and use the table in §1.3 below instead.** Patching the script
> itself is tracked in `ROADMAP.md`.

### 1.1 Manual path (Docker)

You'll need [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed and running. On Windows this needs hardware virtualization
enabled (Task Manager → Performance → "Virtualization").

1. **Set a real JWT secret:**
   ```bash
   cp backend/.env.example backend/.env      # macOS/Linux
   ```
   ```powershell
   Copy-Item backend\.env.example backend\.env   # Windows
   ```
   Edit `backend/.env`, set `JWT_SECRET` to a long random value:
   ```bash
   openssl rand -hex 32                       # macOS/Linux
   ```
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Leave `PORT` and `DATA_DIR` alone — Docker networking depends on them
   matching `docker-compose.yml`. Adjust `QUOTA_BYTES` (default 5 GB) and
   `TRASH_RETENTION_DAYS` (default 30) here if you want different
   defaults.

2. **Build and start everything:**
   ```bash
   docker compose up --build -d
   ```
   This builds and wires up all 8 containers: `backend` (HomeCloud API +
   embedded HomeCore), `frontend` (HomeCloud UI), `home` (dashboard),
   `homemedia-backend` + `homemedia`, `homesync-backend`, `gateway`, and
   `backup`. Only `gateway` publishes a host port now.

3. **Open it:** `http://localhost:8080` — this is **Home**, the entrance
   hallway, not HomeCloud directly. HomeCloud lives at
   `http://localhost:8080/cloud`, HomeMedia at
   `http://localhost:8080/media`. Because everything sits behind this one
   address, logging into any one of them logs you into all of them.

   **Create the first account** — it automatically becomes admin.

Data persists in a Docker named volume (`homecloud_data`); `docker
compose down && docker compose up` keeps it, `docker compose down -v`
wipes it. Backups land in a real `backups/` folder next to
`docker-compose.yml` on the host (see `SERVICES.md` for what "backup"
actually covers and doesn't).

### 1.2 Manual path (no Docker)

Useful if Docker isn't an option. Two terminals minimum.

**Backend** (macOS/Linux):
```bash
cd backend
cp .env.example .env    # set JWT_SECRET as in §1.1
npm install
npm run dev              # :4000
```

**Backend** (Windows, from a clean machine with no Node yet):
1. Install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases),
   open a **new** PowerShell, then `nvm install 20 && nvm use 20`.
2. `node -v` / `npm -v` should show `v20.x` / `10.x`.
3. `cd backend; Copy-Item .env.example .env`, generate and paste a
   `JWT_SECRET` as above, then `npm install; npm run dev`.

If `npm install` fails mentioning `node-gyp`/`python`/`MSBuild` (this
happens because `better-sqlite3` sometimes compiles from source on
Windows): install Python 3 (check "Add to PATH") and Visual Studio Build
Tools with the "Desktop development with C++" workload, restart the
terminal, retry.

**Frontend** (same on every OS):
```bash
cd frontend
npm install
npm run dev              # :5173, proxies /api to :4000
```
Visit `http://localhost:5173`. Nothing backs this up automatically — see
§5 for a manual approach.

To also run Home and HomeMedia locally without Docker, see §4.2 — same
idea, extra terminals.

### 1.3 Where things actually are (corrected port table)

| Address | What |
|---|---|
| `http://localhost:8080` | Home (dashboard) |
| `http://localhost:8080/cloud` | HomeCloud |
| `http://localhost:8080/media` | HomeMedia |
| `http://localhost:8080/sync` | HomeSync's plain info page |
| `http://<server-LAN-IP>:8080/...` | Same paths, from another device on your network |

There is no `8081`/`8082`/`8083` in the current setup — that was the
pre-gateway layout. If you're pointing a second device at this server,
use the LAN IP with port `8080` and the path from the table above.

**Finding the server's LAN IP**, if you need it for another device:
- macOS/Linux: `ipconfig getifaddr en0` (Wi-Fi) or `hostname -I`
- Windows: `ipconfig` → "IPv4 Address" under the active adapter

Prefer a static/reserved IP for the server in your router settings so it
doesn't silently change later.

Leave this machine running (`restart: unless-stopped` is already the
Compose default, so containers come back on their own once Docker itself
restarts after a reboot).

## 2. Machine 2 — a daily-driver PC or phone browser

Nothing to install. Open `http://<server-ip>:8080` and log in — the first
account ever created becomes admin, from whichever machine creates it.

Optional, to make it feel like a real app:
- **Android (Chrome):** ⋮ menu → "Add to Home screen."
- **iPhone/iPad (Safari):** Share icon → "Add to Home Screen."
- **Desktop:** bookmark it, or use the browser's install icon if it's a
  PWA-enabled page (currently only HomeCloud's own frontend has full PWA
  support — see `SERVICES.md`).

## 3. Machine 3 — the phone (HomeSync)

**Read `SERVICES.md#homesync` before spending time on this.** The
Android app currently has a real gap: several files reference a `data`
package (network client, session storage, local database) that doesn't
exist in the repository yet. It will not build until that's added. The
steps below are what building it will look like once that's fixed.

1. Install [Android Studio](https://developer.android.com/studio), open
   `homesync-android/` as a project, let Gradle sync.
2. Connect a phone with USB debugging on (or use an emulator) and hit
   Run — or **Build → Generate Signed Bundle/APK** and sideload the APK.
3. On the login screen, enter the **gateway's** address — e.g.
   `192.168.1.50:8080` — not a separate HomeSync-only port; that's the
   pre-gateway layout. Cleartext HTTP is deliberately allowed in
   `AndroidManifest.xml` for this self-hosted, no-public-HTTPS case (see
   its own comment, and `SECURITY.md` for the TLS plan this is waiting
   on).
4. Log in with the existing HomeCloud account (full 2FA support), toggle
   which categories to back up, and confirm with "Back Up Now" once.

## 4. Single-machine dev/test mode (no second device, no Docker)

Useful for previewing the UI or developing, before setting up multiple
machines. Every backend here uses SQLite — a file created automatically
on first run, nothing to install or mock.

### 4.1 HomeCloud only (minimum viable preview)

**Terminal 1:**
```bash
cd backend
cp .env.example .env    # set JWT_SECRET
npm install && npm run dev     # :4000
```
**Terminal 2:**
```bash
cd frontend
npm install && npm run dev     # :5173
```
Visit `http://localhost:5173`. Vite's dev proxy already forwards `/api`
to `:4000` — no CORS setup needed for this pair specifically.

### 4.2 Adding Home and HomeMedia

Pre-configured to run alongside the above without port conflicts —
frontends on `5173`/`5174`/`5175`, backends on `4000`/`4200`:

```bash
cd home && npm install && npm run dev            # :5174
cd homemedia-backend && npm install && npm run dev  # :4200
cd homemedia && npm install && npm run dev        # :5175
```

`backend/.env`'s `CORS_ORIGIN` defaults to just `:5173`. Running more
than that at once needs either commenting it out (allows all origins —
fine on your own machine) or listing all three:
```
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:5175
```
Restart the backend after changing `.env`.

### 4.3 Adding HomeSync's backend (no phone required)

```bash
cd homesync-backend
npm install
HOMECLOUD_INTERNAL_URL=http://localhost:4000 npm run dev    # :4300
```
(`HOMECLOUD_INTERNAL_URL` defaults to a Docker-network hostname that only
resolves inside Compose — override it for local dev, as above. On
Windows PowerShell: `$env:HOMECLOUD_INTERNAL_URL="http://localhost:4000"; npm run dev`.)

### 4.4 Starting over

Every backend's data lives in a plain `data/` folder inside its own
directory, gitignored and safe to delete:
```bash
rm -rf backend/data homemedia-backend/data homesync-backend/data
```

## 5. Backups, and getting to it from outside your home

The backup service (Docker path only) snapshots the whole data volume to
`backups/` on the host once a day, keeping 14 days by default
(`BACKUP_RETENTION_DAYS`). **This only protects you from in-app mistakes**
(an accidental permanent delete) — it does not protect you from the
whole machine failing, since the backup lives on the same disk. Copy
`backups/` somewhere else periodically (external drive, another machine,
cloud sync) for that.

**Restoring:**
```bash
docker compose down
docker run --rm -v homecloud_homecloud_data:/data -v ./backups:/backups alpine \
  sh -c "rm -rf /data/* && tar xzf /backups/<file>.tar.gz -C /data"
docker compose up
```
Test this occasionally — an untested backup isn't one you can count on.

**Reaching it away from home:** the simplest safe option is a private
mesh network like [Tailscale](https://tailscale.com/) (free for personal
use) — no port-forwarding, nothing exposed to the public internet. Set
this up before considering any form of remote access, and definitely
before HomeVault (see `SECURITY.md`) is ever exposed this way.

## 6. Troubleshooting

- **Frontend loads but login fails:** almost always CORS or a wrong
  address. Docker handles this via nginx; in dev mode check
  `CORS_ORIGIN` (§4.2).
- **"It worked yesterday, now the address doesn't work":** the server's
  LAN IP likely changed (DHCP renewal). Set a static/reserved IP, or
  switch to Tailscale addresses.
- **`better-sqlite3` install errors on Windows:** see §1.2's Python/Build
  Tools note.
- **Phone can't reach the server:** confirm both are on the same network
  (or both on Tailscale), and that you're using the gateway's port
  (`8080`), not an old per-service port.
