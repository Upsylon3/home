# First scheduled bridge: critical alerts become personal follow-up tasks

Status: **implemented, explicitly opt-in**: authority, source/destination APIs,
encrypted Bridge state, bounded worker and Home Settings controls. Default
Compose operation remains search-only from decision 001. Repository tests,
browser checks and Docker gates verify the documented disposable journey. This
decision authorizes no deployment, real credential issuance or automatic
enrollment. The next implementation must satisfy the gates below.

## Journey and first-release boundary

An administrator explicitly enables **HomeMonitor follow-up tasks** in Home.
HomeBridge then checks every five minutes, including while the browser is
closed. A critical alert observed in four fresh checks spanning at least
15 minutes creates one task in that administrator's own HomeTasks inbox.
Warnings, unknown readings and short-lived critical alerts create nothing.
Existing alerts can qualify after enrollment; the consent preview says so.

The task title is `Review HomeMonitor alert: <bounded plain-text title>`.
Notes contain the source, incident opening time and the fixed `/monitor/`
link, not raw monitoring diagnostics. No due date, project, assignment,
recurrence or priority escalation is added. Users manage the resulting task
normally. Recovery never automatically completes, edits or deletes it.
Completing or deleting a task acknowledges that incident: the bridge does
not recreate or reopen it. A genuinely new incident can create a new task.

This is one fixed integration, not a rule builder, workflow engine or generic
scheduler. No email, AI, HomeVault, shared-user tasks or remote deployment.
HomeMonitor's existing alerts and notifications continue independently.

## Evidence and prerequisites

- [HomeMonitor alert evaluation](../../apps/homemonitor-backend/src/alerts.js)
  already distinguishes active incidents and warning/critical severity.
  [Its history](../../apps/homemonitor-backend/src/history.js) persists `key`
  and `since`. However, [the monitor](../../apps/homemonitor-backend/src/monitor.js)
  previously collected fresh snapshots without saving alert state on notification
  failure, cleared unknown services and dropped missing conditions. Those gaps
  are now corrected: state/freshness/outbox commit atomically and unknown/missing
  conditions preserve open incident identity. Use the committed evaluation time,
  never snapshot time alone, as freshness evidence.
- [The current Monitor API](../../apps/homemonitor-backend/src/app.js)
  keeps broad status/history administrator-only and adds a separate curated
  capability-only alert feed.
- [HomeTasks creation](../../apps/hometasks-backend/src/tasks.js) has ownership
  checks and now a separate create-once action with durable receipts and daily
  limits. A timeout after commit replays the same receipt without a second task.
- [HomeCore authentication](../../homecore/src/middleware/authMiddleware.js)
  and [the shared client](../../packages/homecore-client/src/verify.js) verify
  browser sessions; the separate delegation verifier implements scoped
  capabilities without widening session authentication.
- HomeSync was considered and rejected for this first bridge:
  [device registration](../../apps/homesync-backend/src/devices.js) initializes
  `last_seen_at`, and [upload handling](../../apps/homesync-backend/src/sync.js)
  updates it before an upload succeeds. `/check` does not update it. These
  fields cannot establish successful backup cycles or healthy idle check-ins.
  No Android changes or invented device-validation evidence belong here.

## Consent, identity and least privilege

Only a currently enabled administrator can enroll their own account. Home
shows the exact source, destination, qualification period, polling interval,
20-task daily limit, expiry and manual task-management behavior before Enable.
Default is off; there is no administrator action to enroll another person.
Normal browser sign-out does not cancel an explicitly enabled background
grant; Disable, password change and Sign out everywhere do. Explain this
distinction at enrollment.

HomeCore owns the grant, subject, integration identifier, fixed permission
allow-list, expiry, token-version binding and revocation state. The grant
expires after 30 days; renewal requires a new authenticated owner action,
not an unattended refresh credential. Display the exact expiry and paused
status in Home. Renewal never resets task deduplication or daily limits.
Core records grant creation, renewal and revocation in its existing audit
stream using bounded grant/action metadata, never raw credentials or hashes.

Core mints **two separate opaque audience-bound credentials** under the one
grant, each with at least 256 random bits. Store only their cryptographic
hashes in Core. Neither credential is
a browser JWT, pending-2FA token, admin session or shared internal secret.

