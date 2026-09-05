# HOME --- Ecosystem & HomeCore Master Specification

## Product, architecture, UX, API, security, development and roadmap brief

**Document purpose:** This is a pre-development master brief for an AI
coding agent or software team. It defines the intended ecosystem around
**HomeCloud**, the shared **HomeCore** platform, and the unified
**Home** dashboard/application.

**Status:** Architecture / product specification --- no implementation
should be assumed from this document alone.

**Naming decision:** The ecosystem's unified dashboard is called
**Home**, not HomeHub.

------------------------------------------------------------------------

# 1. Executive vision

Build a coherent, self-hosted personal/family software ecosystem called
**Home**.

The ecosystem should feel like a small private operating environment
rather than a collection of unrelated websites.

At the center is **HomeCore**, a shared platform providing:

-   identity and authentication
-   authorization and roles
-   sessions
-   storage
-   file metadata
-   user preferences
-   notifications
-   audit/activity events
-   application registration
-   service-to-service authentication
-   shared configuration
-   backups and health information
-   a common API contract

Individual products then consume those capabilities.

The first major product is **HomeCloud**, a self-hosted cloud storage
application. Other products should be able to reuse its storage rather
than creating separate file silos.

The long-term experience is:

``` text
                              HOME
                    Unified personal dashboard
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
        HomeCloud          HomeMedia          HomeNotes
             │                 │                 │
        HomeSync           HomeTasks          HomeAI
             │                 │                 │
        HomeMonitor        HomeVault        future apps
             └─────────────────┼─────────────────┘
                               │
                            HOMECORE
       Identity • Storage • Events • Permissions • APIs
                               │
                         Host / Docker
                               │
                    User-controlled hardware
```

The central principle is:

> **Build the infrastructure once, then build applications on top of
> it.**

------------------------------------------------------------------------

# 2. Product principles

## 2.1 Self-hosted first

The user owns the server, data, accounts and configuration.

The system must work on a local network without requiring a third-party
cloud account.

Internet access may be used for optional remote access, updates or
external integrations, but the core system must not depend on a vendor's
cloud.

## 2.2 One ecosystem, not duplicated applications

Applications should reuse HomeCore capabilities.

Do not build:

-   a second user database for HomeMedia
-   a second file storage system for HomeNotes
-   a second notification system for HomeTasks
-   a second authentication mechanism for each mobile app

Instead:

``` text
HomeMedia ─┐
HomeNotes  ├──> HomeCore
HomeTasks  │
HomeAI     ┘
```

## 2.3 Modular

A user should be able to run only HomeCloud if they want.

Installing HomeMedia later should not require rebuilding HomeCloud.

Applications should register themselves with HomeCore and Home.

## 2.4 Graceful degradation

If an optional application is offline, Home should continue functioning.

Example:

-   HomeCloud online
-   HomeMedia offline

Home should still load. HomeMedia should display an unavailable state
instead of breaking the entire dashboard.

## 2.5 Secure by default

Security must exist at the backend/API layer, not merely in the
frontend.

Frontend hiding is never considered authorization.

## 2.6 Mobile is a first-class platform

The system should work as:

-   responsive web applications
-   PWA applications where appropriate
-   native Android clients where native capabilities justify them

The Android clients should communicate with the same HomeCore/HomeCloud
APIs rather than implementing a separate backend.

## 2.7 Understandable and maintainable

This ecosystem is intended to be developed and maintained by a small
team or individual.

Avoid unnecessary microservices.

Prefer a modular monolith initially, with clear internal modules and API
boundaries.

Split services only when there is a concrete reason.

------------------------------------------------------------------------

# 3. Current HomeCloud baseline

HomeCloud already establishes the ecosystem's first major capability:
self-hosted file storage.

The existing project is a React/Vite frontend and Node/Express backend
using SQLite, with Docker/Compose deployment.

Existing HomeCloud concepts include:

