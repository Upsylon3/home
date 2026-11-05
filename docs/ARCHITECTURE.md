# Architecture

## 1. The vision

A self-hosted family/personal environment with shared identity and a consistent
interface. Core operation has no mandatory third-party cloud dependency.
See the [product contract](#product-contract).

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
See [search](#cross-app-search) and
[automation](SECURITY.md#automation-contract) for those contracts.

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

- Bundled applications use an explicit catalog/install/enable lifecycle. Core
  manages registry availability, not package downloads or container processes.
- Manifest permissions are declarative for normal browser sessions. Separate
  owner-consented application keys enforce declared file-permission subsets at
  Cloud routes; they never become general sessions. Shared-origin browser apps
  remain trusted peers. Hosting untrusted browser code would require a separate
  origin/identity design; an app-name header cannot establish that boundary.
- Cloud data is owner-only. Public share links do not implement shared folders
  or general household ACLs.
- Account disable is the supported lifecycle; there is no cross-service account
  deletion flow.
- Shared internal secrets are operator-managed. Keep service ports private.
- Vault's bounded administrator reset calls Vault's API; Core supplies live
  authority, while deletion/audit remain in Vault's own database.
- Daily backups are per-database consistent. Managed installations also offer
  manual coordinated snapshots with every project container stopped throughout
  capture and verification; configuration requires its own protected backup.
  Manual verified exports copy published archives to operator-mounted storage;
  they do not include configuration or establish physical off-machine placement.
  Real off-machine copying and restore drills still matter.
- Runtime bundles contain prebuilt services and built web UIs, with persistent
  host folders and one-time registration codes. They default to loopback access.
  The public portal remembers addresses only; it is not an identity provider.
  Bundle upgrades and standard source imports retain an offline recovery copy.
  Imports preserve Core identity and settings, then start locally. Multi-server
  trust remains unfinished.

Use [API.md](API.md) for contracts, [DEPLOYMENT.md](DEPLOYMENT.md) for operations
and [ROADMAP.md](ROADMAP.md) for remaining work.

### Bundled application lifecycle

Fresh Core databases start with an empty installed list and a trusted seven-app
catalog. An administrator installs a catalog manifest, which creates a disabled
registration with declared routes, permissions and hard dependencies. Enablement
is a separate action. Dependencies must be installed before installation and
enabled before enablement; active dependants block disabling their foundation.
HomeCloud retains its existing protected status and cannot be uninstalled.

The additive `installed` column adopts existing registrations in place, including
disabled/custom entries, without changing IDs, routes, permissions or history.
Startup seeds permissions only; it does not reinstall removed apps or overwrite
registration metadata. Uninstall hides a registration and disables it while
retaining the row, all application data and historical references. Related
automation grants are revoked with audits in the same transaction. Reinstall
reuses the ID and requires a fresh enable action; revoked consent stays revoked.

The distribution already contains these services. Installation does not fetch
remote manifests, run arbitrary code, start/stop Docker or change backend access
rules. Direct URLs/APIs retain their existing identity/role/ownership checks;
registry availability is not application isolation. Legacy explicit administrator
metadata registration/re-registration remains compatible, including its default
enabled state. New clients use the catalog's two-step flow. This is a bundled-app
lifecycle, not a third-party package marketplace.

## Product contract

HOME is a private personal/family environment. The user owns the hardware,
accounts, files and configuration. Local operation must work without internet
access, third-party identity or a project-operated directory/relay. Remote access,
external providers and integrations are optional.

- Preserve existing accounts, files, sessions and public APIs during compatible
  changes. Migrations should be additive and reversible.
- Apps declare identity, routes, health, permissions and hard dependencies.
  Installation/enablement is explicit; uninstall must not silently delete data.
- Each service owns its schema. Small structured records stay in the owning
  service; file bytes and file metadata belong to Cloud's public storage API.
- Core owns identity, sessions, roles, preferences, registry, activity and
  notifications. Use canonical `/api/core/` routes and preserve compatible aliases.
- Validate inputs, ownership, quotas and authorization in backends. Registry
  declarations alone are not authorization. New external application consumers
  must use owner-consented scoped keys, never the user's full browser session.
  Add further route/audience permissions only for a concrete consumer; unsupported
  key permissions and session-only routes fail closed.
- Failed activity/event delivery must not undo a successful primary operation.
  Optional cross-app reactions belong in Bridge.
- Vault encrypts titles/content in the browser, never gives usable keys to the
  backend and requires independent review before real secrets. HomeAI must never
  receive decrypted Vault data.
- New functionality needs loading, empty, error and unavailable states,
  keyboard/mobile access, health, backup and migration considerations.
- Use bounded logs/request identifiers and the existing API error contracts;
  never log credentials, raw tokens, Vault plaintext or sensitive file content.

| Application | Contract |
|---|---|
| Home | Shared dashboard, navigation and notification bell |
| Cloud | Owned files/folders/shares; storage API for other apps |
| Media | Browse Cloud files without a second file store |
| Notes | Markdown workspace with sanitized rendering and Cloud attachments |
| Sync | Android media backup with durable queue/retry/dedup and explicit permissions; retain whole-file retry and WorkManager battery constraints |
| Tasks | Personal projects, dates, priorities, repetition and optional reminders; assignment needs a sharing model |
| Monitor | Admin-only, read-only health/storage/backup information; no Docker socket |
| Bridge | Optional cross-app search and explicitly consented automation |
| AI (future) | Optional consumer of authorized data; no bypass of ownership or Vault access |

This guide replaces `HOME_MASTER_SPECIFICATION.md` (product contract),
`HOME_ARTISTIC_DIRECTION.md` and `DESIGN_SYSTEM.md` (design). Historical section
numbers in source comments identify their original rationale, not current headings.
Development, CI and release guides have moved into `CONTRIBUTING.md`.
Current endpoint contracts are in [API.md](API.md).

## Cross-app search

Home's Search submits explicitly to optional Bridge. Bridge verifies the live
user and enabled-source registry, then forwards the same bearer token to fixed,
operator-configured Notes/Tasks origins; source APIs enforce ownership. Never
trust registry URLs as proxy targets or follow upstream redirects. Vault is excluded.

Queries are 2–200 trimmed characters, sent in a POST rather than a URL.
Registry/source reads have five-second deadlines and 1 MiB response limits;
return at most 20 results per source with a limit notice. Keep query text,
upstream bodies and credentials out of logs; responses use `Cache-Control: no-store`.
There is no persistent index, result cache or browser-token storage.

Show partial/unavailable/limited results distinctly from an empty success.
Disabled sources are not contacted; registry failure fails closed. Retry is
explicit. Search-only operation needs no database or automation credentials.

## Design

HOME uses warm Atari-era materials with modern, accessible layouts. Keep daily
work calm and readable. The room metaphor gives each application a familiar purpose.

### Source of truth

Edit shared assets in `design/`, then run `design/sync-assets.sh`. Do not edit
the generated copies under apps.

| Source | Purpose |
|---|---|
| `tokens.css` | Colors, fonts, radii, depth and retro overrides |
| `components.css` | Buttons, panels, controls, storage gauges and shared states |
| `retro.js` / `RetroControl.jsx` | Off/Subtle/Full preference, shared through `home-retro` |
| `session.js` | Shared session-token handling |
| `icons/` / `AppIcon.jsx` / `Wordmark.jsx` | Canonical app marks and wordmark |
| `make-favicons.mjs` | Generated browser/PWA icons and Android adaptive foreground |

When an icon or brand color changes, run `node design/make-favicons.mjs`,
then sync assets. Commit the generated outputs. When adding an app, register
it with the sync/icon tools and reuse existing components.

CSS load order: tokens, app layout styles, shared components. Override supported
variables instead of forking shared files.

### Colors and type

Use named tokens, not copied hex values. Dark surfaces are warm brown-black;
light surfaces are cream/paper. Higher dark surfaces get lighter; raised light
surfaces get slightly darker.

| Token | Use |
|---|---|
| `--bg`, `--panel`, `--panel-raised` | Surface hierarchy |
| `--text`, `--text-dim` | Primary/secondary text |
| `--amber`, `--amber-dim` | Accent and attention |
| `--teal` | Healthy/informational |
| `--red` | Danger/error |
| `--on-accent` | Text on accent surfaces |

Vault stays restrained. Never copy another company’s branding.

Headings use Fredoka, reading text Inter, labels/numbers IBM Plex Mono.
Bundle fonts locally through `@fontsource`; no external font CDN.

### Retro intensity

| Mode | Behavior |
|---|---|
| Off | Warm palette/type; remove decorative stripes, wood, frames, raised effects and scanlines |
| Subtle (default) | Restrained stripes, hard button depth, cartridge folders, print frames and ruled notes |
| Full | Stronger depth/stripes and dark scanlines, still without glow |

New decoration needs an Off behavior. Do not add Full-only intensity to Subtle.
Use woodgrain on at most one hero surface per screen, currently the dashboard
and Tasks Today header. Forms and working lists stay quiet.

### Application character

- Home: entrance/dashboard, wood header and app controls.
- Cloud: archive, cartridge folders and clear file rows.
- Media: gallery, print frames and albums.
- Notes: study, restrained ruled-paper treatment.
- Tasks: desk, clear due/overdue/priority words and Today header.
- Monitor/Sync: quiet utility/status interfaces.
- Vault: restrained safe, thin brass details rather than loud decoration.

### Interaction and accessibility

- Familiar controls, consistent placement and clear wording.
- Visible keyboard focus, labels, adequate contrast and usable touch targets.
- Never communicate status only through color; write overdue/error states.
- Respect reduced motion. Motion communicates state; sound is off by default.
- Show actionable loading, empty, error and unavailable states.
- Check actual narrow layouts and Android interaction separately.
- No neon, blurred glow, decorative animation spam or copied trademarks.

### Icons and Android

Use the shared simple geometric icon family and common frame. Generate
favicons/adaptive foregrounds from those sources; keep the Android adaptive
mark in its safe zone. Native Android uses the shared palette and recognizable
actions while following platform navigation/permission conventions.
