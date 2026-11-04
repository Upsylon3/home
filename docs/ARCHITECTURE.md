# Architecture

## 1. The vision

A self-hosted family/personal environment with shared identity and a consistent
interface. Core operation has no mandatory third-party cloud dependency.
See the [product contract](../HOME_MASTER_SPECIFICATION.md).

## 2. Product principles

Users own accounts, data and configuration. Apps are modular, authorize requests
in their backends and remain usable when optional integrations are absent.
Keep infrastructure appropriate to a small project.

## 3. HomeCore

`homecore/` owns users, roles, sessions, 2FA, preferences, the app/permission
catalog, activity and notifications. Other backends verify user identity through
`packages/homecore-client`. HomeCloud owns files/folders/shares, not Core.

Each service owns a separate SQLite database and process. Files live in
HomeCloud's upload directory; a database alone is not the complete storage.

## 4. The three-tier layering rule

| Tier | Responsibility |
|---|---|
| 0: Core and gateway | Identity, registry and common entry point |
| 1: Applications | Own process/database; public APIs for declared hard dependencies |
| 2: HomeBridge | Optional cross-app search and consented automation |

Tier 1 rules:

- Call Core APIs; never open a sibling database.
- Declare at most one hard dependency on another app's stable public API.
  Media, Sync and Notes depend on Cloud storage; Vault, Tasks and Monitor do not.
- Do not detect optional sibling apps or add enhancement behavior to them.
  Optional interactions belong in Bridge.
- Events may be emitted without making the primary action depend on delivery.
- Apps remain functional with optional apps/Bridge stopped, subject to declared
  hard dependencies.

Bridge search forwards the current user's token to fixed configured Notes/Tasks
APIs. It stores no search query/index or browser session. Optional Monitor-to-Tasks
automation uses explicit owner consent, separate scoped Core capabilities and
encrypted operational state. Core and the target apps remain the authority.
See [search](decisions/001-homebridge-search.md) and
[automation](decisions/002-scheduled-monitor-followup.md) for those contracts.

## 5. The gateway

nginx exposes the entry point and routes apps under one origin. Frontends share
`home_session_token` through `design/session.js`; this is a bearer token in
localStorage, not a cookie or a separate login per app. The shared origin is
also a shared XSS boundary.

| Path | Destination |
|---|---|
| `/` | Home dashboard |
| `/cloud/`, `/media/`, `/notes/`, `/tasks/`, `/monitor/`, `/vault/` | App frontends |
| `/sync/` | Sync information page; Android is the client |
| `/api/homecloud/`, `/api/homemedia/`, `/api/homenotes/`, `/api/homesync/`, `/api/homevault/`, `/api/hometasks/`, `/api/homemonitor/` | Corresponding backend |
| `/api/homebridge/` | Optional Bridge, or an unavailable response |
| `/api/share/` | Public Cloud share-token routes |
| `/api/core/` and remaining `/api/` | Core, including compatible legacy aliases |

Specific API routes precede Core's catch-all. Missing upstreams produce bounded
unavailable responses; nginx resolves app names dynamically so it can start
without every app. Streaming upload/media paths disable buffering as configured.

The gateway sets the shared CSP; only Vault's prefix permits WASM compilation.
Optional Caddy terminates public HTTPS. Raw port 8080 is HTTP and must not be
forwarded to the internet. Details: [deployment](DEPLOYMENT.md) and
[security](SECURITY.md).

## 6. Deliberate constraints and gaps

- Registry entries are pre-seeded; there is no complete app installation flow.
- Manifest permissions are declarative for normal browser sessions. Separate
  action/audience checks for background capabilities do not solve that gap.
- Cloud data is owner-only. Public share links do not implement shared folders
  or general household ACLs.
- Account disable is the supported lifecycle; there is no cross-service account
  deletion flow.
- Shared internal secrets are operator-managed. Keep service ports private.
- Vault's bounded administrator reset calls Vault's API; Core supplies live
  authority, while deletion/audit remain in Vault's own database.
- Backups are per-database consistent, not coordinated cross-service snapshots.
  Off-machine copying and real restore drills still matter.
- Runtime bundles contain prebuilt services and built web UIs, with persistent
  host folders and one-time registration codes. They default to loopback access.
  The public portal remembers addresses only; it is not an identity provider.
  Upgrades/import and multi-server trust remain unfinished.

Use [API.md](API.md) for contracts, [DEPLOYMENT.md](DEPLOYMENT.md) for operations
and [ROADMAP.md](ROADMAP.md) for remaining work.
