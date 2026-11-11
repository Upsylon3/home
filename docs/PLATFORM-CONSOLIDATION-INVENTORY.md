# HOME platform consolidation — verified implementation inventory

This inventory records findings from repository source inspection on the
`docs/home-platform-consolidation` branch. It is **not** a passing
end-to-end validation report. Keep the original interfaces until the
replacement passes build, API, browser and device checks.

## Account authority and UI ownership

| Capability | Current implementation | Migration target | State |
| --- | --- | --- | --- |
| Authentication, password hashes, token version | `homecore/src/auth.js` | HomeCore | Already owned by Core |
| Password change and global logout | `/api/auth/change-password`, `/api/auth/logout-everywhere` | HOME Settings calling Core | HOME UI committed; tests pending |
| TOTP setup, confirmation, recovery, disable | `homecore/src/auth.js`; `apps/homecloud/src/components/TwoFactorSection.jsx` | HOME Settings calling Core | HOME UI committed; tests pending |
| Account display name | `/api/core/users/me` | HOME Settings | Already present |
| Sessions | `/api/core/users/me/sessions` | HOME Settings | Already present; error state improved |
| Cross-app personal activity | `/api/core/activity/me` returns `{events}` | HOME Settings | UI committed; tests pending |
| Admin users, roles, disabled status, reset password, 2FA recovery | `homecore/src/admin.js`, Cloud Admin UI | HOME admin controls calling Core | HOME UI committed; tests pending |
| Storage quotas | Core owns `quota_override`; Cloud backend measures actual usage | Core admin controls; Cloud storage view | HOME UI committed; tests pending |
| Cloud-specific activity | `/api/admin/activity` filters Cloud events | Cloud storage audit where useful | Retain until cross-app audit UX parity |
| Legacy Cloud account screens | `apps/homecloud/src/pages/Settings.jsx`, `Admin.jsx` | Redirect/compatibility after parity | Not removed |

### Security and compatibility checks before Cloud UI removal

- Confirm password-change token renewal and revocation of old sessions.
- Confirm an incorrect password on sensitive account operations does not
  erroneously log the user out; verify genuinely expired tokens still do.
- Confirm TOTP setup/confirm, recovery-code one-time display and rotation,
  disabling, and admin emergency reset against Core integration tests.
- Verify administrator role changes, last-admin protection, self-disable
  protection, account suspension, quota resets, and Core's graceful
  degradation when the Cloud usage endpoint is unavailable.
- Verify every account entry point and link in HOME, HomeCloud, other
  frontends, and mobile. Preserve stable routes during transition.
- Validate browser keyboard navigation, responsive layout and accessible
  feedback. Avoid displaying TOTP secrets or recovery codes in logs.

## Android and HomeSync migration blockers

| Source | Finding | Required remedy |
| --- | --- | --- |
| `apps/homesync-android` | Existing native Kotlin/Compose application and Android tests | Evolve in place; avoid a second client |
| `data/SessionManager.kt` | Single server URL, token and device ID in `homesync_session` | Per-server credentials/device identity and safe legacy migration |
| `data/local/SyncedMediaEntity.kt` | Unique `localMediaId` across all destinations | Destination-scoped uniqueness, schema migration and test fixtures |
| `data/local/AppDatabase.kt` | Room version 1, no exported schema | Explicit Room migration and migration tests; never destructive fallback |
| `sync/BackupWorker.kt` | Reads global session and global dedup history; single `homesync_backup` work name | Bind work to immutable server profile and isolate dedup/queues |
| `data/api/ApiClient.kt` | Token interceptor reads global active token | Prevent in-flight requests switching credentials across servers |

Do **not** enable multi-server backup simply by adding a server switcher:
existing globally keyed deduplication could incorrectly skip backup to a
second destination. Do not reset or delete backup history as a shortcut.

## Frontend audit: known concrete items

- HOME Settings previously lacked password, TOTP and general account
  administration; replacement interfaces now exist on the draft branch.
- HOME dashboard already consumes Core cross-app activity and app registry;
  avoid reimplementing these APIs.
- HomeCloud Settings and Admin still duplicate account-management UI.
  Keep them as compatibility paths until feature parity is verified.
- Cloud's storage usage is a domain-specific capability. Core can expose
  quota policy, but the Cloud backend remains the source of actual usage.
- A repository-wide route/control audit and browser verification are still
  required; this list is not an exhaustive defect inventory.

## Validation evidence

Updated 2026-11-11: HOME builds; 29 targeted Core tests and eight HOME API
regressions pass on Windows/Node 26.13.0. A real-Core headless Edge journey
passes password/token lifecycle, TOTP enrollment/retry/rotation/one-use recovery,
disable, account quotas/roles/suspension, member denial and 390px layout.
See [reproduction and limits](VALIDATION.md#unified-home-accounts). Earlier
"tests pending" table entries describe the initial handoff; these checks now
cover those flows except the remaining admin reset/navigation/audit proof.
No Android/device/deployment validation is claimed. Keep the draft status until
the final revision's applicable checks and remaining account proof pass.
