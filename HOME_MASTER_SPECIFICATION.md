# HOME product specification

HOME is a self-hosted personal/family environment for files, media, notes,
tasks, phone backup and encrypted secrets. This is the product contract;
[architecture](docs/ARCHITECTURE.md), [API](docs/API.md) and source describe
what is implemented. [The roadmap](docs/ROADMAP.md) contains unfinished work.

Numbered sections remain so existing source comments can still be followed.
Completed implementation plans and sample coding prompts have been removed.

## 1. Executive vision

A private environment the user owns and operates, with shared infrastructure
and a consistent interface across applications.

## 2. Product principles

- The user owns the server, data, accounts and configuration.
- Local use must work without a third-party account or cloud service.
- Remote access, external providers and integrations are optional.
- Reuse identity, storage APIs, notifications and shared UI components.
- Keep apps modular; an optional app outage must not break the dashboard.
- Enforce authorization in backends. Hiding a button is not a security boundary.
- Support mobile, keyboard use, loading, empty, error and unavailable states.
- Choose the smallest maintainable design; add services/dependencies for a real need.

## 3. HomeCloud baseline

Preserve existing accounts, files, shares and APIs when extending the ecosystem.

## 4. Product family

Home is the dashboard/launcher. Each application has its own focused interface.
See the [application list](README.md#applications).

## 5. HomeCore

Core owns identity, sessions, roles, preferences, the application/permission
catalog, events, notifications and shared system information. File bytes and
file metadata are owned by HomeCloud, exposed through its API.

## 6. Architecture

Use the foundation/app/optional-bridge boundaries in
[ARCHITECTURE.md](docs/ARCHITECTURE.md). No app reads a sibling database.

## 7. Data ownership

Each service owns its schema and migrations. Core owns users, sessions,
applications, permission declarations, activity and notifications.
Historical §7.1–7.7 references concern those respective Core resources;
current schemas and endpoints are in source and [API.md](docs/API.md).

## 8. Application contract

Declare app identity, display metadata, routes, health and permissions in the
registry. Validate registrations. Permission declarations alone are not enforcement.

## 9. Application lifecycle

Installation, registration and enable/disable should be explicit. Uninstalling
an app must not silently destroy accounts or shared data. Separate app data
from platform data and require confirmation for destructive operations.

## 10. HomeCore API

Use the canonical `/api/core/` routes. Preserve compatible legacy aliases and
update callers/contracts together. See [API.md](docs/API.md).

## 11. Events

Apps publish activity through Core. Event publication failures must not undo
a successful primary operation. Optional cross-app reactions belong in Bridge.

## 12. HomeCloud storage

Other apps reference HomeCloud-managed files through its public API rather
than making independent file silos or opening its database.

## 13. HomeSync

Back up selected Android media using the same Core/Cloud APIs, with durable
queueing, retry, deduplication and explicit permission handling. Preserve the
whole-file retry and WorkManager battery constraints already chosen.

## 14. HomeMedia

Browse HomeCloud files without a second file store. Keep ownership checks
authoritative at the storage API.

## 15. HomeNotes

Provide a Markdown workspace, sanitize rendered content and reuse file storage
where needed. Collaboration and templates are future features.

## 16. HomeTasks

Support personal tasks, projects, priorities, dates and repeating work.
Sharing/assignment needs an explicit ownership model.

## 17. HomeMonitor

Admin-only, read-only system/service/backup monitoring. Do not grant it the
Docker socket or system-control authority.

## 18. HomeVault

Encrypt contents and titles in the client; the backend stores ciphertext and
wrapped keys, never plaintext secrets or a usable decryption key. Recovery must
not create a server-side master key. Keep it out of HomeAI and server-side search.
Independent security review is required before real secrets are stored.

## 19. HomeAI

A future optional consumer of user-authorized data. It must not bypass ordinary
permissions or retrieve data the requesting user cannot access. No Vault access.

## 20. Unified UX

Use the [design system](docs/DESIGN_SYSTEM.md). Keep common actions and states
consistent, accessible and understandable.

## 21. Navigation

One dashboard links to applications; each app keeps its own working interface.

## 22. Shared frontend assets

Use `design/` as the canonical source; do not fork generated copies.

## 23. Repository

Keep app/service code, tests and supporting tools in the existing monorepo.

## 24. Deployment

Support user-controlled hardware and persistent data outside disposable
containers. Installation must not silently change unrelated host configuration.

## 25. Networking

Local use is independent of internet services. Keep service ports private and
make remote access an explicit operator choice.

## 26. Gateway

Use one entry point for apps and APIs, with graceful unavailable responses and
HTTPS/private-network protection where required.

## 27. Authentication

HomeCore is the authority. Apps reuse the shared session rather than creating
separate identity stores. Preserve existing sessions during compatible changes.

## 28. Authorization

Check identity, role, applicable permissions and resource ownership in backends.
The generic caller-application permission layer remains unfinished; do not
treat the registry catalog as that boundary.

## 29. Security

Hash login passwords; rate-limit authentication; validate inputs and file paths;
enforce ownership, upload limits and quotas; protect share tokens and admin APIs.
Do not log credentials, secrets or sensitive file content. Keep dependencies
patched and preserve the controls/limits in [SECURITY.md](docs/SECURITY.md).

## 30. Backups

Back up databases and files, verify restoration, preserve previous backups on
failure and provide an off-machine recovery path. Archive creation alone is
not proof of recovery or cross-service consistency.

## 31. Notifications

Applications create bounded notifications through Core; Home displays them.
Use explicit consent for optional delivery and automation.

## 32. Health

Expose machine-readable health and show unavailable services without breaking
unrelated applications.

## 33. Errors

Use the Core error shape `{error: {code, message, requestId}}` where supported.
Keep existing API contracts compatible; do not expose stack traces to clients.

## 34. Observability

Use useful service/request identifiers and bounded logs, without passwords,
raw tokens, vault secrets or file contents.

## 35. Development

Use the current [roadmap](docs/ROADMAP.md), not the former phase-by-phase plan.

## 36. Testing

Exercise validation, ownership, API failures, migrations and real service
boundaries. Include user journeys and separate mobile/device checks where needed.

## 37. Completion

Include usable loading/error/offline states, accessibility, tests, documentation,
health, backup and migration considerations. A happy-path demo is insufficient.

## 38. Engineering rules

[AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) define the workflow:
inspect first, preserve behavior/data, migrate incrementally, avoid speculative
dependencies and report actual verification.

## 39–40. HomeCore milestones

The original Core milestones are implemented. Current contracts are in
[API.md](docs/API.md); remaining work is in the roadmap.

## 41–43. Ecosystem direction

Extend the private, user-owned environment without adding mandatory cloud
identity or data services. Future work needs a concrete use case, explicit
authority boundaries and a maintainable implementation.