| Audience | Allowed action | Minimum data/effect | Explicitly forbidden |
|---|---|---|---|
| HomeMonitor | `monitor.alerts.read` | A curated, fresh condition/incident feed with instance ID, evaluation time, incident ID, key, explicit state, severity, title and opening time | Full status/history, raw diagnostics, configuration, files and other accounts |
| HomeTasks | `tasks.automation.create-once` | Create a bounded, non-repeating inbox task for the grant's subject, with a durable idempotency receipt | Listing/reading other tasks; editing, completing, reopening, deleting, assigning or changing projects |

Each credential has one audience and one action. A Monitor credential cannot
authorize a Tasks operation or vice versa. Subject and permission come from
Core, never request-body user IDs or claimed roles. Unknown audiences/actions,
wildcards, ordinary login endpoints and every unrelated route reject these
credentials. Existing browser-session routes remain unchanged.
Capabilities travel only in Authorization headers, never in URLs.

The shared client has a separate, explicit delegation verifier for these
two narrow action routes. Do not broaden `requireAuth` to turn a capability
into a general `req.user` session. Each action introspects Core live, without
a positive authorization cache. Core checks expiry, revocation, the current
enabled/admin account, token version, integration and both required registry
entries. An outage or malformed response fails closed; disabled apps pause
the rule without being treated as resolved incidents.

Lifecycle refinement: either opaque credential can surrender only its own
parent grant through Core, including after expiry/account invalidation. This
adds no read/write scope and cannot mint/renew or target another grant. It
lets Disable retry revocation after restart without a retained browser JWT.
Rotated/unknown opaque credentials get a blind idempotent response and cannot
revoke replacements. Direct owner revocation remains available independently.

No signing key or `HOMECORE_INTERNAL_SECRET` goes to HomeBridge. No browser
token is retained. HomeBridge receives the minted pair server-to-server and
stores it encrypted with native AES-256-GCM and a fresh nonce per write.
Authenticated associated data binds the integration, subject, grant and
audience, so encrypted rows cannot be swapped between rules undetected.
The operator supplies the wrapping key through a read-only secret file,
outside the database, repository and backups. It protects stored operational
credentials, not against a compromised running HomeBridge process. Never
return a credential, ciphertext or wrapping key to the browser or logs.

A compromised running Bridge can read the delegated alert projection and
create up to 20 arbitrary bounded task summaries per day for an opted-in
owner until revocation/expiry. Tasks cannot independently prove a supplied
summary came from a real Monitor incident without introducing another trust
mechanism. This residual risk is explicit: the capability permits constrained
creation, not cryptographic attestation of the scheduler's reasoning.

## Contracts and implementation status

1. HomeCore provides owner-session grant creation, metadata listing,
   revocation and renewal, plus capability introspection. Integration
   `monitor-followup-v1` determines permissions; callers cannot choose
   arbitrary scopes, a different subject or an expiry beyond 30 days.
   **Implemented:** see `docs/API.md`. Mint/renew are private internal server
   routes accepting the full consenting owner session; public routes expose
   metadata, revocation and introspection only. This keeps raw credentials out
   of browser responses. The gateway blocks private issuance, and Core also
   rejects browser Origin/Fetch Metadata headers there. The enrollment server
   completes encrypted persistence and source validation before reporting enabled.
2. HomeMonitor adds a narrow alert-read action. Persist an instance UUID,
   per-incident UUID and successful alert-evaluation timestamp. Update alert
   state, incident identities and evaluation time in one local transaction.
   Distinguish known critical/warning, positively resolved and unknown states.
   Unknown/missing readings must not retire an incident identity; only a
   positive clear can do so. Correct this source behavior explicitly with
   regressions rather than inferring resolution in Bridge. Existing status
   schemas and notifier delivery/retry guarantees stay compatible.
   **Implemented:** `GET /api/homemonitor/automation/alerts`, durable instance
   and incident UUIDs, explicit states and transactional freshness. Durable
   notification intent preserves at-least-once retries even after resolution
   or restart; a failed partial batch can still duplicate notifications.
