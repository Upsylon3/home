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
The backup image includes Python 3 for its standard-library SQLite backup API;
no Python packages, application credentials or Docker socket are required.

Each root-level `*.db` is copied through SQLite's online backup API inside a
read transaction. Committed WAL data is included; live database files and
their `-wal`, `-shm` and `-journal` sidecars are never copied into the archive.
Other regular files and directories retain their paths, including hidden
files. A database uploaded inside HomeCloud's `uploads/` is ordinary content.
Empty/uninitialized volumes, corrupt databases and symlinks fail closed.

Each archive is written to a unique `.partial.*` file. Before publication,
the helper restores every archived database into temporary storage and runs
`PRAGMA integrity_check`. It also checks the presence and recorded size of
every HomeCloud upload (including trash), plus referenced thumbnails. The
compressed archive is then read through and published without replacing an
existing archive. Retention runs **only for a source whose new archive was
successfully published**.
Creation, validation or publication failures preserve that source's previous
backups regardless of age, and other sources still run. A retention failure
is reported as a failed cycle; the daemon retries on its next interval.

For a single cycle with an exit status (zero only if every source succeeds):

```bash
docker compose run --rm backup --once
```

`BACKUP_TIMEOUT_SECONDS` bounds snapshot creation and restore verification per
source (default 3600 seconds, followed by up to 10 seconds of termination
grace). Increase it for large upload volumes or slow disks. Temporary database
copies use backup storage, with roughly one extra database copy per source;
large uploads are streamed without a second on-disk copy. A read transaction
can delay WAL checkpointing, so leave free space on both source and backup
disks. An interruption may leave `.partial.*` or `.snapshot-*` scratch files;
these are never published archives. Remove abandoned scratch files only when
no backup process is running.

**Consistency boundary:** each SQLite database is transaction-consistent, but
separate services are not captured at one shared point in time. Concurrent
HomeCloud permanent deletion can make a cycle fail rather than publish a
backup with a missing referenced file; retry when deletion has finished.
Checks verify SQLite structure and upload presence/size, not historical file
content authenticity or all cross-service references. Media thumbnails are
regenerable cache files. A WAL database on a read-only mount requires readable
existing WAL/shared-memory sidecars; an offline database without them may
fail until the app is running again. The helper never bypasses SQLite locking
with `immutable=1` or grants source write access to work around this.

For a coordinated offline archive, stop all application writers first and
verify restoration into disposable volumes before relying on it. Never test
a restore over your only copy of real data. To repeat structural verification
of an existing archive (scratch space is needed beside the archive):

```bash
docker compose run --rm --entrypoint python3 backup \
  /snapshot.py --verify /backups/<file>.tar.gz
```

This verifier expects the new standalone-database format. Older raw archives
containing SQLite sidecars require a separate offline restore drill.

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

**Core restore exception:** when restoring `home_homecore_data`, do not run the
last `up` command until restored delegations have been revoked. Keep Core,
HomeBridge, the gateway and application traffic offline. With the current Core
image built, run this one-off process against the restored volume:

```bash
docker compose run --rm --no-deps --entrypoint node homecore \
  scripts/revoke-restored-delegations.js \
  --database /data/homecore.db --confirm-offline-restore
```

It must exit successfully and print `{"revoked":N}` (including zero for an old
snapshot without delegation tables). On failure keep services offline. This
revokes every restored grant, audits the operation without credentials and
preserves account/app data. Owners must explicitly re-enroll later; never
restore Bridge credentials as a way around this. Then resume with `docker
compose up`. The offline flag acknowledges an operator precondition; the
script cannot detect external traffic or stop services for you.

For a local disposable restore, the equivalent is `node
homecore/scripts/revoke-restored-delegations.js --database <absolute-existing-Core-db>
--confirm-offline-restore`. No default database path or `.env` is loaded, and a
missing file is never created. Ordinary restarts must not run this maintenance.

**Monitor restore exception:** before reopening a restored
`home_homemonitor_data` volume, keep services/traffic offline and run:

```bash
docker compose run --rm --no-deps --entrypoint node homemonitor-backend \
  scripts/reset-restored-identity.js \
  --database /data/homemonitor.db --confirm-offline-restore
```

Require successful exit and `{"reset":true}` before `docker compose up`.
The command rotates the pinned instance UUID and clears evaluation freshness,
preserving alert incidents, history and queued notifications. The worker
must pause and require owner confirmation for this changed source identity;
otherwise an old snapshot could silently regenerate incident identities.
For a pre-feature snapshot, startup creates the first identity. The local
equivalent uses `node apps/homemonitor-backend/scripts/reset-restored-identity.js`
with the same explicit absolute database path and offline flag. It never loads
`.env` or creates a missing database. The flag does not detect/stop traffic.
Do not run it on normal restart.

Tasks backups now include durable automation receipts and daily counts. Restore
them together with the tasks database. An older Tasks snapshot can lose newer
receipts; cross-service exactly-once history is not guaranteed after such a
restore. Keep this limitation visible when planning worker recovery.

