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
five frontends, all five independent apps' backends, and the backup
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

**Do not expose port 8080 directly to the public internet.** It is plain
HTTP with no TLS. If you need public access, use the HTTPS front door in
"A permanent address from anywhere" below instead.

## A permanent address from anywhere

The LAN IP and Tailscale routes above cover home and private devices. This
section is for the other case: reaching the server from a machine where you
can't install anything (a work PC, say), on a cloud VM such as Oracle's
Always Free tier. It is **opt-in** — nothing here runs unless you start it
— and it is a real step away from "never expose this to the internet", so
read the trade-offs at the end first.

**If an old address "returned nothing", the usual causes are, in order:**

1. **The IP changed.** An *ephemeral* public IP lives only as long as the
   instance's network setup does; if the VM was recreated, or Oracle
   reclaimed the address, the old number now points nowhere. A *reserved*
   public IP is yours until you delete it.
2. **The port was never opened at both layers.** Oracle blocks inbound
   traffic in the cloud network (the subnet's security list, or a network
   security group) **and** Oracle's Ubuntu images ship with their own
   restrictive `iptables` rules on the VM. Opening only one of the two
   still looks like "nothing there".
3. **The work network blocks it.** Many company firewalls allow ordinary
   web traffic on port 443 and drop plain HTTP on odd ports like `8080`
   or to a bare IP. Port 443 with a real name almost always gets through.

**The setup that avoids all three:**

1. **Reserve the IP.** In the Oracle console: Networking → IP management →
   Reserved public IPs → create one, then attach it to the VM's network
   interface (the instance's VNIC → IPv4 addresses → edit → "Reserved
   public IP"). Menu names move around between console versions; what you
   are looking for is the *reserved* kind, not ephemeral. Oracle's
   Always Free limits and charges are theirs to change — check the console
   before relying on it staying free.
2. **Give it a name.** Any domain works; a free DuckDNS name
   (`yourname.duckdns.org`) is the quickest. Point it at the reserved IP.
   Because the IP is now permanent, you set this once and never touch it.
3. **Open ports 80 and 443** (not 8080) in the cloud security list or
   network security group, *and* on the VM itself. On Oracle's Ubuntu
   images that typically means:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
   Port 80 is only for the certificate check and the redirect to https.
4. **Tell Home the name** by creating a file named `.env` next to
   `docker-compose.yml` (it is already git-ignored):
   ```
   HOME_DOMAIN=yourname.duckdns.org
   ```
5. **Start it with the public profile:**
   ```bash
   docker compose --profile public up -d
   ```
   A small Caddy container (`tls`) gets a free Let's Encrypt certificate
   for that name, renews it automatically, and forwards everything to the
   gateway. Open `https://yourname.duckdns.org`.

Keep `8080` closed in the cloud firewall: the gateway is still published on
it for LAN use, and it is plain HTTP.

**The trade-offs, plainly:**

- This puts the login page on the public internet. Login attempts are
  rate-limited per visitor, but use strong passwords and turn on 2FA at
  least for the admin account.
- Every app shares one browser origin, so HomeVault's encrypted data is
  reachable at the same address (its contents stay encrypted; see
  `SECURITY.md`'s "Shared-origin XSS"). If you keep real secrets in
  HomeVault, prefer the private-network route and use this only for the
  rest.
- If the work PC allows installing Tailscale, that is still the safer
  answer and needs none of the above.

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
`home_homesync_data`, `home_homevault_data` — the `home_` prefix comes
from `docker-compose.yml`'s pinned `name: home`). Test this
occasionally — an untested backup isn't one you can count on. For
HomeVault specifically: a restored backup is exactly as readable as it
was the moment it was taken — restoring doesn't bypass encryption, you
still need the master password or recovery key from that point in time.

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