3. HomeTasks adds a generic scoped create-once action accepting only a
   bounded title, notes and idempotency key. Core supplies subject/namespace;
   reject every other creation field. A local transaction inserts the task
   and unique receipt together. Return only task ID/link and receipt state.
   **Implemented:** `POST /api/hometasks/automation/tasks`; exact title/notes/key
   schema, subject/integration isolation, retained payload-hash receipts,
   deletion retirement and the transactional UTC daily cap. See `docs/API.md`.
4. HomeBridge adds owner-session enrollment, status and disable controls,
   its own durable rule/receipt state and the bounded worker. It alone knows
   how Monitor alerts map to task payloads. Neither Tier 1 app detects
   HomeBridge or calls a sibling API/database.
   **Implemented:** exact APIs, status/reasons and deployment/restore procedures
   are published in `docs/API.md` and `docs/DEPLOYMENT.md`. Default remains off.

Publish exact routes and schemas in `docs/API.md` with the implementation,
not as already available endpoints in this design change.

## Qualification and incident identity

The worker pins the Monitor instance UUID during enrollment. A different
instance pauses the rule and requires owner confirmation; a restored/reset
Monitor must not silently turn old conditions into a burst of new tasks.
Before reopening a restored Monitor database, run the offline identity-reset
command in `docs/DEPLOYMENT.md`. It rotates the instance ID and clears freshness;
ordinary restarts do neither. The worker pauses on that identity change.
An incident UUID survives severity changes and restarts, and changes only
when a resolved condition genuinely opens again. Do not use title or wall
clock alone as the incident identity. Preserve that UUID across unknown
readings; absence from an active-alert list is not positive clear evidence.

Accept only well-formed evaluations no more than two minutes old, no more
than 30 seconds in the future, and newer than the previous observation.
Four successful critical observations must span at least 15 minutes, with
no gap exceeding ten minutes. Duplicate snapshots never advance the count.
Warning, disappearance, unknown/offline source, clock anomalies, disabled
registry entries or a worker restart reset incomplete qualification.
Delivered-incident receipts survive those resets.

Before every new write or retry, re-check the fresh source and live grant.
Do not infer recovery from an outage, malformed reply or stale feed. Once
resolution is actually observed, stop further creation attempts for that
incident, including an attempt whose earlier outcome is uncertain. An
already committed task remains user-managed.

## Delivery, retries and duplicate prevention

Use a deterministic key derived from integration version, subject, pinned
Monitor instance UUID and incident UUID. Exclude grant ID, credential ID,
title and retry time: renewal, renaming and re-enrollment must not duplicate
an incident. HomeTasks enforces uniqueness by subject, integration namespace
and key, independently of the Bridge journal. Replays with changed payloads
return a conflict; identical replays return the original receipt.

Persist the canonical task payload and key before the first write. Retries
reuse both even when the alert's title changes. After a definite receipt,
discard the pending payload and retain only bounded identity/receipt metadata.
Do not store raw alert bodies or full monitoring snapshots as retry data.

Keep the receipt after manual task deletion, without retaining task content.
A replay then returns a retired receipt, not a recreated task. No cleanup TTL
may silently permit reuse of an old incident key. The task service enforces
at most 20 new automated tasks per subject/integration/UTC day in the same
transaction; successful replays do not consume the limit, and renewal cannot
reset it. Surface backlog/limit status rather than dropping work silently.

One worker cycle per rule; no overlapping ticks. Start with a global limit
of four in-flight action requests and the existing five-second header/body
deadlines, response-size bounds, fixed origins and redirect refusal. On a
timeout/5xx, retain the same intent/key and retry at the next five-minute
tick after revalidation. Honor a longer bounded Retry-After; never retry in
a tight loop. Validation/conflict errors require visible attention. Expired,
revoked or rejected grants pause the rule. A read-only source outage cannot
generate a task about that outage unless Monitor itself has a fresh incident.

## Durable state, enable/disable and rollback

HomeCore owns consent and capability authority. HomeBridge's new database
owns encrypted credentials, rule configuration, incomplete qualification and
delivery receipts. HomeMonitor owns incidents; HomeTasks owns tasks and the
authoritative create-once receipts. No shared database or distributed
transaction is introduced.

Persist the minted credentials and disabled rule before enabling the worker.
If enrollment persistence fails, revoke the grant and report failure; never
report enabled before durable state exists. Incomplete/orphaned enrollment
must be visible in Core's owner grant list and safely revocable.

