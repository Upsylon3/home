# HomeBridge v0: live search across notes and tasks

Status: accepted for the first narrow HomeBridge release.

## User journey

From Home, enter a phrase, choose Notes and/or Tasks, submit once, and open a
matching note or task in its owning application. The first bridge is read-only:
no record is created, copied into another application, or indexed persistently.

## Boundaries and authorization

HomeBridge is an optional Tier 2 process under `services/homebridge`. Home's
`/search` page is its client. Tier 1 apps contain no HomeBridge detection or
cross-app calls. HomeTasks gains a generic owned-task deep link, useful with
or without HomeBridge. Notes already has resource deep links.

Every request uses the live user's bearer token. The shared HomeCore client
authenticates it, then HomeBridge reads HomeCore's registry and calls only the
selected, enabled sources' public APIs with that same token. Each source
continues to enforce ownership. Registry URLs are not trusted as proxy targets:
administratively configured, fixed HTTP(S) origins are used, with redirects
refused. HomeVault is never a search source.

This bridge needs no background credential. The decided HomeCore-minted scoped
credential remains a prerequisite for a future scheduled bridge; no session
token is stored for background use as a substitute. The standard shared
client's bounded five-second identity-verification cache still applies.

## Data flow and limits

The browser POSTs `{query, sources}` to `/api/homebridge/search`; the query is
not put in browser history or gateway access-log URLs. Only explicit submission
triggers source reads. Queries contain 2–200 trimmed characters. Each selected
source gets its own five-second header/body deadline and 1 MiB response limit.
The registry has the same limits. At most 20 results per source are returned,
with a visible limit notice. Results use plain text and fixed, validated
resource links. Source-native search semantics/order are preserved: Notes
searches title/content and excludes Trash, Tasks searches title/notes across
open and completed tasks. This is neither fuzzy nor semantic search.

No database, index, query log, persistent result cache, telemetry or new
dependency is required. Responses have `Cache-Control: no-store`. Runtime
error logs never include bearer tokens, query strings or upstream bodies.

## Failure, retry and opt-out

An unavailable source does not hide another source's successful results.
Missing/disabled sources are reported and never contacted. Registry failure
fails closed because enabled status cannot be established. Failed or malformed
source responses produce a source-level unavailable status, not an empty
success. UI states distinguish empty, partial, unavailable and limited results.
Retries are explicit; no hidden polling or automatic retry occurs.

Users opt out of a source by unchecking it, or of all searching by not
submitting. Admins disable a source in the existing registry. Operators omit
the Compose `bridge` profile to run HOME without HomeBridge. Search explains
that it is unavailable; each app and the rest of Home keep working. Removal
requires stopping the stateless service; there is no retained data to migrate.

## Proof and release boundary

Tests use real disposable HomeCore, HomeNotes, HomeCloud and HomeTasks services
to prove ownership, disabled-source behavior and the complete search flow.
Controlled HTTP servers exercise timeout, redirect, malformed/oversized reply
and partial-failure boundaries. Gateway and full-stack CI cover routing,
optional-service startup and recovery. Browser checks cover source choice,
empty/error/partial results, resource navigation and mobile accessibility.

Other sources, scheduled automation, write bridges, search indexing and
shared-user results remain outside v0. Routine work stays under Unreleased.
