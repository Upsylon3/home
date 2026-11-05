# Deployment

For a downloaded runtime, use [START-HERE](../server/START-HERE.md). The commands
below describe the source-based Compose installation. Do not mix their
configuration/data layouts or assume automatic migration.

## Runtime bundles

Downloaded runtimes include built UIs, prebuilt Linux container images and launchers
for Linux x64/arm64, Windows x64 and macOS Intel/Apple silicon. Docker is a
prerequisite, not silently installed. Images permit offline start on an already
Docker-equipped machine. Launchers do not silently change firewall/router or
OS-startup settings. Use [START-HERE](../server/START-HERE.md).

Persistent host data/backups/configuration are separate from images. Setup
generates distinct credentials and a stable installation UUID, which is an
operational identifier rather than proof of server identity. Repeated starts
preserve data; unknown pre-existing data or partial configuration fail closed.
Bundle-to-bundle upgrades use an offline verified copy into a fresh sibling
folder: run the new bundle's `upgrade OLD-FOLDER` action. Its release manifest
declares the minimum compatible source version; releases must validate that
compatibility before widening it. The source is mounted read-only and retained
for recovery. An upgrade journal blocks startup during partial publication;
retries resume safely and completed transfers never replay old data over writes.
This trades disk space/downtime for an intact recovery source. It is a continuous
stopped cutover, not permission to roll back to an older snapshot afterward.
Use the restore/revocation steps below for that case. Source Compose imports use the new bundle's `import SOURCE-FOLDER` action.
The importer resolves the complete standard Compose topology privately, checks
effective container settings and named-volume ownership, stops all source writers,
and presents those volumes read-only to the verified-copy engine. Credentials
and per-service settings are retained in protected configuration; the imported
installation starts on loopback and gets an operational UUID without changing
Core account IDs. Source settings remain required during subsequent bundle upgrades.
Original volumes stay offline for recovery, not routine parallel use. Partial
stacks, custom overrides/external volumes, unusual service-secret encodings and
automatic downgrades remain unsupported.

Managed Core requires a one-use 128-bit setup code expiring in 15 minutes.
Only its SHA-256 hash is retained; consumption and account creation are atomic
on both auth aliases, with consumed hashes retained. Claim the first owner on the
server itself or an authenticated encrypted connection. An IP address is not
proof of ownership. Issue a separate server code for each additional member.

Local-only loopback HTTP is the default. LAN HTTP requires explicit acknowledgement;
public mode requires an existing owner, keeps raw HTTP on loopback and uses a
user-controlled hostname. Changing modes stops an existing TLS listener first.
The launcher cannot establish router reachability, CGNAT avoidance or certificate
issuance; test outside the house. Direct bare-IP certificate automation is deferred.
Managed bundles provide a read-only `diagnose` action for A/AAAA DNS records,
private/shared address warnings and local TLS certificate verification. It uses
bounded probes without credentials or an external public-IP service. A passing
check does not prove outside reachability; see START-HERE for router/IPv6 checks.

The public `/connect/` portal stores names/origins only in that browser, never
fetches server APIs or handles credentials/setup codes, and opens HOME without
a referrer. Clearing its storage removes shortcuts, not accounts. GitHub may
retain ordinary hosting visit logs. Multiple saved addresses provide no shared
identity: signed multi-server trust, revocation/recovery and replication are
separate future designs. Replication is not backup.

## Requirements and first-time setup

Install Docker with Compose and keep enough disk space for uploads and backups.
Copy `homecore/.env.example` to `homecore/.env`, set distinct random JWT/internal
secrets and retain the documented ports/data paths. Compose shares the internal
secret with the services that need it.

~~~bash
docker compose up --build -d
~~~

Open `http://localhost:8080`. In this source configuration, the first registered
account becomes admin; claim it locally before exposing the installation.
Managed bundles instead require their one-time setup code. Keep the Compose
project name/volumes stable: changing them can make existing data appear absent.
`docker compose down` retains volumes; adding `-v` deletes them. Set storage
quota/retention in the relevant service configuration.