Disable stops new local dispatch immediately and revokes the whole grant in
Core. If Core is unreachable, show **stopping — revocation pending**, keep
the local worker paused and retry revocation after restart. Offer direct
owner revocation in Core if Bridge is unavailable. A request authorized
before revocation can still finish; do not promise rollback of that task.
Home's grant-management UI must call Core directly for this fallback, not
depend on the failed Bridge proxy. Role loss, account disable, password change,
Sign out everywhere and expiry
are checked on every subsequent action even if Bridge is compromised.

Persist no alert bodies or raw status snapshots. Bound title/error metadata,
redact credentials and report last successful check, qualification, delivery,
expiry and failure status in Home. There is no extra notification/email
permission in this release.

Search must still start and work without automation storage or a wrapping
key. Missing/unreadable keys leave scheduled work unconfigured or paused,
never stored as plaintext. The separate deployment override opts in to the
new state volume/key mount and back up only the database with encrypted
operational fields (rule/receipt metadata remains plaintext). Restoring
without the key requires owner re-enrollment and revocation of old grants.
Bridge-only restore uses Tasks' durable receipts to avoid duplicates; restoring
Tasks itself to an older snapshot cannot promise cross-service exactly-once
history. Existing backup limitations remain visible.

Bridge restoration additionally requires offline pause maintenance before
traffic, then surrender and fresh owner consent. This prevents an old snapshot
from restoring an enabled rule whose local Disable was awaiting revocation.
Ordinary restarts retain enabled rules and reset only incomplete qualification.

Restoring Core's grant database must invalidate restored service grants before
services are reopened to traffic, so an old backup cannot resurrect a revoked
capability. Include this maintenance procedure and its test in the authority
milestone; an ordinary process restart must not be mistaken for a restore.

Rollback disables/revokes grants before removing the worker. Created tasks
remain normal user data. Migrations are additive; never delete tasks or drop
receipt records as automatic cleanup. Live search and all Tier 1 services
remain usable with the scheduler absent.

## Implementation and acceptance gates

Implement in this order, with independently reviewable tests:

1. **Authority:** Core grants and the separate shared verifier. Prove owner
   consent, 2FA/session boundaries, audience/action isolation, wrong-subject
   refusal, expiry, rotation and every revocation condition. Ordinary browser
   routes must reject capabilities. Unknown registry/auth state fails closed.
   Implemented and covered by real-Core, HTTP-boundary and disposable restore
   tests. Migration is additive and normal database reopening preserves grants.
2. **Source and destination:** stable incident IDs with transactional freshness,
   then transactional create-once receipts with concurrent/replayed requests,
   manual deletion, changed payload, daily limits and crash-after-commit proof.
   These are generic own-resource APIs, independent of Bridge installation.
   Implemented with real-Core HTTP tests, SQLite rollback checks, concurrent
   process tests, abrupt exit after commit, UTC rollover and restore maintenance.
3. **Worker and controls:** real disposable Core/Monitor/Tasks integration,
   fake clock, enrollment/disable UI, encrypted persistence and restart proof.
   Exercise short-lived warnings, stale/future/repeated evaluations, severity
   changes, source resets, outages, expiry, response loss after task commit,
   pending revocation and rollback. No scenario may require storing a browser
   token or granting unrelated task/monitor access.
   Implemented with fake-clock integration, encrypted backup/restore, lease and
   disable/enrollment race tests. Four shared SQLite slots enforce the global
   bound across processes; each cycle sends at most four pending deliveries.
4. **Full gate:** responsive keyboard/browser flow, two-owner isolation,
   concurrent workers, Docker optional-service recovery, encrypted backup
   restore, missing-key behavior and all existing repository checks. Verify
   search-only operation with no automation configuration. Never use a real
   installation or claim physical-device/independent security validation.
   Browser checks cover desktop keyboard consent/renew/disable, mobile layout
   and direct Core revocation with Bridge offline. Disposable Docker uses a
   scripted condition/clock after real Monitor authorization to avoid a
   fifteen-minute CI wait; Core, Tasks, encrypted storage and deployment mounts
   are real. Existing repository CI gates remain mandatory before merge.

Completion means the implemented journey and authorization boundary pass
these gates and merge under the repository workflow. This document alone
is not deployment authorization or independent security/physical-device proof.
