# HOME

A self-hosted personal and family cloud. Accounts, files and configuration stay
on your hardware. Local use needs no third-party account or internet connection.

## Get started

1. Download a Windows, Linux or macOS bundle from
   [Releases](https://github.com/Upsylon3/home/releases).
2. Install Docker and extract the bundle where you want its data.
3. Follow [START-HERE](server/START-HERE.md) to start HOME and claim the owner account.

The [public portal](https://upsylon3.github.io/home/connect/) remembers server
addresses in your browser; it does not host accounts. Outside access is optional
and needs network configuration. Automatic bundle upgrades/import are not built.

Try the [browser demo](https://upsylon3.github.io/home/) without a server.
It uses local browser storage and simulated server features: **test data only**.
[Demo details](docs/BROWSER_DEMO.md).

## Applications

| App | Purpose |
|---|---|
| Home | Dashboard and app launcher |
| HomeCloud | Files, folders, share links and Trash |
| HomeMedia | Photos, videos and albums backed by HomeCloud |
| HomeNotes | Markdown notes |
| HomeTasks | Tasks, projects, repeating tasks and optional reminders |
| HomeSync | Android photo/video backup to HomeCloud |
| HomeVault | Client-side-encrypted secrets; independent review still required |
| HomeMonitor | Admin-only service, storage and backup monitoring |
| HomeCore | Shared identity, sessions and app registry |
| HomeBridge | Optional cross-app search and consented automation |

**Do not store real secrets in HomeVault before its independent review.**
HomeSync still needs physical-phone and long-duration validation.
See [security limits](docs/SECURITY.md) and [remaining work](docs/ROADMAP.md).

## Development

Node 26 LTS, npm workspaces, React/Vite, Express/SQLite and Docker Compose/nginx.
The Android client uses Kotlin. Start with [DEVELOPMENT.md](docs/DEVELOPMENT.md).

~~~bash
npm ci
npm test
npm run build --workspaces --if-present
~~~

Source: `homecore/`, `apps/`, `packages/`, `services/`, `gateway/`.
Shared visual assets: `design/`. Runtime packaging: `server/`.

## Documentation

- [Deployment and recovery](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md) and [API reference](docs/API.md)
- [Product principles](HOME_MASTER_SPECIFICATION.md) and [design system](docs/DESIGN_SYSTEM.md)
- [Contributing](CONTRIBUTING.md), [agent rules](AGENTS.md) and [releasing](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)
