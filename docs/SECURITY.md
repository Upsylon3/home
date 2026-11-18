# Security

## Android server credentials

The native client publishes the selected server URL and token as one immutable
snapshot, and caches each URL/client pair together. Before sending a request,
the HTTP client checks the current snapshot against its bound base URL, origin,
port and base path. A retained client refuses new work after a server change or
logout. An already dispatched request remains bound to its original server;
server switching cannot redirect it or attach the new server's token.
Automatic redirects are disabled, including login bodies and uploads. Enter the
final gateway URL rather than a redirecting portal address. HTTPS certificate
verification remains enabled; the existing deliberate LAN HTTP policy is unchanged.

This is credential isolation, not multi-server backup support. Room history,
device IDs, settings and WorkManager jobs still need destination/account scoping
and migration proof before multiple backup destinations can be enabled. Existing
preferences/Room schema and the installed application ID are unchanged.

Managed coordinated snapshots stop all project containers and read application
sources through read-only mounts. Helpers have no Docker socket; capture has no
network access. Only container identity/state/mount metadata is inspected, never
container environment values. The private recovery marker contains container IDs
and a configuration digest, not service credentials. Snapshot data is unencrypted
except existing Vault ciphertext. Configuration and TLS certificates need separate
protected backups. Keep storage private and encrypted; integrity checks are not
proof of authenticity or physical disaster recovery. See [backup operations](DEPLOYMENT.md#backups).

HOME is intended for user-controlled personal/family installations.
**HomeVault has not received independent security/cryptography review. Do not
store real passwords or secrets in it yet.** [Review handoff](VALIDATION.md#vault-review).

## Access and authentication

Foreign accounts are not accepted today. Core assigns durable account subject
UUIDs; the [offline preparation tool](DEPLOYMENT.md#offline-peer-identity-preparation)
stores separate server keys and pending/suspended/revoked peer records outside
application data. Public descriptors are not credentials or signed proof of
possession. Staging grants no access and cannot activate trust. Windows directory
ACL protection is an operator prerequisite, not a verified tool guarantee.
An explicit experimental opt-in adds the [signed pairing API](API.md#experimental-multi-server-pairing):
fresh local administrator password/2FA on both sides, full transcript/key pin
approval, Ed25519 message types separate from local JWTs, durable replay/receipt
state, bounded public-HTTPS-only transport and uncached live peer status.
Revocation commits locally before durable notification retries. A signed response
binds the exact request, so a prior positive status cannot answer a new request.
Half-activation, outages, capacity exhaustion, clock rollback and mismatched
generations cannot provide effective trust. These controls grant no account or
resource access. Guest principals, planned rotation, integrated restore gates,
independent review and public-network drills remain unfinished; see the
[pairing design](PAIRING-DESIGN.md) and [review evidence](VALIDATION.md#multi-server-pairing).

- Core hashes login passwords with bcrypt, supports TOTP/recovery codes and
  signs revocable JWT sessions. Password changes, disable and sign-out-everywhere
  invalidate sessions through token versions.
- Managed bundles require a server-issued, one-use, 128-bit registration code
  expiring after 15 minutes. Consumption and account creation are transactional.
  Source/development installs retain open registration unless explicitly configured.
- Authentication routes are limited to ten attempts per 15 minutes per IP.
  Proxy trust must match the deployment; do not expose service ports directly.
- App backends verify sessions with Core. Successful identities may be cached
  for at most five seconds; expired entries are not reused during outages.
  Verification has a five-second deadline and bounded caches/in-flight work.
- Browser request handlers only clear the shared login for a 401 when the token
  still matches the request's captured token. Delayed old-session failures remain
  errors for that request but cannot sign out a replacement session; a current
  session's 401 still expires it. Media applies this to images and uploads too.
- Backends enforce roles and ownership. Frontend hiding is never authorization.
  Monitor is admin-only; Cloud files/folders are owner-only.
- Media revalidates cached EXIF/thumbnails through Cloud's authorized download
  before serving them. Source deletion/denial or an unavailable Cloud fails
  closed; derivative responses are private/no-store. This cannot recall copies
  already delivered to a client.
- Browser video posters use owner-authorized, fixed-deadline source tickets with
  shared request/byte budgets; the browser cache is bounded and never persisted.
  No server video decoder is added. All bearer media responses sandbox uploaded
  document content, including HTML/SVG, while media elements can decode bytes.
- Share links use high-entropy tokens, separate rate limits and immediate
  invalidation when the underlying file is trashed.
- Upload caps, per-user quotas, input/path validation and safe Markdown rendering
  constrain ordinary file/content operations. These are not a complete security audit.

## Transport and shared origin

Raw gateway port 8080 is HTTP. Managed bundles bind it to loopback by default;
LAN exposure is an explicit unencrypted mode. Never forward 8080 to the internet.
Use HTTPS or a protected private-network connection for broader access.
Optional Caddy provides public HTTPS when configured; it does not make an
internet-facing login equivalent to a private deployment. See [deployment](DEPLOYMENT.md).

All app UIs share one origin and the bearer token in localStorage. A script
running in any app can access that session. The gateway's CSP, sanitized
Markdown and tab-lifetime Vault keys mitigate this risk but do not eliminate it.
Keep the strict script policy, no unsanitized untrusted HTML, and no persistent
plaintext vault keys. Only Vault's prefix needs `wasm-unsafe-eval`.

CORS is broad when unset and no credentialed cookies are used. Cross-origin
pages do not acquire the user's bearer token automatically, but wildcard CORS
is not an authorization boundary. Set explicit origins where appropriate.

## Known limits

Application access keys are separate 256-bit opaque bearer credentials, stored
hash-only in Core. A full current user session explicitly consents to a subset
of an enabled registered application's declared `files.*` permissions. Cloud
verifies each route's fixed audience/permission live in Core without a positive
cache, retains owner/quota checks, and grants no administrator authority. An
arbitrary caller-app header is ignored. Session APIs, other application APIs,
Vault and background capabilities do not accept these keys. Public health/share
links retain their separate intentionally public authentication model.

Keys expire after 30 days; explicit revocation, password/sign-out epoch changes,
account disable/role change, app disable/uninstall and manifest permission edits
invalidate access. Disable/uninstall/permission edits permanently revoke affected
keys, so re-enablement cannot revive them. Restoring Core requires offline
revocation of both application keys and scheduled delegations before traffic.
Already-authorized in-flight transfers may finish; revocation refuses subsequent
permission checks, without rolling back successful writes.
Only the issuance response shows a key; Home keeps it in component memory until
hidden/navigation, never persistent browser storage. Anyone holding a key can
act as that granted application: it is not executable-code attestation. Never
give an external consumer the user's full login token instead.

- Cloud, Notes, Tasks and other ordinary app data are server-readable. Vault is
  the client-encrypted exception; HOME does not automatically encrypt disks or backups.

- App-manifest permissions do not isolate ordinary browser applications:
  sessions identify users, not the calling app. Scoped application keys and
  background capabilities are enforced separate credential types. They do not
  sandbox code running inside the existing shared browser origin.
  Install/enable/uninstall controls do not restrict direct browser-session URLs
  or control service processes. Registry changes require a live administrator;
  uninstall preserves data and atomically revokes affected application keys and
  automation grants with audits. Reinstall does not revive revoked authority.
- A disabled-account login response reveals that the account exists and is
  disabled. This is the current usability tradeoff.
- Account disable and administrator password reset are supported; full
  cross-service account deletion and email-based recovery are not.
- Source installations need explicit secrets/transport configuration. The public
  portal is only an address launcher; it does not authenticate or secure servers.
- Local backup copies do not protect against disk/machine loss. SQLite integrity
  checks do not certify all cross-service references or historical file content.
  Mounted-storage exports add checksums and restore validation, not encryption,
  authentication of hostile storage or proof of physical off-machine placement.
  Exported archives omit installation credentials/configuration and remain private
  operator data; destination access, encryption and retention are operator-managed.
- Hardware/browser measurements and AI self-review do not constitute physical
  device validation or independent security approval.

## HomeVault threat model and v0 status

The browser derives a 32-byte wrapping key with Argon2id
(`m=19456 KiB, t=2, p=1` and a random 16-byte salt). A random 256-bit vault key
encrypts item titles/content using AES-256-GCM and fresh 12-byte IVs. The master
password wraps that vault key; a separate random 256-bit recovery key provides
another wrapping path. Recovery-key checksums detect typos, not attackers.

The backend stores encrypted items, wrapped keys and limited metadata. It does
not receive plaintext secrets, a master password or a usable decryption key.
A new device still needs the master password/recovery key. Administrators can
disable/reset/delete data through authorized operations, not decrypt it.
Encrypted Trash retains item ciphertext until permanent deletion.

Important boundaries:

| Risk | Current boundary |
|---|---|
| Stolen database | Offline password guessing remains possible; password quality and KDF cost matter |
| Compromised serving code | A server that changes delivered JavaScript can steal secrets on a later unlock; ciphertext storage alone does not prevent this |
| Shared-origin XSS | An allowed script can use the shared session and attack an unlocked client |
| Record substitution/replay | Current AES-GCM records lack application AAD/rollback counters; authenticated bytes are not proof of record identity or freshness |
| Historical credentials | Password changes/recovery regeneration rewrap the same data key; old credentials plus an old envelope may still expose later items |
| Memory and unlocked clients | Five-minute idle lock limits exposure; extractable vault keys support rewrap, wrapping-key imports are non-extractable; JS/WASM/GC do not guarantee secure erasure |
| Metadata and deletion | Item counts, sizes and timestamps are visible; deleting current records does not erase older backups |
| Compromised device/extensions | Outside the confidentiality guarantee; no client crypto fixes a keylogger |

Vault keys are kept in tab memory, not persistent web storage. HomeAI and
server-side search must never receive decrypted Vault content. Review must
address format validation, resource bounds, key lifecycle, async races and
the limits above before real use. [The review packet](VALIDATION.md#vault-review)
contains the detailed scope; [the optional benchmark](VALIDATION.md#vault-performance)
measures client performance, not security.

## Internal services and optional automation

General internal APIs use a constant-time shared-secret check and fail closed
when unconfigured. Keep Core/internal ports private: headers alone cannot
prove a trusted caller. Monitor has no Docker socket, gets read-only backup
access, and is not given the JWT signing key.

Bridge search forwards only the live user's token to configured Notes/Tasks
APIs and retains no search index or browser token. [Search boundary](ARCHITECTURE.md#cross-app-search).

[Monitor follow-up automation](#automation-contract) is
off by default and requires operator setup plus owner consent:

- Core issues hash-only 256-bit, action/audience-bound 30-day capabilities.
  Enabled-admin, account/epoch/registry checks and revocation are live, with no
  positive verification cache. Session APIs never accept capabilities.
- Issuance is private and refuses browser-origin requests. Owner grant controls
  expose metadata only; credential surrender can revoke only its own parent.
- Monitor provides bounded incident metadata; unknown readings do not resolve
  incidents. Tasks owns atomic create-once receipts and a cap of 20 new tasks
  per subject/integration/UTC day, including retained deleted-task receipts.
- Bridge encrypts credentials/pending payloads with AES-256-GCM and context-bound
  associated data. Its read-only 32-byte key stays outside repo, data and backups.
  Encryption protects stored state, not a compromised running worker.
- Four shared slots and per-rule leases bound dispatch. Disable pauses before
  I/O; failed surrender persists. In-flight requests may finish; no rollback
  of already-created tasks is promised.
- Restored Core grants must be revoked, Monitor's instance rotated and Bridge
  paused offline before traffic resumes. Old Tasks receipts can roll back;
  cross-service exactly-once recovery is not guaranteed. Never prune receipts
  without a replacement duplicate-prevention design.

## Task assignment

HomeTasks sharing is explicit and task-specific. The original owner alone can
edit, assign, reopen or delete a task. One assignee can read that task, complete
it or decline; the backend checks this ACL on every request independently of the
existing at-most-five-second identity cache. Being an administrator does not
bypass task ownership. New or reassigned recipients must resolve to an enabled
account through Core's exact-username API; no directory listing, role, email,
password or sibling database is exposed. Assignment versions and transactional
metadata-only audits prevent stale account lookups from reviving removed grants.

Assignee responses redact project IDs and all owner reminder fields. Personal
lists/search and summaries stay owner-only unless assigned scope is explicitly
requested. The owner can continue editing shared content, and assigned repeats
retain owner/assignee identity; each occurrence is a separate grant. Removal or
decline denies future reads/actions but cannot erase previously disclosed copies.
Application keys and background task capabilities cannot change assignments.
After restoring a Tasks database, revoke assignment ACLs offline before traffic
so an older backup cannot resurrect withdrawn sharing. Existing task reminders
stay personal to the owner; assignee completion cancels the owner's reminder.

## Task reminders

Task reminders use a separate external
32-byte producer key mounted only into Core/Tasks. Browser tokens and the
general internal secret cannot authenticate that route. Missing/invalid keys
fail closed. Core bounds enabled-user notices to 100/user and 1000 globally
per UTC day; only title/IDs/delivery UUID cross the boundary, not task notes.
Receipts and notification creation are atomic. Completion/deletion cancels
pending work but cannot retract in-flight/delivered notices. Restore both
services consistently; exact-time and cross-service restore delivery are not
guaranteed. Keep keys separate and follow [operational restore steps](DEPLOYMENT.md).

A reminder is one explicit UTC instant per task occurrence, at most 366 days
ahead. Due dates keep their calendar semantics. Completing clears the reminder;
reopening/repeating does not rearm it. Editing a time gets a new delivery UUID;
workers acknowledge only their original generation. Core retains delivery receipts
and refuses rebinding a UUID to another owner/task; the first accepted title wins.
A compromised producer key can still spam bounded notices, so protect it separately.

## Reporting a vulnerability

Use private GitHub vulnerability reporting if available, or contact the
maintainer privately. Do not post secrets, personal data or exploit details
in a public issue.

## Administrator Vault reset

Home Settings calls Vault directly using the administrator's normal session.
Vault checks live Core authority on every destructive request, without the normal
five-second positive cache. Status returns only existence/current vault ID.
Reset requires that exact ID and typed `DELETE <account id>` confirmation:
a delayed request must not delete a replacement vault.

Deletion and a local bounded audit record commit in one Vault transaction.
Reset deletes the current envelope, active items and Trash; it cannot decrypt
secrets, revoke unlocked copies or erase backups/exports. The audit covers
successful resets through this route, not all destructive paths, and is not
tamper-resistant against the operator. Restoring a database can restore old IDs.
Deploy the backend before its controls; an absent/older backend leaves reset
unavailable without breaking other Settings actions.

## Automation contract

Monitor follow-up is one opt-in integration, not a generic scheduler. Only an
enabled administrator can enroll their own account. Explain the source,
destination, five-minute polling, 15-minute qualification, 20-task daily cap,
30-day expiry and manual task management before consent. Normal browser sign-out
does not cancel an enrolled grant; Disable, password change, Sign out everywhere,
role loss, account disable and expiry do. Renewal requires a fresh owner action
and does not reset receipts or daily limits.

Core issues two distinct opaque credentials under one grant: Monitor
`monitor.alerts.read` and Tasks `tasks.automation.create-once`. Each is restricted
to its audience/action and subject; neither is a session, pending-2FA token or
general internal secret. Keep the two route verifiers separate. Use Authorization
headers, never URLs, and introspect live Core/registry authority before each action.
Issuance stays private; neither browser nor Bridge receives Core's signing/internal key.

Monitor commits incident identity, alert state, freshness and notification intent
atomically. Unknown/missing readings preserve the incident identity and never
mean resolved. Pin its instance UUID at enrollment; a changed/restored instance
pauses the rule for owner confirmation.

Qualification requires four distinct critical evaluations spanning at least
15 minutes, with no gap above ten minutes. Evaluations must be at most two minutes
old and no more than 30 seconds in the future. Warnings, unknown/disappeared
conditions, stale/duplicate clocks, disabled apps and worker restart reset
incomplete qualification. Before a write/retry, revalidate the fresh source and
grant; positive resolution cancels further attempts, including uncertain ones.

The task is a bounded personal inbox summary with the fixed `/monitor/` link,
not raw diagnostics, assignment or automatic escalation. Completing/deleting it
acknowledges that incident; recovery never edits/reopens/deletes it.
The deterministic create-once key includes integration, subject, Monitor instance
and incident UUID, not grant, title or retry time. Persist the exact payload/key
before first delivery and reuse both on retry. A changed replay conflicts; an
identical replay returns the original receipt, including after response loss.
Manual deletion retires the receipt instead of allowing recreation.

Bridge persists encrypted credentials and a disabled rule before enabling.
Failed enrollment revokes the grant. Disable pauses dispatch before I/O and
persists pending revocation across restart; Core's owner grant controls remain
available when Bridge is down. Use one leased cycle per rule, four global action
slots, bounded requests/responses and fixed origins without redirects. Retry
timeouts/5xx at the next tick after revalidation, honoring bounded Retry-After;
validation/conflict failures need visible attention. Discard delivered payloads,
retain bounded receipts, never raw snapshots.

A compromised running Bridge can still read its permitted alert projection and
create up to 20 arbitrary bounded summaries per opted-in subject/integration/day.
Tasks enforces the capability and quota; it cannot attest that the summary
actually came from Monitor. Encryption at rest does not fix a compromised worker.

Restore/rollback must revoke Core grants, rotate Monitor identity and pause
Bridge offline before traffic, then require fresh consent. Keep Tasks receipts
and counts with its database; an older snapshot can lose deduplication history.
Never drop receipts or user tasks as automatic rollback/cleanup. Search and
Tier 1 apps remain usable with automation absent.
