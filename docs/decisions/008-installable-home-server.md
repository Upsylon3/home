# 008 — Installable HOME server and optional direct access

## Decision

Ship a complete server runtime, including built web interfaces, rather than
requiring users to build source. Use the existing Compose services and Caddy
public profile. Accounts, data and authority stay on each installation.
No project-operated identity service, directory, relay or paid infrastructure.
Source archives remain available for developers.

The first delivery targets Linux x64/arm64, Windows x64 and macOS Intel/Apple
silicon through Linux containers. Docker is an explicit prerequisite; these
are runtime bundles and launchers, not native executables or OS installers.
Native Linux builders produce each CPU architecture. Images are included so
an already Docker-equipped machine can start HOME offline. Nothing installs
Docker, alters router/firewall rules or changes OS startup settings silently.

## Ownership and configuration

The installation folder contains bind-mounted app data, backups and protected
configuration, separate from versioned images. Initial setup generates distinct
random JWT/internal credentials and a stable installation UUID. The UUID is
an operational identifier, not cryptographic proof of a server's identity.
Repeated starts preserve credentials and files. Unknown pre-existing data or
partial configuration fail closed. Moving/importing existing named volumes and
automated upgrades are not supported by this first installer.

Managed bundles set `HOME_SETUP_REQUIRED=true` on Core. Registration requires
a one-use 128-bit code generated on the server, expiring in 15 minutes. Only
its SHA-256 hash is stored. Consumption is transactional with account creation;
consumed hashes persist in Core's own database. Both API aliases enforce the
same control. A console owner can issue another code for each household member.
Existing source/development installs retain their current registration behavior.
New managed installations expose only loopback HTTP by default: first claim
must occur on the server itself or over an authenticated encrypted connection.
Possession of an IP address is never ownership proof.

## Access

The launcher offers local-only, explicitly acknowledged trusted-LAN HTTP, and
optional public HTTPS via a user-controlled hostname. Public setup requires a
previously created local owner. The launcher stops an existing TLS listener
before changing access; the public mode keeps raw HTTP on loopback.

Users configure DNS, dynamic-IP updates and router/firewall forwarding. A free
dynamic hostname is sufficient; it is an optional external address provider,
not HOME's account authority. The wizard validates input and local setup, but
does not assert public reachability, CGNAT detection or successful certificate
issuance. Mobile-data verification is documented. A private-network provider
is an optional user-configured fallback, not a bundled processor or dependency.
Direct public-IP certificate automation is deferred; the shipped Caddy
hostname route is the supported direct-access configuration.

## Public portal

Publish `/connect/` alongside the existing GitHub Pages demo. It stores only
user-entered names and validated server origins in that browser, and navigates
to the chosen server. It never fetches the server API, asks for HOME credentials,
handles setup codes or stores a global mapping. It sends no referrer when
opening a HOME. Clearing browser storage loses shortcuts, not server accounts.
GitHub's hosting still has its own visit logs; this is not a no-traces promise.

## Acceptance and proof

- Repeat configuration preserves identity, secrets and user files.
- Missing/expired/replayed codes and concurrent ownership claims are refused.
- Managed registration works from Home and Cloud; legacy development works.
- The generated topology uses prebuilt images, persistent host paths and
  loopback-only HTTP unless LAN access is explicitly chosen.
- Disposable Docker CI claims an owner, uploads bytes, restarts services and
  downloads identical bytes using the runtime topology.
- Portal browser proof covers persistence, validation, forgetting and no API
  calls; archives reject installation state and contain launchers/runtime only.
- Release publication waits for validated source and both native architectures.

## Follow-ups and boundaries

The account on an existing HOME is the agreed foundation for later multi-server
trust. This delivery does not implement federation: signed trust establishment,
revocation, issuer outage behavior and recovery need a separate decision and
tests before one server accepts another's accounts. Saving multiple portal
addresses does not imply shared identity. Storage replication, failover and
off-machine versioned backups are also separate; replication alone is not backup.

Cross-platform setup unit checks are not proof of Docker Desktop installation,
host reboots, real home-router forwarding or physical macOS/Windows operation.
HomeVault's independent review remains open.