Substitute the volume name for whichever app you're restoring
(`home_homecore_data`, `home_homemedia_data`, `home_homenotes_data`,
`home_homesync_data`, `home_homevault_data`, `home_hometasks_data`,
`home_homemonitor_data` — the `home_` prefix comes
from `docker-compose.yml`'s pinned `name: home`). Test this
occasionally — an untested backup isn't one you can count on. For
HomeVault specifically: a restored backup is exactly as readable as it
was the moment it was taken — restoring doesn't bypass encryption, you
still need the master password or recovery key from that point in time.

## Upgrading

### Optional cross-app search

Run `docker compose --profile bridge up --build -d` to include HomeBridge,
then use Home's Search page. Without that profile the rest of HOME runs
normally, and Search explains an unavailable bridge on submission. Users
choose Notes and/or Tasks on each explicit search; disabled apps in HomeCore's
registry are not queried. Stop it with `docker compose stop homebridge`.
Search-only mode retains no data or volume. Remove the profile to opt out
after revoking any separately enabled automation grants. Do not expose service
port 4900; the gateway is its
only public route. See decision 001 for limits and security boundaries.

### Opt-in Monitor follow-up automation

Default `docker-compose.yml` remains search-only. To configure automation,
create a protected **32-byte raw key file outside the repository, data volumes
and backups**, then supply its absolute path. For example, on the operator's
server (choose an appropriate protected external directory first):

```bash
umask 077
openssl rand -out /protected/homebridge-key 32
export HOMEBRIDGE_KEY_PATH=/protected/homebridge-key
docker compose -f docker-compose.yml -f docker-compose.automation.yml \
  --profile bridge up --build -d
```

The override adds `home_homebridge_data`, mounts the pre-existing key file
read-only with host-path creation disabled, and adds the Bridge volume to the
backup service's read-only sources. It adds no key, JWT signing secret or
`HOMECORE_INTERNAL_SECRET` to backups or the worker. No account is enrolled by
configuration alone. In Home Settings, an enabled administrator reviews the
fixed preview and checks explicit consent before Enable/Renew. Core's exact
30-day expiry and rule state remain visible. Never reuse another service's
secret as this key, print it in logs or generate it inside the repository.

Native local configuration uses explicit absolute `HOMEBRIDGE_DATA_DIR` and
`HOMEBRIDGE_KEY_FILE`, plus fixed `HOMEMONITOR_INTERNAL_URL` and
`HOMETASKS_INTERNAL_URL`. The key must be a regular 32-byte file outside the
repository/state directory; missing, invalid or unreadable configuration
leaves automation unavailable while search still starts. A wrong key pauses
existing rules. Preserve the original key separately: losing it can make an
uncertain canonical task payload unrecoverable. Revoke old grants directly in
Core before fresh enrollment; a missing pending payload requires recovery or
manual attention, never a guessed replacement retry.

Back up the Bridge database with its encrypted credential/payload envelopes
and plaintext rule/receipt metadata; it is not whole-file database encryption.
Keep the wrapping key in separate protected key custody, outside every backup
source. Ordinary restarts preserve enabled rules and pending deliveries but
reset incomplete qualification; first worker dispatch is on the next five-minute
timer tick. Leases from an abruptly stopped process expire after 60 seconds.

Before reopening a **restored** Bridge database, stop Bridge and application
traffic and run this one-off maintenance process with the restored volume:

```bash
docker compose -f docker-compose.yml -f docker-compose.automation.yml \
  run --rm --no-deps --entrypoint node homebridge \
  scripts/pause-restored-automation.js \
  --database /data/homebridge.db --confirm-offline-restore
```

Require successful exit and `{"paused":N}` before reopening traffic. Restored
rules remain stopped, retry surrender with the original key and require fresh
owner consent to resume. This prevents restoration from undoing a local Disable
whose Core revocation was pending. Pending canonical payloads and delivered
metadata remain intact. The script never loads `.env` or reads the key and
requires an explicit existing absolute database path; the flag acknowledges
offline operation rather than detecting/stopping traffic. Normal restarts must
not run it. Follow the Core and Monitor restore exceptions above as applicable;
older Tasks restores retain their documented cross-service receipt limitation.

To roll back to search-only, disable every enrolled rule, wait for revocation
to complete (or revoke directly in Core), then restart with only the base
Compose file/profile. Keep the volume/key and receipts until the rollback is
verified. Never drop receipts or delete created tasks as cleanup. A stopped
Bridge leaves every Tier 1 app and Core grant revocation usable.

### Update services

```bash
git pull
docker compose up --build -d
```

Each service migrates its own SQLite schema forward automatically on
startup (see each service's `db.js` — plain `CREATE TABLE IF NOT
EXISTS`/`ALTER TABLE` statements, no separate migration runner). Check
[CHANGELOG.md](../CHANGELOG.md) for anything that needs a manual step.

Core's canonical auth/admin/activity aliases are additive and need no database
migration or client cutover. Existing top-level routes keep working. Deploy the
updated Core before changing any consumer to `/api/core/auth` or
`/api/core/admin`; if later rolling back to a Core version without aliases,
restore those consumers' legacy prefixes first. Current shipped clients remain
on the compatible paths. Activity scopes and known error payloads are unchanged;
see `API.md` for the exact mapping. No alias-removal deadline is introduced.

Core's delegation migration adds two tables without changing existing users
or sessions. Before downgrading Core, revoke grants while the new authority
is available (or use the offline maintenance command with all traffic stopped).
Leave additive tables in place; do not delete audit records or drop tables as
rollback cleanup. No worker is enabled by this foundation update.

Monitor adds incident/state columns, a source-identity row and a notification
outbox. Existing open alerts receive stable IDs and remain unknown until the
next successful evaluation. Tasks adds a receipt table/index without changing
ordinary task rows. Keep these additive records on downgrade. Before using
an older app version that lacks capability actions, revoke grants and pause
consumers; normal browser operations remain available. An older Monitor cannot
maintain incident freshness or the outbox, so do not run a scheduled consumer
against it. This update still enables no scheduler or enrollment UI.

HomeVault's Trash upgrade adds only a nullable `deleted_at` column. Existing
items stay active and their ciphertext, IVs and key envelopes are unchanged.
Trash is included in normal encrypted database backups. Before downgrading to
a version without Trash support, restore or permanently delete each trashed
item using the new version: the old backend ignores `deleted_at` and would
show those items as active again. Do not drop the column to roll back.

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
