# Administrator Vault reset

Status: implemented; independent security review remains open. Roadmap item 3 authorizes this bounded
account-support action; it does not authorize any real reset or deployment.

Home Settings, the ecosystem shell, lists Core accounts for administrators.
An administrator checks one account's Vault status and explicitly types
`DELETE <account id>` before resetting it. Home calls Vault directly; Core
never opens Vault's database, and no Tier 1 sibling gains an optional dependency.
Vault may be absent without preventing other Settings actions.

Vault verifies the administrator's session against live Core on every request
(no five-second identity cache for this destructive surface). Its admin status
response contains only existence and the current vault id, never envelopes,
ciphertext or keys. Reset requires that exact vault id so a delayed request or
retry cannot delete a newly created vault. Owner APIs retain their ownership
rules. Normal Core sessions, not Bridge capabilities, authorize the action.

Deletion and a local audit record (actor/account/vault ids and timestamp) commit
in one SQLite transaction. The audit stays in Vault's own database and backups;
there is no new cross-service audit delivery or audit-reading API. No automatic
retention or secure-erasure guarantee is introduced. Rollback leaves this additive
table intact; old clients and owner routes remain compatible.

The audit records successful uses of this route, not every destructive path or
failed attempt, and is not tamper-resistant against a database/server operator.
Deploy the Vault backend before the Home controls; an older or missing backend
leaves the action unavailable. Core must expose the canonical admin account list.
Restoring old databases can restore old vault ids; the replacement guard is for
the current database history, not protection against an operator restoring data.

Reset removes the current envelope, active items and Trash; the owner can create
a new vault. It cannot recover secrets, revoke already unlocked copies, erase
backups/exports, or rotate keys in historical data. No claim of independent
security approval follows. No account deletion, password reset, mass reset,
new crypto format or background action is included.

Acceptance: real Core/Vault tests prove authorization, live demotion/revocation,
malformed confirmation, absent/replaced vaults, cascade and atomic audit behavior,
other-user isolation and owner recreation. Browser checks prove deliberate
confirmation, success/failure, keyboard/mobile use and ordinary-user hiding.