-   registration and login
-   bcrypt password hashing
-   JWT authentication
-   token-version based session invalidation
-   admin/user roles
-   account disabling
-   per-user quotas
-   file uploads/downloads
-   folders and nested folders
-   soft-delete Trash
-   permanent deletion
-   automatic Trash retention cleanup
-   file sharing links
-   batch file downloads as ZIP archives
-   search and sorting
-   activity logs
-   image thumbnails
-   gallery/grid mode
-   lightbox viewing
-   TOTP 2FA
-   recovery codes
-   admin management
-   PWA support
-   Docker deployment
-   automated backups

The ecosystem architecture should **extend this foundation rather than
throw it away**.

The current HomeCloud file storage model should become a candidate
foundation for HomeCore's storage service.

------------------------------------------------------------------------

# 4. Product family

## 4.1 Home

**Role:** unified dashboard / launcher / control center.

Home is not a replacement for every application's UI.

It is the central place to:

-   see installed applications
-   launch them
-   view system health
-   see recent activity
-   see notifications
-   see storage usage
-   access settings
-   manage users where authorized
-   discover newly installed applications

Example:

``` text
HOME

Good evening, Alex

┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ HomeCloud   │ │ HomeMedia   │ │ HomeNotes   │
│ Files       │ │ Photos      │ │ Notes       │
│ 72 GB       │ │ 1,284 items │ │ 23 notes    │
└─────────────┘ └─────────────┘ └─────────────┘

┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ HomeTasks   │ │ HomeSync    │ │ HomeMonitor │
│ 4 due       │ │ Synced      │ │ Healthy     │
└─────────────┘ └─────────────┘ └─────────────┘

SYSTEM
CPU 18%     RAM 43%     STORAGE 72%

RECENT
• Phone backup completed
• photo.jpg uploaded
• HomeCloud updated
```

------------------------------------------------------------------------

# 5. HomeCore

HomeCore is the shared platform, not necessarily a separate website.

## 5.1 Core responsibilities

HomeCore should eventually provide:

### Identity

-   users
-   user IDs
-   usernames/display names
-   passwords
-   password changes
-   sessions
-   session revocation
-   2FA
-   recovery mechanisms

### Authorization

-   roles
-   permissions
-   ownership
-   application-level permissions
-   resource-level permissions where necessary

### Storage

-   storage locations
-   file metadata
-   folders
-   file ownership
-   quotas
-   storage usage
-   file references
-   upload/download primitives

### Events

-   activity events
-   application events
-   notifications
-   event subscriptions

### Applications

-   application registry
-   installed applications
-   enabled/disabled state
-   application metadata
-   application routes
-   health checks
-   permission declarations

### System

-   server health
-   storage health
-   database health
-   service status
-   version information
-   configuration

### Security

-   API authentication
-   service authentication
-   audit logging
-   rate limiting
-   secret management conventions

------------------------------------------------------------------------

# 6. HomeCore architecture

Use a **modular monolith first**.

Suggested server structure:

``` text
homecore/
  src/
    core/
      config/
      errors/
      logging/
      database/
      events/
      permissions/
      health/

    identity/
      users/
      sessions/
      passwords/
      twoFactor/

    storage/
      files/
      folders/
      quotas/
      shares/

    applications/
      registry/
      manifests/
      lifecycle/

    notifications/
      notifications/
      delivery/

    audit/
      activity/

    api/
      middleware/
      routes/

    server/
```

The exact framework may follow HomeCloud's existing Node/Express
foundation unless there is a compelling reason to migrate.

------------------------------------------------------------------------

# 7. HomeCore database model

Do not attempt to create every future table immediately.

Establish stable foundational entities.

## 7.1 users

``` text
users
- id
- username
- display_name
- password_hash
- role
- disabled
- token_version
- created_at
- updated_at
- last_login_at
```

## 7.2 sessions

Prefer a server-managed session model for future clients if the project
eventually outgrows the current JWT-only model.

``` text
sessions
- id
- user_id
- token_hash
- device_name
- created_at
- expires_at
- revoked_at
- last_seen_at
```

A migration from the existing JWT implementation should be gradual
rather than forced immediately.

## 7.3 applications

``` text
applications
- id
- slug
- name
- description
- version
- icon
- base_url
- enabled
- health_url
- created_at
- updated_at
```

Example:

