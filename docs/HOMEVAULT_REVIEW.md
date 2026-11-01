# HomeVault independent-review handoff

**Independent review: open. No independent report or approval recorded here.**
Do not store real passwords or secrets until the independent review required
by [SECURITY.md](SECURITY.md#homevault-threat-model-and-v0-status) is complete.
This packet prepares that review; its author and automated tests cannot supply it.

## Freeze the review target

Preparation started from commit `4a8cbc64761ff42acbad97e7f42b2c666c3c9180`.
That baseline contains the rewrap defect described below. Review the checkout
that includes this packet **and its fix**, not the old baseline alone.
Before testing, record the full `git rev-parse HEAD`, whether `git status
--short` is clean, the root `package-lock.json` hash, Node/npm versions, OS,
browser version and the built frontend asset hashes. Keep the exact checkout
and report together. Later code/dependency changes need a reviewed delta;
an approval for one commit is not an approval for every future build.

Ecosystem version is 1.6.2 with unreleased work; workspace version 0.1.0 is not
a distinct security approval. Nobody has been contacted or commissioned by
this packet. Review assignment, reviewer identity, report and disposition are
all **unrecorded/open in this repository**. Review must be independent of the implementation author/agent.

## Scope and source map

Follow the complete browser-to-storage flow, including sibling-app origin risk.
Links resolve within the pinned checkout; inspect source rather than comments
when they disagree.

| Boundary | Entry points | Inspect |
|---|---|---|
| Cryptographic format | [crypto.js](../apps/homevault/src/crypto.js) | Argon2id/WASM, randomness, AES-GCM, encodings, recovery checksum, key import/export, verifier |
| Setup and unlock | [Setup](../apps/homevault/src/pages/Setup.jsx), [Unlock](../apps/homevault/src/pages/Unlock.jsx) | Password/recovery inputs, independent wrapping paths, verifier checks, recovery-kit acknowledgment |
| Recovery and rotation | [Recover](../apps/homevault/src/pages/Recover.jsx), [Settings](../apps/homevault/src/pages/Settings.jsx) | Recover then set password, password rewrap, recovery regeneration, clipboard/download, deletion language |
| Unlocked lifetime | [vaultContext](../apps/homevault/src/vaultContext.jsx), [App](../apps/homevault/src/App.jsx), [Layout](../apps/homevault/src/components/Layout.jsx) | Five-minute idle lock, explicit lock, session expiry, sign-out/account switching, async operations and unmounts |
| Item data/DOM | [ItemDetail](../apps/homevault/src/pages/ItemDetail.jsx), [Vault/Trash](../apps/homevault/src/pages/Vault.jsx), [API](../apps/homevault/src/api.js), [session adapter](../apps/homevault/src/session.js) | Separate encrypted titles/data, plaintext field lifetime, error paths, clipboard, metadata, shared login |
| Server ownership/storage | [app](../apps/homevault-backend/src/app.js), [vault](../apps/homevault-backend/src/vault.js), [items](../apps/homevault-backend/src/items.js), [db](../apps/homevault-backend/src/db.js) | Current authenticated owner, ciphertext CRUD, envelope replacement, Trash/restore/purge, cascade and additive migration |
| Identity | [shared verifier](../packages/homecore-client/src/verify.js), [middleware](../packages/homecore-client/src/middleware.js), [Core auth](../homecore/src/auth.js), [Core auth middleware](../homecore/src/middleware/authMiddleware.js) | HS256/2FA/session epoch, current role/disable, five-second backend identity cache, retryable verification failure |
| Shared origin | [gateway](../gateway/nginx.conf), [Vault nginx](../apps/homevault/nginx.conf), [Notes sanitization](../apps/homenotes/src/markdown.js), [shared session](../design/session.js) | CSP and Vault-only WASM exception, all sibling script/rendering paths, token access, same-origin exfiltration paths |
| Build/deployment/backup | [lockfile](../package-lock.json), [Vault Dockerfiles](../apps/homevault/Dockerfile), [backend image](../apps/homevault-backend/Dockerfile), [Compose](../docker-compose.yml), [backup snapshotter](../services/backup/snapshot.py), [deployment](DEPLOYMENT.md) | Locked dependencies, delivered JS/WASM, transport, private ports, database copies, restore semantics and external keys |

HomeBridge's [source allowlist](../services/homebridge/src/app.js) excludes
HomeVault. Its automation capabilities permit only Monitor reads and Tasks
create-once, not Vault access. HomeAI/Vault integration is explicitly forbidden.
These restrictions do not establish general caller-app identity for browser JWTs.

## Format and intended trust boundary

- Shipped KDF parameters are `{m: 19456, t: 2, p: 1}`, with a 16-byte random
  salt and 32-byte derived master-key material. These are implementation facts,
  not a fresh recommendation or minimum-hardware benchmark. Verify parameter
  policy, units, browser behavior and dependency implementation independently.
- A random 256-bit vault key encrypts titles, JSON item data and the fixed
  verifier `homevault-verify-v1`. Each encryption generates a random 12-byte IV.
  Ciphertext/IV are base64; application code supplies no GCM `additionalData`
  or explicit `tagLength`. Review both cryptographic and contextual integrity.
- The master-derived key and a separate random 32-byte recovery key wrap the
  same vault key. Recovery uses raw key material, not a password KDF. Formatting
  encodes 32 bytes plus one CRC-8 byte as unpadded base32 in five-character
  groups. The checksum detects transcription errors; it is not authentication
  or extra entropy. Inspect lenient character filtering and accepted lengths.
- Generated **and unwrapped vault keys are extractable** so authorized client
  rewrapping works. Master/recovery wrapping-key imports remain non-extractable.
  This is not protection from script with access to an unlocked client.
  Derived byte arrays and password/clipboard/DOM strings are not guaranteed
  to be zeroized by JavaScript or garbage collection.
- The normal frontend sends public KDF parameters and ciphertext envelopes,
  never its master/recovery/vault keys or plaintext item fields, to Vault APIs.
  Core login credentials are separate plaintext inputs to the identity service
  over the chosen transport. Reusing the Core password as the master password
  weakens the claimed separation; assess UX and threat-model implications.
- The backend authenticates the owner and stores blobs. It checks nonempty
  strings and numeric KDF fields, **not** cryptographic correctness, canonical
  base64/IV sizes, bounded KDF work or proof of the master password. A stolen
  valid browser token can corrupt/delete that user's encrypted state even
  without decrypting it. An admin can reset the Core account credential and
  impersonate its session; that does not itself recover a distinct master key.
- Passive database theft/offline guessing and compromise limited to the blob
  API differ from a hostile server that changes the delivered Vault client.
  An allowed malicious client script can capture secrets during unlock.
  CSP and encryption do not make hostile delivered JavaScript trustworthy.

## Confirmed defect corrected during preparation

At the old baseline, `generateVaultKey()` returned an extractable key but
`unwrapVaultKey()` returned a non-extractable import. `wrapVaultKey()` then
called `exportKeyRaw()`. After reload/unlock, password change, recovery-kit
regeneration and recovery's new-password step failed with
`InvalidAccessError: key is not extractable`.

Two lifecycle regressions reproduced that failure before the product edit.
The fix imports **only the unwrapped vault key** with the same extractability
policy as creation. It changes no algorithm, envelope encoding, database row,
KDF default, stored ciphertext or wrapping-key policy. Review this explicit
choice and its client-compromise implications; do not confuse it with keeping
a secret out of memory or giving the server a key.

## Observations requiring independent disposition

These are scoped observations/questions, not an independent finding severity
or acceptance decision. Reviewer must decide what blocks real use.

| Area | Current behavior / question |
|---|---|
| Record/field binding and replay | GCM rejects wrong keys/modified bytes, but no AAD binds ciphertext to vault/item/field/type/version. Test valid same-vault ciphertext substitution, whole-record replay and rollback; existing bit-flip tests do not establish contextual integrity. |
| Rewrap versus revocation | Password change and kit regeneration leave the vault key unchanged. Old password/kit plus an old envelope can expose the same key, including for later items. Regeneration rejects the old kit against the **current** envelope only. A compromised data key is not revoked; data-key rotation is not implemented. |
| Recovery/parser limits | Check exact decoded key/IV/salt lengths, checksum behavior, normalization, malformed base64/JSON, finite/integer KDF limits and resource-exhaustion behavior. Backend shape checks are not complete format validation. |
| Key/plaintext lifetime | Probe lock/idle timer, tab visibility, refresh, sign-out, account switching, expiry while decrypting/saving, async completion after lock, React state and browser history/caches. Recovery clipboard clearing is best effort; item clipboard copy has no equivalent timed clear. |
| Entire shared origin | Inventory all sibling HTML/Markdown/URL sinks, CSP/WASM exceptions, same-origin script trust and fetch targets. `connect-src 'self'` does not prevent a malicious allowed script writing secrets to same-origin services. Generic manifest grants remain declarative. |
| Ownership and identity | Try foreign item/vault IDs, stale epochs/disabled users, admin impersonation and all Trash endpoints. Backend verification can cache success five seconds. Core account unlock and Vault master unlock are separate controls. |
| Recovery/deletion/backup UX | Verify loss before recovery-kit acknowledgment, copies/downloads, old kits/envelopes and restore. Whole-vault deletion includes Trash but is not secure erasure of SQLite pages, backups, exports or already-unlocked copies. No admin-facing Vault-reset endpoint exists today. |
| Errors and failure atomicity | Inspect response/log/DOM leakage, partial setup/rewrap/regeneration, corrupt envelopes/items, racing updates, network response loss and unsupported browsers. Assess which corruptions need repair/versioning rather than silent overwrite. |
| Supply chain and deployment | Review actual bundled hash-wasm/Web Crypto use and locked dependencies, build provenance, production CSP and transport. Loopback browser success is not LAN confidentiality, minimum-device performance or penetration testing. |

## Reproduce safely

Use a disposable checkout and only fabricated accounts/items. Do not copy a
real `.env`, database, recovery kit, master password or installation. Use Node
26 and the committed lockfile per [DEVELOPMENT.md](DEVELOPMENT.md).

```sh
node --version
git rev-parse HEAD
git status --short
npm ci
npm run test --workspace=apps/homevault
npm run test --workspace=apps/homevault-backend
npm run test --workspace=packages/homecore-client
npm run test --workspace=apps/homenotes
npm run build --workspace=apps/homevault
node apps/homevault/test-support/review-fixture.cjs
```

The fixture prints an ephemeral `http://127.0.0.1:<port>/vault/` URL. Its only
pre-created test account is `vault_reviewer` / `DisposableAccount123!`. It uses
real Core and Vault APIs with fresh temporary databases, never `.env` or an
installed data directory. It binds only loopback, applies the repository's
Vault CSP to built assets and has no TLS. **Core rate limiting is disabled by
the test helper**: use real disposable Compose services for deployment/rate-limit
review. This is a development fixture, never a production launcher or TLS proxy.

In the browser, use distinct dummy master/item secrets:

1. Set up a vault and save its dummy recovery kit; acknowledge it explicitly.
2. Create one item, record its ciphertext/IVs, reload, and unlock normally.
3. Change the master password and regenerate recovery. Confirm the item still
   decrypts without any item ciphertext rewrite.
4. Lock, recover with the new kit, set another master password, and reopen the
   same item. Test rejection of old credentials against the current envelope.
5. Separately retain an old dummy envelope and confirm the historical-wrapper
   limitation. Exercise Trash/restore/purge and whole-vault deletion on test data.
6. Inspect Vault request bodies, browser storage/DOM, logs, idle lock, account
   switching and failure paths. Keep all key material out of published artifacts.

Stop with Ctrl+C or `POST /__review__/stop` on the fixture origin; it closes
both services and removes its own temporary databases. Browser test evidence
must distinguish this fixture from the real nginx/Docker deployment.

## Evidence and its limits

| Evidence in this change | What it establishes / does not establish |
|---|---|
| [Crypto suite](../apps/homevault/test/crypto.test.js), 22 checks | Encoding, KDF determinism/smoke bound, random-IV behavior, wrong-key/bit-tamper refusal, two wrapping paths and newly covered post-unlock rewrapping. Not a KDF benchmark, proof of nonce uniqueness forever or external design review. |
| [Backend suites](../apps/homevault-backend/test), 35 checks | Real Core ownership/CRUD, Trash/cascade and legacy migration. Most existing envelope fixtures are placeholder strings, not real ciphertext. |
| [Real encrypted lifecycle](../apps/homevault-backend/test/rewrap.test.js), included above | Uses the frontend crypto library and shipped KDF defaults through real HTTP/SQLite. Preserves item ciphertext across rewrap/recovery. Client and servers share the test process; this is not process-memory isolation proof. |
| [Shared identity tests](../packages/homecore-client/test), 34 checks; [Notes frontend tests](../apps/homenotes/test), 16 checks | Specific auth/cache/failure, sanitizer and session regressions. Not all-sibling XSS or caller-app isolation proof. |
| Chromium browser exercise | At 1365px: actual setup, encrypted item, reload/unlock, password change, recovery regeneration, recovery/new password and original-item decryption with Vault CSP; observed Vault request bodies exclude tested plaintext. At 390px: Settings fits viewport; screenshot inspected. Not independent testing or a complete lifecycle/clipboard/session matrix. |
| Existing real-nginx/Docker gates | Gateway has 58 checks; CI rebuilds all seven frontends and boots disposable services. A green run is required for the exact candidate. It does not replace adversarial browser review or minimum-device Argon2id measurements. |

The KDF smoke test's generous ten-second ceiling is a CI hang guard, not a
hardware/UX performance claim. Fresh command results and CI commit/run links
belong in the change's PR; reviewers must rerun them on the pinned target.
Node runner totals include helper-file checks, not one attack scenario per
count. Direct `*.test.js` selection omits the backend's two helper-file checks.

## Reviewer deliverable and release gate

Return a report identifying reviewer, independence, exact commit/artifact hashes,
scope/exclusions, environment, procedures, findings with severity/reproduction,
affected confidentiality/integrity/availability assumptions and remediation.
For each observation above, record accepted risk with rationale, required fix,
or further evidence needed. Include residual shared-origin, active-client,
historical-wrapper, memory, metadata and backup risks explicitly.

Track remediations and retest the fixed commit; do not silently rewrite the
review target. Only the resulting independent report and its recorded disposition
can satisfy that prerequisite. Hardware KDF measurements and deployment/transport
requirements remain separate gates. Until then the roadmap review item stays
open, regardless of this packet, the local fix, passing tests or CI.
