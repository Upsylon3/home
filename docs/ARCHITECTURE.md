# Architecture

Home is a self-hosted ecosystem with one gateway, shared platform services,
and separate applications.

```text
Browser / Android
       |
    Gateway
       |
  +----+---------+----------+
  |              |          |
 Home         HomeCloud   HomeMedia
                 |
              HomeCore
```

HomeCore is currently embedded in the HomeCloud backend.

## Gateway

`gateway/nginx.conf` is the single public entry point. It keeps the web apps
on one origin and routes API requests to the correct backend. Only the
gateway publishes a host port in Docker.

| Path | Service |
|---|---|
| `/` | Home |
| `/cloud/` | HomeCloud |
| `/media/` | HomeMedia |
| `/notes/` | HomeNotes |
| `/sync/` | HomeSync info page |
| `/api/` | HomeCloud / HomeCore |
| `/api/homemedia/` | HomeMedia |
| `/api/homesync/` | HomeSync |
| `/api/homenotes/` | HomeNotes |

The gateway currently provides HTTP only.

## Application boundaries

Each application owns its own data and business logic.

- Use public APIs for cross-app communication.
- Never read another application's database directly.
- Keep hard dependencies explicit.
- Optional integrations must not make an app unusable.

HomeMedia and HomeSync use HomeCloud for identity and file storage.

## HomeCore

HomeCore provides shared identity, sessions, roles/permissions, application
registration and events. It lives in `homecore/`, but is currently executed
inside the HomeCloud backend.

## Data

Services use SQLite and Docker volumes for persistence. HomeCloud owns the
original uploaded files; other apps reference them rather than duplicating
the file data.

## Known limitations

- HomeCore is not yet a standalone service.
- Cross-application permission enforcement is incomplete.
- The gateway has no built-in TLS.
- File authorization is primarily owner-based.
- HomeVault is design-only.