``` json
{
  "slug": "homecloud",
  "name": "HomeCloud",
  "description": "Personal file storage",
  "version": "1.0.0",
  "icon": "/icons/homecloud.svg",
  "enabled": true
}
```

## 7.4 permissions

``` text
permissions
- id
- key
- description
```

Examples:

``` text
files.read
files.write
files.delete
files.share
users.read
users.manage
system.read
system.manage
applications.read
applications.manage
```

## 7.5 application_permissions

``` text
application_permissions
- application_id
- permission_id
```

## 7.6 activity_events

``` text
activity_events
- id
- actor_user_id
- application_id
- event_type
- target_type
- target_id
- metadata_json
- created_at
```

Examples:

``` text
homecloud.file.uploaded
homecloud.file.deleted
homesync.backup.completed
homevault.item.created
hometasks.task.completed
system.application.installed
```

## 7.7 notifications

``` text
notifications
- id
- user_id
- application_id
- type
- title
- body
- data_json
- read_at
- created_at
```

------------------------------------------------------------------------

# 8. Application contract

Every Home application should declare a manifest.

Example:

``` json
{
  "id": "homemedia",
  "name": "HomeMedia",
  "version": "1.0.0",
  "description": "Personal photo and video library",
  "icon": "/icon.svg",
  "homepage": "/apps/homemedia",
  "health": "/health",
  "permissions": [
    "files.read",
    "files.write"
  ],
  "events": [
    "homecloud.file.uploaded",
    "homesync.backup.completed"
  ]
}
```

HomeCore should validate the manifest when an application is installed.

------------------------------------------------------------------------

# 9. Application lifecycle

Applications should support:

``` text
DISCOVER
   ↓
INSTALL
   ↓
REGISTER
   ↓
ENABLE
   ↓
HEALTHY
   ↓
DISABLE
   ↓
UNINSTALL
```

Uninstalling an application must not automatically destroy shared user
data without an explicit destructive confirmation.

Application-specific data should be separable from HomeCore data.

------------------------------------------------------------------------

# 10. HomeCore API design

Use a consistent REST API initially.

Base:

``` text
/api/core/...
```

Possible areas:

``` text
/api/core/auth
/api/core/users
/api/core/sessions
/api/core/apps
/api/core/permissions
/api/core/events
/api/core/notifications
/api/core/health
/api/core/storage
```

Keep application APIs separate:

``` text
/api/homecloud/...
/api/homemedia/...
/api/homenotes/...
/api/hometasks/...
```

This prevents HomeCore from becoming a giant endpoint dump.

------------------------------------------------------------------------

# 11. Event system

The event system is one of the most important parts of the ecosystem.

Example:

``` text
HomeSync uploads photo
        ↓
HomeCloud stores file
        ↓
HomeCore emits:
homecloud.file.created
        ↓
   ┌────┼──────────────┐
   ↓    ↓              ↓
Media  Activity       AI
indexes logs it      can index it
```

Events should be lightweight and contain identifiers, not enormous
payloads.

Example:

``` json
{
  "event": "homecloud.file.created",
  "eventId": "evt_123",
  "actorUserId": "usr_42",
  "application": "homecloud",
  "fileId": "file_9001",
  "createdAt": "2026-08-07T12:00:00Z"
}
```

Use a simple internal event bus initially.

Do not introduce Kafka/RabbitMQ/etc. unless scale actually requires it.

------------------------------------------------------------------------

# 12. HomeCloud's future role

HomeCloud becomes the ecosystem's primary general-purpose file
application.

Its storage engine should gradually become reusable by other
applications.

For example:

``` text
HomeSync
   ↓
HomeCloud Storage
   ↓
/Photos/2026/August
   ↓
HomeMedia
```

HomeMedia should not create a second copy of every photo merely to
display it.

HomeMedia should reference HomeCloud-managed files and generate
application-specific indexes/thumbnails only when needed.

------------------------------------------------------------------------

# 13. HomeSync

## Purpose

Android application for automatic phone-to-Home backups.

Primary functions:

