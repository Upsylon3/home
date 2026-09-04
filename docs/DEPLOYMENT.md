# Deployment

## Requirements

One always-on machine (a home server, NAS, or small VPS) running
[Docker](https://www.docker.com/) with Compose. Nothing else needs to be
installed there — every service runs in its own container.

## First-time setup

```bash
git clone <this-repo> && cd home

cp homecore/.env.example homecore/.env
cp apps/homecloud-backend/.env.example apps/homecloud-backend/.env
```

Edit both `.env` files:
- Set `JWT_SECRET` (in `homecore/.env`) to a long random value:
  `openssl rand -hex 32`
- Set `HOMECORE_INTERNAL_SECRET` to another long random value — **the
  same value in both files**. This is what lets `apps/homecloud-backend`
  authenticate its own calls into HomeCore's event bus and usage-lookup
  endpoint; the two services never share memory, so nothing else keeps
  them in sync.
- Adjust `QUOTA_BYTES` (default 5 GB) and `TRASH_RETENTION_DAYS`
  (default 30) in `apps/homecloud-backend/.env` if you want different
  defaults — set the same `QUOTA_BYTES` value in `homecore/.env` too
  (see that file's comment for why).

```bash
docker compose up --build -d
```

This builds and starts every container: the gateway, `homecore`, all
four frontends, all four independent apps' backends, and the backup
service. Only the gateway publishes a host port (`8080`).

Open `http://localhost:8080` (or `http://<server-ip>:8080` from another
device on the network) and register the first account — it automatically
becomes admin.

Data persists in named Docker volumes. `docker compose down && docker
compose up` keeps it; `docker compose down -v` deletes everything.

## Reaching it from other devices

From a phone or another computer on the same network, use the server's
LAN IP instead of `localhost`:

- macOS/Linux: `ipconfig getifaddr en0` (Wi-Fi) or `hostname -I`
- Windows: `ipconfig` → "IPv4 Address" under the active adapter

Prefer a static/reserved IP for the server in your router settings so it
doesn't change later.

**Reaching it away from home:** the simplest safe option is a private
mesh network like [Tailscale](https://tailscale.com/) — no
port-forwarding, nothing exposed to the public internet. Set this up
before considering any other form of remote access, and definitely
before HomeVault (once built — see `SECURITY.md`) is ever reachable this
way.

**Do not expose port 8080 directly to the public internet.** There is no
TLS anywhere in this stack yet — see [SECURITY.md](SECURITY.md).

## Backups

The `backup` service snapshots every app's data volume to `backups/` on
the host once a day by default (`BACKUP_INTERVAL_SECONDS`,
`BACKUP_RETENTION_DAYS` in `docker-compose.yml`), one `.tar.gz` per app.

**This only protects against in-app mistakes** (an accidental permanent
delete) — it does not protect against the whole machine failing, since
the backup lives on the same disk. Copy `backups/` somewhere else
periodically (external drive, another machine, cloud sync) for that.

**Restoring** one app's data (example: HomeCloud's files):

```bash
docker compose down
docker run --rm \
  -v home_homecloud_backend_data:/data \
  -v ./backups:/backups \
  alpine sh -c "rm -rf /data/* && tar xzf /backups/<file>.tar.gz -C /data"
docker compose up
```

Substitute the volume name for whichever app you're restoring
(`home_homecore_data`, `home_homemedia_data`, `home_homenotes_data`,
`home_homesync_data` — the `home_` prefix comes from `docker-compose.yml`'s
pinned `name: home`). Test this occasionally — an untested backup isn't
one you can count on.

## Upgrading

```bash
git pull
docker compose up --build -d
```

Each service migrates its own SQLite schema forward automatically on
startup (see each service's `db.js` — plain `CREATE TABLE IF NOT
EXISTS`/`ALTER TABLE` statements, no separate migration runner). Check
[CHANGELOG.md](../CHANGELOG.md) for anything that needs a manual step.

## Troubleshooting

- **Frontend loads but login fails:** almost always a wrong address, or
  (in local dev, not Docker) a CORS misconfiguration — see
  `CORS_ORIGIN` in each backend's `.env.example`.
- **"It worked yesterday, now the address doesn't work":** the server's
  LAN IP likely changed (DHCP renewal). Set a static/reserved IP, or
  switch to Tailscale addresses.
- **`better-sqlite3` install errors**, outside Docker on Windows: install
  Python 3 (check "Add to PATH") and Visual Studio Build Tools with the
  "Desktop development with C++" workload, then retry.
- **A container won't start / a route 502s:** `docker compose logs -f
  <service>` — every backend logs a startup line and any unhandled error.
