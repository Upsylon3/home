# Validation

Outstanding review/device evidence and reproduction notes live here. Run fixtures
only against disposable data; never equate CI with independent or physical testing.

## Notes save safety

On 2026-11-11, the pre-fix demo reproduced lost text: type a title and immediately
select All Notes; reopening returned `Untitled`. Windows/Node 26.13.0 now passes
21 Notes tests, the production Notes build and the real-Core/Cloud/Notes Edge
browser fixture. Browser proof covers immediate navigation/save, failed-save
retention/retry, Back/keep-editing, deliberate queued-edit discard, sign-out
cancellation, failed-load retry and the beforeunload guard. The same editor
journey runs within the demo's browser regression with the hash router. Queue
tests prove serialized in-flight edits, newer-field precedence, merged text/tags
on retry and discard/unmount cancellation. The real-browser fixture injects only
the requested failures; normal saves use the real temporary Notes database.

~~~sh
npm test --workspace=apps/homenotes
npm run build --workspace=apps/homenotes
DEMO_BROWSER_CHANNEL=msedge node apps/homenotes/test-support/save-browser.cjs
~~~

Use PowerShell's `$env:DEMO_BROWSER_CHANNEL='msedge'` on Windows, or an installed
`chrome` channel elsewhere. Demo regression uses `npm run build:demo` followed
by `npm run test:demo:browser`. Drafts are memory-only: this proof does not claim
offline/crash recovery, multi-tab conflict resolution or mobile OS close prompts.

## Unified HOME accounts

On 2026-11-11, Node 26.13.0 on Windows passed the 29 Core auth/admin/route-alias
tests and eight HOME API regressions. The production HOME build passed. The
disposable real-Core browser fixture passed in headless Microsoft Edge: wrong
password/TOTP retry, password token renewal and old-token refusal, enrollment,
recovery rotation and one-use codes, disable 2FA, quota reset, role changes,
disable/re-enable, member admin denial, revoked-session logout and 390px layout.
The expanded journey also passes masked administrator password reset/session
revocation, emergency 2FA reset and last-admin protection. Production Cloud builds
and legacy settings/admin bookmarks pass navigation to HOME, retained storage
activity and unavailable/retry checks. All seven demo builds and the Edge demo
journey pass, including both Cloud-to-HOME hash-router account links.
The follow-up navigation pass also exercises Media/Notes/Tasks/Monitor settings
links to HOME in the demo, with 54 available frontend tests and all seven
production builds passing on the combined revision.
Cloud was unavailable during this fixture; account controls remained usable with
unknown storage usage. This does not establish real deployment/device readiness.

Reproduce after building HOME with Node 26 and an installed Playwright browser:

~~~sh
node --test homecore/test/auth.test.js homecore/test/admin.test.js homecore/test/routeAliases.test.js
npm test --workspace=apps/home
npm run build --workspace=apps/home
npm run build --workspace=apps/homecloud
DEMO_BROWSER_CHANNEL=msedge node apps/home/test-support/account-browser.cjs
~~~

Use `chrome` on CI/Linux or another installed supported channel. In PowerShell,
set `$env:DEMO_BROWSER_CHANNEL='msedge'` before the fixture. The fixture creates
only temporary accounts/databases and closes them on completion. Optional
`HOME_ACCOUNT_SCREENSHOT` writes a screenshot containing test data only.
Cloud authentication/API aliases remain; its legacy settings/admin routes now
retain storage-specific views and link to HOME. Local development uses the
separate HOME Vite server at `http://localhost:5174/settings` (sign in there if
needed); production shares the gateway origin and existing session. Rollback is
frontend-only: restore the previous Cloud UI with the same unchanged Core APIs.

## Multi-server pairing