-   photo backup
-   video backup
-   screenshots
-   documents
-   optional downloads
-   configurable folders
-   Wi-Fi-only mode
-   charging-only mode
-   battery threshold
-   manual backup
-   automatic scheduled backup
-   upload queue
-   retry failed files
-   progress
-   duplicate detection
-   backup history

Example:

``` text
HOME SYNC

Phone Backup
────────────────────────

Photos              ON
Videos              ON
Screenshots         ON
Downloads           OFF

Wi-Fi only          ON
Only while charging ON

Last backup
Today • 02:14
1,248 files • 3.7 GB

[ BACK UP NOW ]
```

HomeSync should use HomeCore authentication and HomeCloud storage APIs.

------------------------------------------------------------------------

# 14. HomeMedia

Personal media library.

Features:

-   photo gallery
-   videos
-   albums
-   favorites
-   search
-   metadata
-   EXIF display
-   timeline
-   thumbnails
-   lightbox
-   video playback
-   duplicate detection
-   shared albums
-   mobile upload integration

HomeMedia should treat HomeCloud as its storage foundation.

------------------------------------------------------------------------

# 15. HomeNotes

Personal Markdown/document workspace.

Features:

-   Markdown
-   folders
-   tags
-   search
-   favorites
-   recent notes
-   autosave
-   version history
-   attachments stored in HomeCloud
-   optional offline mode

Example:

``` text
HomeNotes
│
├── Projects
│   ├── HomeCloud.md
│   └── HomeCore.md
├── Ideas
└── Personal
```

------------------------------------------------------------------------

# 16. HomeTasks

Personal/family task manager.

Features:

-   tasks
-   projects
-   due dates
-   priorities
-   recurring tasks
-   reminders
-   assignment to family members
-   completion history
-   notifications

HomeTasks should use HomeCore notifications.

------------------------------------------------------------------------

# 17. HomeMonitor

Server monitoring and diagnostics.

Dashboard:

``` text
SERVER

CPU        18%
RAM        43%
DISK       72%
NETWORK    12 MB/s

SERVICES

● HomeCore
● HomeCloud
● HomeMedia
● HomeSync API
● Backup

BACKUPS

Last backup: 02:00
Status: SUCCESS
```

Monitor:

-   CPU
-   memory
-   disk
-   disk health where available
-   network
-   Docker/container status
-   application health
-   database health
-   backup status
-   storage growth

HomeMonitor should expose alerts through HomeCore notifications.

------------------------------------------------------------------------

# 18. HomeVault

Self-hosted encrypted secrets manager.

Potential contents:

-   passwords
-   secure notes
-   TOTP secrets
-   recovery information
-   API keys

Critical principle:

> Secrets should be encrypted client-side where practical so the server
> does not need plaintext access.

HomeVault should receive a dedicated security design before
implementation.

Do not casually reuse HomeCloud's ordinary file permissions as a
password-vault security model.

------------------------------------------------------------------------

# 19. HomeAI

Private AI interface.

Potential capabilities:

-   chat
-   document search
-   summarization
-   file Q&A
-   note search
-   semantic search
-   local model support
-   optional external model providers

Architecture:

``` text
HomeAI
   ↓
HomeCore identity
   ↓
HomeCore permissions
   ↓
retrieval/indexing
   ↓
HomeCloud / HomeNotes / HomeMedia
```

HomeAI must never bypass HomeCore permissions.

If a user cannot access a file normally, the AI must not be able to
retrieve it for them.

------------------------------------------------------------------------

# 20. Home's unified UX

Home should establish a design system used by all applications.

## Visual principles

-   dark and light themes
-   clean cards
-   restrained animation
-   consistent spacing
-   consistent border radius
-   accessible contrast
-   responsive layouts
-   keyboard navigation
-   touch-friendly controls
-   consistent loading/error/empty states

Do not force every application into identical layouts.

Share:

-   colors
-   typography
-   buttons
-   inputs
-   dialogs
-   navigation
-   icons
-   notifications
-   status indicators

but allow each application to have its own information architecture.

------------------------------------------------------------------------

# 21. Navigation model

Desktop:

