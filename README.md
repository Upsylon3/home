# Home

Home is a self-hosted personal/family cloud ecosystem. It provides one web
entry point for file storage and related apps, with shared authentication and
separate services where useful.

## Current apps

| App | Status | Purpose |
|---|---|---|
| Home | Built | Dashboard / launcher |
| HomeCloud | Built | Files, folders, sharing, accounts |
| HomeMedia | Built | Photos, videos, albums and metadata |
| HomeSync | Backend built; Android app incomplete | Phone media backup |
| HomeCore | Embedded | Shared identity, permissions, registry and events |
| HomeNotes | Backend/frontend present | Notes app |
| HomeVault | Design only | Planned encrypted password/vault app |
| HomeTasks / HomeMonitor / HomeAI / HomeBridge | Planned | Not implemented |

HomeCore currently runs inside the HomeCloud backend rather than as a separate
service.

## Quick start

### Requirements

- Docker + Docker Compose
- Git, if working from a clone

### Run with Docker

```bash
cp homecore/.env.example homecore/.env
```

Edit `homecore/.env` and set a strong `JWT_SECRET`, then:

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:8080
```

Stop the stack with:

```bash
docker compose down
```

Logs:

```bash
docker compose logs -f
```

### Development

Install all Node dependencies from the repository root:

```bash
npm install
```

Run the available test suites:

```bash
npm test
```

Individual services can also be run from their own directories with the
scripts defined in their `package.json` files.

## Repository layout

```text
home/
├── apps/
│   ├── home/                 # Dashboard
│   ├── homecloud/            # HomeCloud frontend
│   ├── homecloud-backend/   # HomeCloud API
│   ├── homemedia/            # HomeMedia frontend
│   ├── homemedia-backend/   # HomeMedia API
│   ├── homenotes/            # HomeNotes frontend
│   ├── homenotes-backend/   # HomeNotes API
│   └── homesync-backend/    # HomeSync API
├── homecore/                 # Shared platform code
├── packages/                 # Shared client packages
├── gateway/                  # Nginx entry point
├── services/                 # Supporting services such as backups
├── design/                   # Design assets
├── docker-compose.yml
└── docs/
```

## Architecture

The gateway exposes one origin:

| URL | Service |
|---|---|
| `/` | Home |
| `/cloud/` | HomeCloud |
| `/media/` | HomeMedia |
| `/notes/` | HomeNotes |
| `/sync/` | HomeSync info page |
| `/api/` | HomeCloud / HomeCore API |
| `/api/homemedia/` | HomeMedia API |
| `/api/homesync/` | HomeSync API |
| `/api/homenotes/` | HomeNotes API |

Apps keep their own application data. Shared identity and platform functions
belong to HomeCore. Cross-app integrations should use public APIs rather than
reading another service's database directly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the short architecture
reference.

## Authentication and security

The current stack includes:

- bcrypt password hashing
- JWT authentication with token-version revocation
- admin/user roles
- TOTP 2FA and recovery codes
- rate limiting on authentication-related routes
- server-side ownership checks
- soft-delete trash with configurable retention
- expiring/revocable file share links
- security headers
- per-user storage quotas

**Important:** the built-in gateway currently serves HTTP, not TLS. Do not
expose it directly to the public internet. For remote access, put Home behind
a properly configured TLS reverse proxy or a private network such as a VPN.

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation

- [`docs/SETUP.md`](docs/SETUP.md) — installation, configuration and common commands
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and service boundaries
- [`docs/SERVICES.md`](docs/SERVICES.md) — what each app currently does
- [`docs/API.md`](docs/API.md) — API route overview
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — development workflow and repository conventions
- [`docs/TESTING.md`](docs/TESTING.md) — tests and how to run them
- [`docs/SECURITY.md`](docs/SECURITY.md) — implemented security and known limitations
- [`docs/DESIGN.md`](docs/DESIGN.md) — concise UI/design guidelines
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — planned work

## Versioning

The repository currently uses one ecosystem version (`0.8.0`). Until the apps
are independently released, changes are tracked together using SemVer-style
pre-1.0 versions.

See [`CHANGELOG.md`](CHANGELOG.md) for notable changes.

## License

No license has been declared yet.