## Reaching it from other devices

For a trusted LAN, use the server's local IP with port 8080 and allow that port
only on the private network. Reserve the local IP in the router. This is
unencrypted HTTP; it is not a safe public or real-secret Vault connection.

For private remote access, an optional private network/VPN avoids publishing
the login. It is not required for local HOME operation.

## A permanent address from anywhere

Public browser access is an explicit alternative:

1. Point a hostname at the connection's public IP. Configure dynamic DNS updates
   if that IP changes.
2. Forward TCP 80/443 to the server and allow them in the host firewall.
   **Never forward raw port 8080.** CGNAT/provider filtering can prevent direct access.
3. Set `HOME_DOMAIN=your-hostname` in a root `.env` file.
4. Run `docker compose --profile public up -d`.

Caddy obtains/renews the HTTPS certificate when DNS and reachability work.
Test from outside the LAN, for example mobile data. A local success does not
prove public access. Public exposure increases attack surface; use strong
passwords and 2FA. Vault still needs independent review before real secrets.

## Application availability

After creating the owner account, open **Applications** in Home. Fresh servers
start with no apps installed in the launcher. Install HomeCloud before Media,
Notes or Sync; enable HomeCloud before enabling those dependants. Other bundled
apps can be installed independently. Installation first adds a disabled app;
enable it explicitly when ready. Existing registrations and disabled choices
survive upgrades unchanged.

Uninstall removes an app from Home and revokes its automation grants, preserving
its files, settings and history. Reinstall does not restore revoked consent.
HomeCloud remains the protected storage foundation. These controls manage the
bundled app registry: services remain deployed, and saved direct URLs/APIs keep
their normal authentication/ownership rules. Core has no Docker socket, package
download or remote-manifest fetch capability. No third-party app installer is
introduced. Explicit metadata registration/re-registration remains compatible
through the legacy administrator API, including its default enabled state.

Deploy the new Core before the new Home frontend. The migration only adds an
installed flag; it neither deletes app rows nor touches sibling databases. Older
Core binaries ignore this flag and can show uninstalled entries as disabled, so
do not rely on newer lifecycle visibility while running an older Core.

## Application access deployment

Deploy Core and the shared-client/Cloud backend before exposing the new Home
Settings application-access controls. Core adds only `hc_application_access`;
existing accounts, sessions and files are unchanged. There are no pre-created
keys, service-secret settings or default grants. Users explicitly choose an
enabled registered app and file permissions in Settings, then privately deliver
the one-time key to that app. Never substitute their full session token.
Unsupported/older APIs fail closed; the UI exposes an unavailable/retry state.
Rolling back Core/Cloud makes the opaque keys unusable while normal sessions
remain compatible. Preserve the additive table when rolling back.

Keys belong in private consumer configuration, never URLs/logs/repositories.
The existing offline `revoke-restored-delegations.js` maintenance now also revokes
application keys atomically, and its `{revoked:N}` counts both credential classes.
Run it on every Core restore before serving traffic; normal restarts do not
revoke keys. Existing pre-feature databases remain supported by that script.

## Backups

The backup service writes per-app archives to `backups/` daily, retaining
14 days by default. Compose sets `BACKUP_INTERVAL_SECONDS`,
`BACKUP_RETENTION_DAYS` and `BACKUP_TIMEOUT_SECONDS` (one hour per source by
default); increase the timeout for large/slow installations.

- SQLite online snapshots include committed WAL data; raw database sidecars are
  not archived. Ordinary files retain their paths.
- Archives are restore-checked with SQLite integrity checks and Cloud upload/
  thumbnail presence/size checks before publication. Failures preserve previous
  backups; retention runs only after that source publishes successfully.
- Empty/corrupt sources or symlinks fail closed. Read-only WAL snapshots need
  their readable existing sidecars; do not bypass locking or grant source writes.
