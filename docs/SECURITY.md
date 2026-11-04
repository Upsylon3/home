# Security

HOME is intended for user-controlled personal/family installations.
**HomeVault has not received independent security/cryptography review. Do not
store real passwords or secrets in it yet.** [Review handoff](HOMEVAULT_REVIEW.md).

## Access and authentication

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
- Backends enforce roles and ownership. Frontend hiding is never authorization.
  Monitor is admin-only; Cloud files/folders are owner-only.
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

- Cloud, Notes, Tasks and other ordinary app data are server-readable. Vault is
  the client-encrypted exception; HOME does not automatically encrypt disks or backups.

- App-manifest permissions do not isolate ordinary browser applications:
  sessions identify users, not the calling app. Scoped background capabilities
  are a separate enforced mechanism, not a fix for this generic gap.
- A disabled-account login response reveals that the account exists and is
  disabled. This is the current usability tradeoff.
- Account disable and administrator password reset are supported; full
  cross-service account deletion and email-based recovery are not.
- Source installations need explicit secrets/transport configuration. The public
  portal is only an address launcher; it does not authenticate or secure servers.
- Local backup copies do not protect against disk/machine loss. SQLite integrity
  checks do not certify all cross-service references or historical file content.
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
the limits above before real use. [The review packet](HOMEVAULT_REVIEW.md)
contains the detailed scope; [the optional benchmark](HOMEVAULT_BENCHMARK.md)
measures client performance, not security.

## Internal services and optional automation

General internal APIs use a constant-time shared-secret check and fail closed
when unconfigured. Keep Core/internal ports private: headers alone cannot
prove a trusted caller. Monitor has no Docker socket, gets read-only backup
access, and is not given the JWT signing key.

Bridge search forwards only the live user's token to configured Notes/Tasks
APIs and retains no search index or browser token. [Search boundary](decisions/001-homebridge-search.md).

[Monitor follow-up automation](decisions/002-scheduled-monitor-followup.md) is
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

[Task reminders](decisions/006-hometasks-reminders.md) use a separate external
32-byte producer key mounted only into Core/Tasks. Browser tokens and the
general internal secret cannot authenticate that route. Missing/invalid keys
fail closed. Core bounds enabled-user notices to 100/user and 1000 globally
per UTC day; only title/IDs/delivery UUID cross the boundary, not task notes.
Receipts and notification creation are atomic. Completion/deletion cancels
pending work but cannot retract in-flight/delivered notices. Restore both
services consistently; exact-time and cross-service restore delivery are not
guaranteed. Keep keys separate and follow [operational restore steps](DEPLOYMENT.md).

## Reporting a vulnerability

Use private GitHub vulnerability reporting if available, or contact the
maintainer privately. Do not post secrets, personal data or exploit details
in a public issue.