``` text
┌──────────────────────────────────────────────────┐
│ HOME                              account   ⚙    │
├──────────────┬───────────────────────────────────┤
│ Home         │                                   │
│ HomeCloud    │             CONTENT               │
│ HomeMedia    │                                   │
│ HomeNotes    │                                   │
│ HomeTasks    │                                   │
│ HomeSync     │                                   │
│ HomeMonitor  │                                   │
│ HomeVault    │                                   │
│ HomeAI       │                                   │
│              │                                   │
│ ───────────  │                                   │
│ Settings     │                                   │
└──────────────┴───────────────────────────────────┘
```

Mobile:

``` text
┌─────────────────────┐
│ Home            ☰   │
├─────────────────────┤
│                     │
│   Application cards │
│                     │
├─────────────────────┤
│ Home    Apps    ⚙   │
└─────────────────────┘
```

The mobile experience must not simply shrink the desktop sidebar.

------------------------------------------------------------------------

# 22. Shared frontend package

Eventually create a reusable package such as:

``` text
@home/ui
```

Components:

``` text
Button
Input
Modal
Dialog
Toast
Card
Badge
Avatar
Dropdown
Tabs
Sidebar
Topbar
FilePicker
FilePreview
LoadingState
ErrorState
EmptyState
ConfirmDialog
```

Also shared:

``` text
@home/api
@home/auth
@home/types
@home/events
```

Do not prematurely publish these packages externally. A monorepo
workspace is enough.

------------------------------------------------------------------------

# 23. Monorepo recommendation

Move toward:

``` text
home/
├── apps/
│   ├── home/
│   ├── homecloud/
│   ├── homemedia/
│   ├── homenotes/
│   ├── hometasks/
│   ├── homemonitor/
│   ├── homevault/
│   └── homeai/
│
├── mobile/
│   ├── home-android/
│   └── homesync-android/
│
├── packages/
│   ├── ui/
│   ├── api-client/
│   ├── auth/
│   ├── types/
│   └── config/
│
├── services/
│   └── homecore/
│
├── infrastructure/
│   ├── docker/
│   └── compose/
│
└── docs/
```

Do not force the current HomeCloud project into this structure in one
huge rewrite.

Migrate incrementally.

------------------------------------------------------------------------

# 24. Deployment architecture

Initial deployment:

``` text
Docker Compose
│
├── homecore
├── homecloud
├── home
├── homemedia       optional
├── homenotes       optional
├── hometasks       optional
├── homemonitor     optional
└── backup
```

Shared persistent volumes:

``` text
homecore_data
homecloud_data
homemedia_data
homenotes_data
backups
```

Only services that truly need separate persistent data should receive
their own volume.

------------------------------------------------------------------------

# 25. Networking

Expose a single user-facing entry point where possible.

Recommended eventual topology:

``` text
                    LAN / HTTPS
                         │
                         ▼
                    Reverse Proxy
                         │
                ┌────────┴────────┐
                │                 │
              Home              APIs
                │                 │
        ┌───────┼────────┐        │
        ↓       ↓        ↓        ↓
    Cloud    Media    Notes    HomeCore
```

Applications should not require users to memorize ten different ports.

------------------------------------------------------------------------

# 26. API gateway / routing principle

Eventually prefer:

``` text
https://home.example/
https://home.example/cloud
https://home.example/media
https://home.example/notes
https://home.example/tasks
```

and APIs such as:

``` text
https://home.example/api/core/...
https://home.example/api/cloud/...
https://home.example/api/media/...
```

Local-only operation should work without external DNS.

------------------------------------------------------------------------

# 27. Authentication architecture

HomeCore should become the identity authority.

A user logs in once to Home.

Applications receive authenticated context from HomeCore.

Avoid every application presenting its own login screen.

Potential future flow:

``` text
Home login
   ↓
HomeCore session
   ↓
HomeCloud ─┐
HomeMedia  ├── authenticated application sessions
HomeNotes  │
HomeTasks  ┘
```

Existing HomeCloud JWT authentication should continue working during
migration.

Do not break existing users merely to introduce centralized
authentication.

------------------------------------------------------------------------

# 28. Authorization

Use layered authorization.

### Layer 1 --- identity

Who is this?

### Layer 2 --- role