The experimental opt-in has automated two-owner transcript approval, invitation
binding/race/reuse, partial activation, durable request/response replay and
semantic retry checks. Tests cover local reauthentication/2FA/role refusal,
credential type separation, capacity/expiry/clock rollback, generation suspension,
revocation during a remote request and durable notification retries after outages.
Malformed/duplicate JSON and changed issuer/audience/type/operation/generation
cannot authorize a peer. An older Core snapshot cannot restore external revoked
pin records. Existing local accounts and JWT sessions retain their behavior.
The committed [public v1 wire vector](../homecore/test/fixtures/peer-v1.json)
fixes exact offer, acceptance, transcript and status request/response bytes;
disposable signing keys were discarded and are not included.

Two real isolated Core processes complete the protocol over TLS with a disposable
CA, then check live status and revocation. Transport tests exercise certificate
hostname/trust failure, fixed routes, DNS pinning/connected-address mismatch,
private/mapped/reserved answers, mixed A/AAAA responses, redirects, oversized or
stalled responses, deadlines and capacity. The harness injects loopback DNS and
a fixture CA through test constructors. Runtime configuration has no private-IP,
TLS-verification or proxy bypass. These tests do not establish real public DNS,
router reachability, WAN outages or physical recovery.

Before enabling foreign account/resource access, obtain an independent protocol
and implementation security review, validate two separate public-HTTPS HOME
installations, and exercise key/origin rotation plus source and managed-runtime
restore/import/clone gates. Whole-state rollback still requires operator-enforced
recovery or independent non-rollback state. Windows authority ACL protection
remains an operator prerequisite. No guest account/resource access is implemented,
and no independent review or real installation drill is claimed here.

## Backup exports

The mounted-storage exporter has disposable tests for archive byte preservation,
SQLite restore checks, corrupted/truncated streams, failed writes/readback,
tampered inventories, unsafe paths and earlier-export preservation. Container
fixtures export all eight real-service archives and check owner-readable output
from a packaged installation with networking disabled. Launcher tests cover
Windows and Unix arguments, path boundaries and failure exits.