- Per-database consistency is not a shared cross-service point in time or proof
  of historical file authenticity. Use the explicit offline snapshot action below
  for a complete set from one shared interval.
- Leave scratch/free disk space; snapshot verification is timeout-bounded.
  Only remove abandoned partial/snapshot scratch files while backup is stopped.
- Copy protected backups off-machine. A second copy on the same disk does not
  protect against disk or machine failure.

~~~bash
docker compose run --rm backup --once
docker compose run --rm --entrypoint python3 backup \
  /snapshot.py --verify /backups/<file>.tar.gz
~~~

The verifier expects the current standalone-database format; older raw archives
with SQLite sidecars need a separate offline restore drill. Restore into a
fresh disposable target first, keep the original volumes, and never test over
the only copy of real data. Restore all related services consistently and apply
the following offline credential maintenance before resuming traffic.

### Verified exports to mounted storage

The export tool copies all published archives into a new immutable-by-convention
export folder with a versioned inventory and SHA-256 checksums. It rereads each
copy, validates the compressed stream and reuses SQLite/Cloud restore checks.
It publishes only after all selected archives pass and never prunes destination
history. Failed copies preserve older exports. Partial/unrecognized filenames
are ignored; corrupt or legacy-format published archives fail the export.

Managed bundles expose `export-backups DESTINATION` and `verify-backups EXPORT-FOLDER`;
see [START-HERE](../server/START-HERE.md#export-archives-to-separate-storage).
For a source checkout with Python 3.11+:

~~~bash
python3 services/backup/export.py ./backups /mnt/backup-nas/HOME
python3 services/backup/export.py --verify /mnt/backup-nas/HOME/home-backup-export-...
~~~

Use an existing private destination on storage you control. Paths must be
separate and non-nested. The operator mounts/authenticates the share or drive;
HOME has no remote-storage credentials, provider integration or transfer schedule.
Bundle exports run with networking disabled and mount published backups read-only.
Docker must be able to access the host destination. The tool cannot establish
that a path is physically off-machine, still mounted, encrypted or durable.
Keep enough space for all retained archives plus restore scratch. Verification
checks integrity, not adversarial authenticity or physical disaster recovery.

This exports history already present, not a fresh/coordinated snapshot or proof
of service coverage/freshness. Configuration/credentials/certificates are excluded
and still need a separate protected backup. Ordinary app data is not encrypted
by the exporter. Real off-machine storage and restore drills remain operator
validation; follow the offline restore requirements below before reopening traffic.

### Coordinated offline snapshots

Managed bundles expose `snapshot DESTINATION` and `recover-snapshot`; see
[the operator workflow](../server/START-HERE.md#create-a-coordinated-snapshot).
The host launcher records the original running container IDs in a private
recovery marker, stops every project container (including optional services),
rejects remaining overlapping writable mounts, then captures all eight read-only
sources with networking disabled and no Docker socket. Restart uses those original
IDs only. Normal launcher/configuration/upgrade actions refuse pending recovery.
Readiness failure leaves the marker; explicit recovery validates identities,
Compose layout and mounts, and refuses an active capture worker or new writers.

Capture requires every canonical database, checks complete source fingerprints
before/after, validates archives and Cloud file references, and atomically renames
one new set only after all eight pass. Stopped SQLite databases and their WAL/
rollback journals are copied into private writable scratch for recovery before
the existing standalone snapshotter reads them; original sources stay read-only.
Failure preserves earlier sets. The manifest
uses schema 1, `consistency: coordinated-offline`, `quiescedAt`, `createdAt`, a
source fingerprint and each archive's size/SHA-256. `verify-backups` (or
`export.py --verify SET-FOLDER`) rejects incomplete sets, altered files and invalid
intervals. These checks establish integrity under the offline precondition,
not adversarial authenticity or a filesystem-wide writer lock. Do not use other
lifecycle tools/external writers during capture. Existing cross-app inconsistencies
are preserved, not repaired. Downtime covers all capture/verification; the host
`BACKUP_TIMEOUT_SECONDS` defaults to 3600 (allowed 1–86400 for the entire set).

Source-checkout operators must establish the same offline barrier themselves;
the Python helper cannot stop containers. With all project and external writers
stopped, existing containers retained and a private `backups/` destination:

~~~bash
docker compose --profile '*' stop
docker compose run --rm --no-deps --entrypoint python3 backup \
  /coordinated.py /sources /backups --confirm-offline
~~~

Resume only services that were previously running, after the command exits.
`--confirm-offline` acknowledges this operator precondition. Use the managed
launcher for automatic identity/barrier checks and interrupted recovery. New sets
are not included in `export-backups`, which copies only existing per-service
archive history. No configuration, service credentials or certificates are in a
set; protect those separately. No automatic destination retention is applied.
Restore all eight archives from the same verified set into an offline disposable
target before relying on them, keeping the original data. Apply the following
Core/Monitor maintenance before serving traffic. Never mix archive generations
or run two copies of an installation. Physical storage/recovery validation remains
open in [validation](VALIDATION.md#backup-exports).

**Core restore exception:** when restoring `home_homecore_data`, do not restart
services until restored delegations have been revoked. Keep Core,
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

## Optional integrations

### Optional cross-app search

Run `docker compose --profile bridge up --build -d` to include HomeBridge,
then use Home's Search page. Without that profile the rest of HOME runs
normally, and Search explains an unavailable bridge on submission. Users
choose Notes and/or Tasks on each explicit search; disabled apps in HomeCore's
registry are not queried. Stop it with `docker compose stop homebridge`.
Search-only mode retains no data or volume. Remove the profile to opt out
after revoking any separately enabled automation grants. Do not expose service
port 4900; the gateway is its
only public route. See [search boundaries](ARCHITECTURE.md#cross-app-search).

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

## Optional HomeTasks reminders

By default Tasks remains fully usable without reminders. To opt into personal
in-app reminders (see the security guide), prepare one external **raw 32-byte** random
file readable only by the operator and the Core/Tasks containers. Use a new
absolute path outside this checkout, application data and backup directories;
never reuse the general internal secret or a Bridge/Vault key. For example,
after creating a protected external directory, generate without overwriting:

```sh
node -e 'require("node:fs").writeFileSync(process.argv[1], require("node:crypto").randomBytes(32), {flag:"wx",mode:0o600})' /absolute/private/hometasks-reminder-key
export HOMETASKS_REMINDER_KEY_PATH=/absolute/private/hometasks-reminder-key
docker compose -f docker-compose.yml -f docker-compose.reminders.yml up -d --build
```

The override mounts that file read-only only in Core and Tasks, at
`HOMETASKS_REMINDER_KEY_FILE`; missing paths are not auto-created. Use the same
Compose files and external path on subsequent operations (include the Bridge
override/profile too if already enabled). Rotate by replacing the external
file and restarting both Core and Tasks. Disabling removes the override/env
and recreates both containers; pending schedules remain but do not deliver.

Create a task, edit **Remind me**, choose local date/time and save. One reminder
belongs to that occurrence; completing clears it and the next repeat has none.
Core stores a fixed HomeTasks notification with only its title and task link.
Home refreshes the bell while visible; the browser need not be open for the
server to create the notification. This release provides no email/web push.
A 30-second worker processes at most 20 due reminders per tick, retries ordinary
failures after one minute and quotas after one hour, and can deliver late after
downtime. A further visible-bell refresh can take 30 seconds. Disabled users
or a disabled app are suppressed and need a newly scheduled time to try again.

Backups include the additive Tasks reminder columns and Core delivery receipts,
but must not include the external key. Protect the key separately. Restore
Core and Tasks consistently; unmatched restore points can lose notices or
replay history. Downgrading binaries leaves the additive schema intact and
stops reminder delivery. Notifications already sent cannot be recalled.