What general role do they have?

``` text
admin
user
```

### Layer 3 --- permission

What may they do?

``` text
files.read
files.write
files.delete
users.manage
system.read
```

### Layer 4 --- resource ownership

Does this user own or have access to this particular object?

The backend must enforce all four where applicable.

------------------------------------------------------------------------

# 29. Security requirements

Minimum standards:

-   passwords hashed with bcrypt/Argon2
-   never store plaintext passwords
-   HTTPS strongly recommended outside trusted LANs
-   secure cookies/tokens where architecture permits
-   rate-limit authentication
-   validate all API input
-   sanitize filenames
-   prevent path traversal
-   enforce file ownership server-side
-   protect share tokens with high entropy
-   expire/revoke share links
-   audit sensitive actions
-   never expose secrets to frontend bundles
-   avoid logging passwords/tokens
-   protect admin endpoints
-   verify uploaded file types safely
-   limit upload size
-   protect against ZIP/path traversal
-   keep dependencies patched
-   back up database and user data
-   test restore procedures

------------------------------------------------------------------------

# 30. Backup philosophy

A backup is not considered successful merely because an archive was
generated.

Home's backup system should eventually support:

``` text
Local backup
    +
optional second destination
    +
periodic restore verification
```

Potential destinations:

-   another disk
-   another machine
-   NAS
-   encrypted external storage
-   optional third-party object storage

The user should see:

``` text
BACKUPS

Last backup       Today 02:00
Status            ✓ Healthy
Last verified     Yesterday
Backup size       84.2 GB

[ Run backup ]
[ Verify backup ]
[ Backup settings ]
```

------------------------------------------------------------------------

# 31. Notifications

Centralize notifications through HomeCore.

Types:

``` text
success
info
warning
error
security
system
```

Examples:

``` text
HomeSync
"Backup completed — 1,248 files"

HomeMonitor
"Disk usage exceeded 80%"

HomeVault
"New login detected"

HomeCloud
"Share link expired"
```

Applications create notifications; Home decides how to display/deliver
them.

------------------------------------------------------------------------

# 32. Health checks

Every service should expose:

``` text
/health
```

with a simple machine-readable response.

Example:

``` json
{
  "status": "healthy",
  "version": "1.2.0",
  "checks": {
    "database": "healthy",
    "storage": "healthy"
  }
}
```

HomeMonitor aggregates these.

------------------------------------------------------------------------

# 33. Error contract

All APIs should eventually return a consistent error format.

Example:

``` json
{
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "The requested file does not exist.",
    "requestId": "req_123"
  }
}
```

Frontend applications should never have to guess whether an error
response is:

``` text
{ error: "..." }
```

or

``` text
{ message: "..." }
```

or raw HTML.

Standardize it.

------------------------------------------------------------------------

# 34. Observability

Every request should have a request ID.

Logs should support:

-   timestamp
-   service
-   request ID
-   user ID when available
-   event type
-   severity

Never log:

-   passwords
-   raw authentication tokens
-   vault secrets
-   sensitive file contents

------------------------------------------------------------------------

# 35. Development strategy

Do not attempt to build every application immediately.

## Phase 0 --- architecture

Create:

-   HomeCore specification
-   shared API conventions
-   shared data types
-   UI design system
-   application manifest
-   event conventions
-   authentication strategy
-   deployment conventions

## Phase 1 --- stabilize HomeCloud

Before major architectural migration:

-   remove runtime crashes
-   remove obsolete Android wrapper code
-   document APIs
-   document database
-   document file/storage behavior
-   establish tests
-   establish error handling
-   establish security baseline

## Phase 2 --- introduce HomeCore internally

Extract reusable capabilities from HomeCloud:

``` text
identity
permissions
events
storage abstractions
notifications
health
audit
```

Do not rewrite everything.

## Phase 3 --- Home

Build the dashboard against HomeCore.

At this point HomeCloud should appear as the first application.

## Phase 4 --- HomeSync

Build Android backup client.

This tests:

-   mobile auth
-   uploads
-   background tasks
-   retry queues
-   shared storage
-   notifications

## Phase 5 --- HomeMedia