These checks use local disposable filesystems. Actual NAS/removable-drive mounts,
Windows/macOS Docker file-sharing permissions, network disconnects, full external
disks, filesystem durability and recovery on another physical machine remain
unvalidated. An existing destination path is not proof that the intended share
is still mounted or physically separate. Before relying on an export, verify
the real destination and rehearse a disposable restore with the offline credential
maintenance in [deployment](DEPLOYMENT.md#backups). Configuration backup remains
a separate requirement.

Coordinated snapshots add disposable complete-set/SQLite/Cloud restore tests,
source-mutation and interrupted-write rejection, marker/readiness/container
identity checks, and launcher failure recovery. Linux Docker fixtures exercise
the actual host barrier, restore all eight databases and compare related Core,
Notes and Cloud fixture data, while keeping a previously stopped service stopped.
These tests do not establish power-loss recovery, physical Windows/macOS Docker
behavior, real NAS/disconnect durability or recovery on another physical machine.

## Vault review

**Independent review remains open. Do not store real secrets yet.** Automated
tests, the implementation author and AI self-review cannot supply this approval.
Record the exact checkout SHA, clean/dirty status, lockfile and built-asset hashes,
Node/npm/OS/browser versions and scope with the report. Later changes need a
reviewed delta; approval of one commit is not approval of every build.

The current format, threat model and reset controls are in [SECURITY.md](SECURITY.md).
The earlier post-unlock rewrap defect was fixed by keeping unwrapped vault keys
extractable, matching generated keys; wrapping-key imports remain non-extractable.
This enables rewrap without changing existing ciphertext, but is not secure erasure
or protection from a compromised unlocked client. Review that choice explicitly.

### Scope and source map

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
| Administrator reset | [admin routes](../apps/homevault-backend/src/admin.js), [Home controls](../apps/home/src/components/VaultResetControls.jsx), [Vault reset controls](SECURITY.md#administrator-vault-reset) | Live Core verification, generation guard, confirmation, transactional local audit, retained-copy limits |
| Identity | [shared verifier](../packages/homecore-client/src/verify.js), [middleware](../packages/homecore-client/src/middleware.js), [Core auth](../homecore/src/auth.js), [Core auth middleware](../homecore/src/middleware/authMiddleware.js) | HS256/2FA/session epoch, current role/disable, five-second backend identity cache, retryable verification failure |
| Shared origin | [gateway](../gateway/nginx.conf), [Vault nginx](../apps/homevault/nginx.conf), [Notes sanitization](../apps/homenotes/src/markdown.js), [shared session](../design/session.js) | CSP and Vault-only WASM exception, all sibling script/rendering paths, token access, same-origin exfiltration paths |
| Build/deployment/backup | [lockfile](../package-lock.json), [Vault Dockerfiles](../apps/homevault/Dockerfile), [backend image](../apps/homevault-backend/Dockerfile), [Compose](../docker-compose.yml), [backup snapshotter](../services/backup/snapshot.py), [deployment](DEPLOYMENT.md) | Locked dependencies, delivered JS/WASM, transport, private ports, database copies, restore semantics and external keys |

HomeBridge's [source allowlist](../services/homebridge/src/app.js) excludes
HomeVault. Its automation capabilities permit only Monitor reads and Tasks
create-once, not Vault access. HomeAI/Vault integration is explicitly forbidden.
These restrictions do not establish general caller-app identity for browser JWTs.

### Observations requiring independent disposition

These are scoped observations/questions, not an independent finding severity
or acceptance decision. Reviewer must decide what blocks real use.

| Area | Current behavior / question |
|---|---|
| Record/field binding and replay | GCM rejects wrong keys/modified bytes, but no AAD binds ciphertext to vault/item/field/type/version. Test valid same-vault ciphertext substitution, whole-record replay and rollback; existing bit-flip tests do not establish contextual integrity. |
| Rewrap versus revocation | Password change and kit regeneration leave the vault key unchanged. Old password/kit plus an old envelope can expose the same key, including for later items. Regeneration rejects the old kit against the **current** envelope only. A compromised data key is not revoked; data-key rotation is not implemented. |
| Recovery/parser limits | Check exact decoded key/IV/salt lengths, checksum behavior, normalization, malformed base64/JSON, finite/integer KDF limits and resource-exhaustion behavior. Backend shape checks are not complete format validation. |
| Key/plaintext lifetime | Probe lock/idle timer, tab visibility, refresh, sign-out, account switching, expiry while decrypting/saving, async completion after lock, React state and browser history/caches. Recovery clipboard clearing is best effort; item clipboard copy has no equivalent timed clear. |
| Entire shared origin | Inventory all sibling HTML/Markdown/URL sinks, CSP/WASM exceptions, same-origin script trust and fetch targets. `connect-src 'self'` does not prevent a malicious allowed script writing secrets to same-origin services. Scoped application keys do not sandbox scripts holding the shared browser session. |
| Ownership and identity | Try foreign item/vault IDs, stale epochs/disabled users, admin impersonation and all Trash endpoints. Backend verification can cache success five seconds. Core account unlock and Vault master unlock are separate controls. |
| Recovery/deletion/backup UX | Verify loss before recovery-kit acknowledgment, copies/downloads, old kits/envelopes and restore. Whole-vault deletion includes Trash but is not secure erasure of SQLite pages, backups, exports or already-unlocked copies. Review the administrator reset in [Vault reset controls](SECURITY.md#administrator-vault-reset): live Core authority, explicit confirmation, exact vault generation and local audit; it does not revoke unlocked copies. |
| Errors and failure atomicity | Inspect response/log/DOM leakage, partial setup/rewrap/regeneration, corrupt envelopes/items, racing updates, network response loss and unsupported browsers. Assess which corruptions need repair/versioning rather than silent overwrite. |
| Supply chain and deployment | Review actual bundled hash-wasm/Web Crypto use and locked dependencies, build provenance, production CSP and transport. Loopback browser success is not LAN confidentiality, minimum-device performance or penetration testing. |

### Reproduce safely

Use a disposable checkout and only fabricated accounts/items. Do not copy a
real `.env`, database, recovery kit, master password or installation. Use Node
26 and the committed lockfile per [development](../CONTRIBUTING.md#development).

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

### Reviewer deliverable and release gate

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

## HomeSync

The retained BackupJourneyTest, PermissionDeniedJourneyTest and
SelectedPhotosJourneyTest exercise real Android/UI/worker boundaries. The
following assertions describe historical API-34 emulator proof, not current CI
execution or physical-phone certification.

### Journey and assertions

- Install the real debug app and instrument it through the real MainActivity
  Compose UI. Reject a wrong password, then sign in through HomeSync's auth
  proxy against a real temporary Core account.
- Confirm defaults enqueue no backup and upload nothing before category consent.
- Insert one synthetic, app-owned PNG through Android MediaStore. Enable the
  charging-only setting and Photos in the UI.
- Observe the six-hour periodic WorkManager request with its charging constraint.
  Cancel that periodic request in the test to avoid racing the manual upload.
  This verifies schedule creation, not delivery six hours later.
- Tap Back Up Now with the emulator reporting discharging: the actual queued
  WorkManager request must remain ENQUEUED and Cloud must have zero files.
- Restore charging. Require the real worker to succeed, passing through
  MediaStore scanning, SHA-256, device registration, server check, multipart
  upload, real Sync/Core/Cloud HTTP and actual Cloud file storage.
- Independently verify exact PNG bytes and SHA-256 in the temporary backend,
  with one file, sync row and device. Repeat manual backup and require another
  successful request without a second file (local-cache dedup).
- Recreate the Activity and verify the signed-in server-backed one-file summary.
  Save a screenshot and instrumentation reports as CI artifacts.

### Permission denial and recovery

The second journey installs the already-built app and test APKs using `adb
install -t` without `-g`, making the permission flags explicit.
It asserts media access starts denied, signs in as a separate temporary account
and uses UI Automator to deny the actual Android dialogs. Enabling Photos must
show a persistent blocked-access notice and disable Back Up Now. A directly
queued real worker must fail with `reason=media-permission-required` before
registering a device or uploading a file. Review media access must open the
system permission prompt; granting full access must restore the button and
produce an exact-byte/SHA-256 verified backup.

The app rereads OS grants on resume, after permission responses and before
manual/worker execution. Android 14 selected-only access remains usable with a
persistent limited-coverage warning; the selected-photo journey below exercises
the real picker and restricted image access. Android app
settings provides recovery when Android stops showing permission prompts;
the separate permanent-denial invocation exercises that path.
After tapping Allow all in Settings, the test waits up to ten seconds for the
actual OS grant before asserting it, capturing evidence and returning to the app.
The grant, resumed UI and byte-verified backup assertions remain required.
Disabling a blocked category allows other enabled categories to proceed.
Permission failures during scanning/opening are terminal worker failures;
permission revocation can also cause Android process termination, which this
test does not establish recovery from.

### Permanent denial and Android Settings recovery

[PR #82](https://github.com/Upsylon3/home/pull/82) adds a separate fresh install
and a third temporary account. `PermissionDeniedJourneyTest` runs again with
`permissionRecovery=settings`, retaining the original one-denial prompt recovery.
It denies the actual media dialogs twice, verifies rationale is no longer
available, then requests again and checks that no denial dialog appears and
backup remains disabled. Both the file and registered-device counts remain zero.

The test taps HomeSync's Android app settings control and uses UI Automator to
navigate Permissions > Photos and videos > Allow all in the actual system UI.
It verifies the OS grant, navigates back to HomeSync, and requires the warning
to disappear and Back Up Now to become enabled through the existing resume
refresh. A real manual worker must then upload the exact synthetic PNG, checked
independently at `/__fixture__/settings-verify`. No shell permission grant or
permission-flag mutation substitutes for these user actions. The historical run saved the
suppressed-request, Android Settings and recovered-app screenshots plus raw
instrumentation output; `OK (1 test)` and backend verification are both required.

This is API-34 emulator evidence for repeated-denial/settings recovery, not an
OS/vendor matrix or recovery from process termination during permission revocation.

### Selected-photo picker and exclusion boundary

The fourth invocation runs `SelectedPhotosJourneyTest` after a fresh install
without grants, using a fourth temporary account. Before installation,
`scripts/android-seed-picker-media.py` seeds three distinct synthetic PNGs through
the emulator shell and MediaScanner broadcast. It requires a disposable GitHub
emulator, records distinct MediaStore IDs and owner_package_name values outside
HomeSync, and verifies deterministic indexed file modification times. HomeSync never creates
these photos: app-owned photos would remain readable independently of the grant
and could not prove this boundary.

UI Automator chooses Select photos and videos in the actual permission dialog,
requires all three photo thumbnails, selects the newer brown image and confirms the
picker. Full image/video grants must remain denied while
READ_MEDIA_VISUAL_USER_SELECTED is granted. The real MediaScanner must return
only the selected filename; directly opening the known unselected image URI must
fail or return no stream. Enabling Photos must retain the limited-coverage notice
while allowing Back Up Now. A charging-constrained manual worker and repeat run
must store exactly the selected PNG with its SHA-256 and no duplicate or
unselected upload. `/__fixture__/picker-verify` checks the real backend separately.

After the original one-photo byte/hash verification, the test taps Review media
access, reopens the actual system picker and adds the green photo while leaving
the blue photo unselected. Full image/video grants remain denied. The scanner
must now expose exactly brown and green, and the blue URI must remain unreadable.
The limited-coverage notice and enabled manual-backup control persist. Backup
must upload the newly accessible photo, retain the original, and deduplicate a
repeat run. `/__fixture__/picker-reselection-verify` independently checks exactly
the two expected byte sequences and hashes, two sync rows and one device. The
original `/__fixture__/picker-verify` is required before expansion, preserving the
one-photo proof. Selection changes alone do not trigger an upload in this test.

The historical run retained initial and expanded picker/app screenshots, raw instrumentation/logcat, and shell seed
ownership/ID evidence. The foreign seed files are confined to the disposable
emulator and are removed when its AVD is destroyed. This covers an initial
selected-image grant, user-initiated expansion and immediate manual backup, not
selected videos, selection removal/replacement, grant expiration, process death
or a device/vendor matrix.

### Local reproduction and remaining limits

Current Android CI builds APKs/runs JVM tests only. Historical emulator evidence
is linked from PRs [79](https://github.com/Upsylon3/home/pull/79),
[80](https://github.com/Upsylon3/home/pull/80),
[82](https://github.com/Upsylon3/home/pull/82); consult the exact PR/run for provenance.
No current workflow schedules those instrumentation journeys.

Use only a fresh disposable API-34 emulator and temporary fixture services,
never a personal phone/AVD or real HOME. Start the fixture in its own terminal:

~~~sh
node apps/homesync-backend/test-support/android-fixture.cjs
~~~

It binds loopback port 18083, uses real Core/Cloud/Sync with temporary databases,
does not load dotenv and disables fixture rate limits. It is not nginx/TLS.
From an already provisioned disposable emulator host:

~~~sh
adb reverse tcp:18083 tcp:18083
cd apps/homesync-android
gradle --no-daemon --console=plain :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.homeFixture=disposable -Pandroid.testInstrumentationRunnerArguments.class=com.homeecosystems.homesync.BackupJourneyTest
curl -fsS http://127.0.0.1:18083/__fixture__/verify
~~~

For denial/picker cases, install app/test APKs fresh with `adb install -t`
without `-g`, then run the chosen class with `homeFixture=disposable`.
Run `PermissionDeniedJourneyTest` twice, using a separate fresh install and
`permissionRecovery=settings` for the permanent-denial case. Require both
instrumentation success (`OK (1 test)` when invoking `am instrument`) and
the corresponding `/__fixture__/denied-verify` or `settings-verify` endpoint:
a zero `am instrument` exit alone does not establish a pass.

The selected-photo case additionally requires three foreign-owned synthetic
images before installing the app. `scripts/android-seed-picker-media.py` is
intentionally restricted to a disposable GitHub emulator host; do not bypass its
guards for a personal device or assume the standalone class seeds those files.
Keep the initial `picker-verify` and expanded `picker-reselection-verify`
backend checks. Retain indexed ownership/IDs, instrumentation output, screenshots
and logcat with the exact source commit and environment.

Stop with Ctrl+C or POST `/__fixture__/stop`; helpers remove only their own
temporary data. Tests cancel their work and reset simulated battery state.
An exact Pixel Launcher ANR may be recorded/closed by the fixture; HomeSync
errors still fail the test.

API-34 emulator success does not establish physical-device/vendor behavior,
process-death/reboot recovery, Doze, six-hour delivery, Wi-Fi loss, large videos,
selected-video access, selection removal/replacement, grant expiration, 2FA or
multiple-account journeys. Activity recreation is not a reboot.


## Vault performance

Argon2id runs in the browser unlocking Vault, not on the storage server.
[Open the test](https://upsylon3.github.io/home/vault/benchmark.html), or use
`/vault/benchmark.html` on a build containing it. The 1.7.0 server bundle
predates this page; the online test needs no server or account.

### Use

Keep the page visible, close heavy background apps, label the device/browser
and power mode, then run the test. Reload between three runs. Export JSON only
if you want to keep/share results; do not put secrets in the device label.

It uses dummy input and production defaults (19 MiB, two iterations, one lane).
The first derivation is separate from seven following samples. It does not
read account/vault storage, call APIs, upload results or change encryption.
Theme preferences are read. Export includes browser hints and your label.

Stop takes effect after the current main-thread calculation. Hidden/cancelled
runs discard partial results. Timings exclude network, key unwrap, rendering
and full unlock time; a fresh page is not necessarily a cold browser start.

### Evidence

[Desktop observations](#desktop-observation) are not minimum-device certification.
Older Dell i3/i5-class PCs and S9/S10-class phones are provisional targets;
the owner's S20 FE is an available reference. Initial UX goals are a steady
median within one second and first call within two, not verified requirements.
Real target-device measurements remain open and are optional follow-up work.
Never lower KDF strength automatically to meet a timing goal. Independent
security review is a separate requirement.

### Developer commands

~~~bash
npm run build --workspace=apps/homevault
node apps/homevault/test-support/benchmark-browser.mjs
~~~

Pass a JSON output path to record three fresh-page local runs. The static fixture
uses the real gateway CSP and checks export, cancellation, mobile layout and
absence of session/API access. CI timing is not hardware evidence.

## Desktop observation

These are synthetic performance observations, not supported-hardware or
security certifications. See [the protocol](#vault-performance).

### 2026-11-04 — local Windows x64, headless Chromium

[Raw JSON report](#raw-desktop-report) records source revision
`7d9f944114960ce31a55cec1375c1fad4cc828f5`, with a clean source tree when
measured. Host-reported hardware: Intel Core i7-4790K, eight logical processors,
16 GiB RAM. Chromium 145.0.7632.6 ran headlessly without CPU throttling.
The synthetic page was visible; power mode, thermals and competing OS load
were not controlled or measured. These are not physical-phone observations.

| Fresh-page run | First measured derivation | Median of following seven | Following min–max |
|---|---:|---:|---:|
| 1 | 55.0 ms | 49.2 ms | 46.2–298.2 ms |
| 2 | 74.1 ms | 51.9 ms | 45.4–86.4 ms |
| 3 | 47.7 ms | 47.5 ms | 45.8–129.7 ms |

Each run uses the shipped `m=19456 KiB, t=2, p=1` and a fresh page. The same
browser process was reused, so compiled-code/OS caches may already be warm.
No first-call value is labelled a cold browser startup. Outliers are retained,
not discarded. Salt generation, network, key unwrapping, rendering and full
unlock latency are excluded. The test does not measure peak memory use.

Conclusion: the current defaults completed on this host under these conditions.
The owner subsequently identified old Dell office PCs and S9/S10-class phones
as provisional targets; the i7/16 GiB result does not certify those classes.
No minimum client class, phone performance or latency budget is certified.
Representative low-end browser tests and the independent security review
remain open. CI measurements must not be appended here as physical-device proof.

## Raw desktop report

Original exported values are preserved below, compacted without changing data.

~~~json
{"schema":1,"source":{"revision":"7d9f944114960ce31a55cec1375c1fad4cc828f5","workingTreeDirty":false},"execution":"Automated headless browser on the local host; foreground page, no CPU throttling. Not representative minimum hardware.","browserVersion":"145.0.7632.6","host":{"platform":"win32","architecture":"x64","cpuModel":"Intel(R) Core(TM) i7-4790K CPU @ 4.00GHz","logicalProcessors":8,"memoryGiB":16},"runs":[{"schema":1,"algorithm":"Argon2id","implementation":"hash-wasm / production deriveMasterKeyBits","execution":"browser-main-thread","kdfParams":{"m":19456,"t":2,"p":1},"saltBytes":16,"derivedKeyBytes":32,"measuredAt":"2026-11-04T13:51:36.829Z","firstDerivationMs":55,"steadyMs":[49.19999998807907,48.5,298.19999998807907,46.19999998807907,47.10000002384186,73.89999997615814,67.10000002384186],"summary":{"minMs":46.19999998807907,"medianMs":49.19999998807907,"maxMs":298.19999998807907},"packageVersion":"1.7.0","deviceLabel":"Automated browser check; not a minimum-device certification","runInPage":1,"browser":{"userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.7632.6 Safari/537.36","reportedLogicalProcessors":8,"reportedDeviceMemoryGiB":8},"scope":"Synthetic KDF timing only. Not total unlock time, a minimum-device certification, or a security review."},{"schema":1,"algorithm":"Argon2id","implementation":"hash-wasm / production deriveMasterKeyBits","execution":"browser-main-thread","kdfParams":{"m":19456,"t":2,"p":1},"saltBytes":16,"derivedKeyBytes":32,"measuredAt":"2026-11-04T13:51:38.332Z","firstDerivationMs":74.10000002384186,"steadyMs":[51.89999997615814,48.5,68.10000002384186,86.39999997615814,85.69999998807907,45.39999997615814,49.10000002384186],"summary":{"minMs":45.39999997615814,"medianMs":51.89999997615814,"maxMs":86.39999997615814},"packageVersion":"1.7.0","deviceLabel":"Automated browser check; not a minimum-device certification","runInPage":1,"browser":{"userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.7632.6 Safari/537.36","reportedLogicalProcessors":8,"reportedDeviceMemoryGiB":8},"scope":"Synthetic KDF timing only. Not total unlock time, a minimum-device certification, or a security review."},{"schema":1,"algorithm":"Argon2id","implementation":"hash-wasm / production deriveMasterKeyBits","execution":"browser-main-thread","kdfParams":{"m":19456,"t":2,"p":1},"saltBytes":16,"derivedKeyBytes":32,"measuredAt":"2026-11-04T13:51:39.756Z","firstDerivationMs":47.69999998807907,"steadyMs":[45.80000001192093,48.40000003576279,78.40000003576279,46.59999996423721,46.80000001192093,47.5,129.69999998807907],"summary":{"minMs":45.80000001192093,"medianMs":47.5,"maxMs":129.69999998807907},"packageVersion":"1.7.0","deviceLabel":"Automated browser check; not a minimum-device certification","runInPage":1,"browser":{"userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.7632.6 Safari/537.36","reportedLogicalProcessors":8,"reportedDeviceMemoryGiB":8},"scope":"Synthetic KDF timing only. Not total unlock time, a minimum-device certification, or a security review."}]}
~~~