Build the first application that meaningfully consumes HomeCloud data.

## Phase 6 --- HomeNotes / HomeTasks

Build smaller applications to validate the shared platform.

## Phase 7 --- HomeMonitor

Add server/system visibility.

## Phase 8 --- HomeVault

Do a dedicated security design and threat model before implementation.

## Phase 9 --- HomeAI

Add indexing and AI capabilities only after permission enforcement is
reliable.

------------------------------------------------------------------------

# 36. Testing strategy

Every application should have:

### Unit tests

For:

-   business logic
-   permission checks
-   validation
-   transformations

### API tests

For:

-   authentication
-   authorization
-   successful requests
-   invalid input
-   unauthorized requests
-   ownership violations

### Integration tests

For:

-   database
-   storage
-   event flow
-   application registration

### End-to-end tests

At minimum:

``` text
register
login
create folder
upload
view
download
share
delete
restore
logout
```

For HomeSync:

``` text
discover file
queue upload
upload
retry
resume
deduplicate
complete
```

------------------------------------------------------------------------

# 37. Definition of done

An application is not finished merely because the happy path works.

Every application must have:

-   loading state
-   empty state
-   error state
-   offline/unavailable state where relevant
-   mobile layout
-   desktop layout
-   keyboard support where relevant
-   authentication
-   authorization
-   validation
-   logging
-   health endpoint
-   version
-   documentation
-   backup considerations
-   migration strategy
-   uninstall/data-retention behavior

------------------------------------------------------------------------

# 38. AI coding-agent rules

When another AI is given this specification, it must follow these rules.

## Rule 1 --- inspect before changing

Before writing code:

1.  inspect the existing repository
2.  identify current architecture
3.  identify existing features
4.  identify existing APIs
5.  identify database schema
6.  identify deployment structure
7.  identify what can be reused

Do not blindly replace working code.

## Rule 2 --- preserve existing functionality

HomeCloud is an existing product.

Do not remove existing capabilities unless explicitly instructed.

## Rule 3 --- incremental migrations

Prefer:

``` text
existing system
      ↓
adapter
      ↓
HomeCore abstraction
      ↓
migration
```

over a giant rewrite.

## Rule 4 --- no speculative dependencies

Do not introduce large frameworks, queues, databases or cloud services
merely because they are common in enterprise architecture.

Every dependency needs a reason.

## Rule 5 --- security belongs server-side

Never rely on:

-   hidden frontend buttons
-   client-side role checks
-   route hiding
-   local storage values

for actual security.

## Rule 6 --- mobile must be tested separately

Do not assume responsive desktop CSS equals a good Android experience.

## Rule 7 --- never fabricate successful testing

If the agent cannot run something, it must say so.

Never claim:

> "Build successful"

without actually building.

Never claim:

> "Crash fixed"

without reproducing or validating the relevant behavior.

## Rule 8 --- explain architectural changes

Every major change should state:

-   what changed
-   why
-   what files changed
-   what existing behavior is preserved
-   how it was tested
-   remaining limitations

------------------------------------------------------------------------

# 39. First implementation milestone

Do **not** start by building HomeMedia, HomeAI, HomeVault and everything
else.

The first actual coding milestone should be:

## HomeCore v0

Implement only:

``` text
Identity
Users
Sessions
Permissions
Applications
Events
Health
Audit
```

Then register HomeCloud as the first application.

Desired result:

``` text
HomeCore
   │
   ├── identity
   ├── permissions
   ├── applications
   ├── events
   ├── health
   └── audit
          │
          ▼
      HomeCloud
```

Then build **Home** against that.

------------------------------------------------------------------------

# 40. First HomeCore API milestone

Implement and document approximately:

``` text
POST   /api/core/auth/login
POST   /api/core/auth/logout
POST   /api/core/auth/refresh
GET    /api/core/auth/me

GET    /api/core/users/me
PATCH  /api/core/users/me

GET    /api/core/apps
GET    /api/core/apps/:id
POST   /api/core/apps
PATCH  /api/core/apps/:id
DELETE /api/core/apps/:id

GET    /api/core/health
GET    /api/core/system

GET    /api/core/notifications
PATCH  /api/core/notifications/:id/read

GET    /api/core/activity
```

Do not treat these exact URLs as immutable if the existing HomeCloud API
makes a better migration path necessary. Compatibility is more important
than naming purity.

------------------------------------------------------------------------

# 41. Future ecosystem map

The eventual ecosystem should look approximately like:

``` text
                              ┌──────────────┐
                              │     HOME     │
                              │   Dashboard  │
                              └──────┬───────┘
                                     │
       ┌──────────────┬──────────────┼──────────────┬──────────────┐
       │              │              │              │              │
       ▼              ▼              ▼              ▼              ▼
  HomeCloud       HomeMedia      HomeNotes      HomeTasks      HomeMonitor
  Files           Photos         Markdown       Tasks          Server
       │              │              │              │              │
       └──────────────┴──────────────┼──────────────┴──────────────┘
                                     │
                               ┌─────▼─────┐
                               │ HomeCore  │
                               │           │
                               │ Identity  │
                               │ Storage   │
                               │ Events    │
                               │ Auth      │
                               │ ACL       │
                               │ Audit     │
                               │ Notify    │
                               │ Health    │
                               └─────┬─────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
                HomeSync         HomeVault         HomeAI
                Android          Secrets            AI
                backup           manager            assistant
                    │                │                │
                    └────────────────┴────────────────┘
                                     │
                                  STORAGE
                                     │
                               User hardware
```

------------------------------------------------------------------------

# 42. What this project should become

The end state is not "a collection of apps."

It should feel like:

> **A private digital environment owned and operated by the user.**

Home is the interface.

HomeCore is the platform.

HomeCloud is the storage foundation.

The other applications are capabilities.

A new application should be able to say:

> "I need a user, storage, permissions, notifications and events."

and HomeCore should provide them.

That is the core architectural goal.

------------------------------------------------------------------------

# 43. Recommended AI implementation prompt

The following can be pasted into another coding AI as the project brief.

------------------------------------------------------------------------

## MASTER CODING PROMPT

You are the lead engineer for a self-hosted personal software ecosystem
called **Home**.

The repository contains an existing application called **HomeCloud**.
HomeCloud is an existing product and must be treated as the first
application in a larger ecosystem, not discarded and rewritten casually.

Your task is to evolve the repository toward the architecture described
in this document.

### Non-negotiable rules

1.  Inspect the repository before making changes.
2.  Preserve existing HomeCloud functionality.
3.  Do not claim to have built/tested something unless you actually did.
4.  Prefer incremental migration over a rewrite.
5.  Do not introduce unnecessary infrastructure.
6.  Backend authorization is authoritative.
7.  Treat mobile as a first-class client.
8.  Use consistent API and error contracts.
9.  Keep HomeCore modular.
10. Keep the project runnable after every major milestone.

### Architecture target

Build toward:

``` text
Home
  ↓
HomeCore
  ├── Identity
  ├── Sessions
  ├── Permissions
  ├── Applications
  ├── Events
  ├── Notifications
  ├── Audit
  ├── Health
  └── Storage abstractions
       ↓
HomeCloud
HomeMedia
HomeNotes
HomeTasks
HomeMonitor
HomeSync
HomeVault
HomeAI
```

### First milestone

Do NOT build all applications.

First:

1.  inspect HomeCloud
2.  document its current architecture
3.  identify reusable backend capabilities
4.  establish HomeCore boundaries
5.  implement HomeCore v0:
    -   identity
    -   sessions
    -   permissions
    -   application registry
    -   events
    -   audit
    -   health
6.  register HomeCloud as the first HomeCore application
7.  build the Home dashboard
8.  verify HomeCloud still works
9.  only then proceed to HomeSync/HomeMedia/etc.

### Expected output after each milestone

Provide:

-   architecture summary
-   changed files
-   implementation
-   migration notes
-   tests executed
-   test results
-   known issues
-   next recommended step

Do not perform a large unreviewed rewrite.

The ultimate goal is a coherent, secure, modular, self-hosted personal
ecosystem where all applications share identity, permissions, storage,
notifications and events through HomeCore.
