# HomeSync device validation

Roadmap item 2 needs an actual Android runtime, not just a successful compile.
The first reproducible target is a fresh API 34 Google APIs x86_64 Pixel 6
emulator on a disposable GitHub Ubuntu runner. The instrumented journeys are in
`BackupJourneyTest`, `PermissionDeniedJourneyTest` and
`SelectedPhotosJourneyTest`. The first
UI/WorkManager/upload journey was exercised on
2026-11-02; final workflow logs and evidence are linked from
[PR #79](https://github.com/Upsylon3/home/pull/79). A successful Android workflow
requires the full-access journey, both permission-recovery invocations and
the selected-photo journey, with independent backend verification.
The denial/full-grant recovery evidence is linked from
[PR #80](https://github.com/Upsylon3/home/pull/80).

## Journey and assertions

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

## Permission denial and recovery

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
Disabling a blocked category allows other enabled categories to proceed.
Permission failures during scanning/opening are terminal worker failures;
permission revocation can also cause Android process termination, which this
test does not establish recovery from.

## Permanent denial and Android Settings recovery

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
permission-flag mutation substitutes for these user actions. CI saves the
suppressed-request, Android Settings and recovered-app screenshots plus raw
instrumentation output; `OK (1 test)` and backend verification are both required.

This is API-34 emulator evidence for repeated-denial/settings recovery, not an
OS/vendor matrix or recovery from process termination during permission revocation.

## Selected-photo picker and exclusion boundary

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

CI retains initial and expanded picker/app screenshots, raw instrumentation/logcat, and shell seed
ownership/ID evidence. The foreign seed files are confined to the disposable
emulator and are removed when its AVD is destroyed. This covers an initial
selected-image grant, user-initiated expansion and immediate manual backup, not
selected videos, selection removal/replacement, grant expiration, process death
or a device/vendor matrix.

## Isolation and reproduction

The workflow boots Core, Cloud and Sync using existing integration helpers,
each with its own temporary SQLite/storage directory. It loads no dotenv or
installed account/data directory. Only fixed dummy credentials and synthetic
media are used. The fixture listens on 127.0.0.1:18083; `adb reverse` connects
the fresh emulator to that loopback service. The HTTP proxy preserves API paths;
it is not a real nginx/TLS deployment. Fixture rate limits are disabled.

The new test dependencies are Android-test-only Compose UI test support and
AndroidX permission rules and UI Automator 2.4.0, using the app's existing
Compose BOM. The emulator
action is pinned to a reviewed v2 commit. KVM permissions change only on the
ephemeral GitHub runner, never the developer's machine.

The UI Automator 2.4.0 update is reviewed in
[PR #81](https://github.com/Upsylon3/home/pull/81), roadmap item 8. The
[stable release notes](https://developer.android.com/jetpack/androidx/releases/test-uiautomator)
introduce optional Kotlin/window APIs and accessibility/gesture fixes; these
journeys retain their existing UiDevice/By API and assertions. Published Google
Maven AAR metadata for UI Automator and its Android shell helper require minimum
API 23, compile SDK 34 and AGP 8.1.1, below HOME's 26/37/9.1.1 baseline. The
[POM](https://dl.google.com/dl/android/maven2/androidx/test/uiautomator/uiautomator/2.4.0/uiautomator-2.4.0.pom)
adds the matching 2.4.0 shell helper, Kotlin 2.1.20, AndroidX Test Core 1.7.0 and
JSpecify 1.0.0; all remain in the instrumentation-test dependency graph. The
shell helper declares INTERNET for its local socket transport and UI Automator
declares an optional XR system library. Application dependencies, SDKs and
permissions are unchanged. A prior green run of the bot branch predates the
current Settings/picker journeys; all four current journeys must pass again
before accepting this update. Keeping new DSL adoption separate avoids changing
the test behavior at the same time as its dependency.


Run the Android workflow for a relevant PR or main commit. For a disposable,
already provisioned emulator and the fixture running on its host:

```bash
adb reverse tcp:18083 tcp:18083
cd apps/homesync-android
gradle --no-daemon --console=plain :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.homeFixture=disposable -Pandroid.testInstrumentationRunnerArguments.class=com.homeecosystems.homesync.BackupJourneyTest
curl -fsS http://127.0.0.1:18083/__fixture__/verify
```

For the separate denial journey, follow the fresh APK installation and
`am instrument` invocation in `.github/workflows/android.yml`; it checks the
runner's `OK (1 test)` output because `am instrument` can exit zero on a failed
JUnit test. `/__fixture__/denied-verify` independently checks its stored file.

Start the fixture from the repository root with Node 26:
`node apps/homesync-backend/test-support/android-fixture.cjs`.
Stop with Ctrl+C or POST `/__fixture__/stop`. Helpers remove only their owned
temporary directories. The test cancels its work, removes its synthetic media
and resets its emulator battery simulation. The screenshot is copied from a
shell-owned temporary path before the emulator is destroyed (app teardown can
remove app-owned files). Never point this protocol at a
personal device, AVD or real HOME deployment.

The disposable emulator has also exhibited a Pixel Launcher ANR covering a
permission window. The test records that exact launcher dialog in a screenshot
and diagnostic log, closes it, and still requires every HomeSync/system/backend
assertion. This handling is restricted to the exact Pixel Launcher error;
HomeSync errors are test failures.

## Evidence limits that remain after a pass

One API 34 emulator is not a physical phone or a platform/device matrix.
The full-access journey uses explicit test grants; the separate denial/recovery
journey uses real system dialogs. Activity recreation
does not establish process-death or reboot recovery. No six-hour interval,
Doze, vendor background restriction, Wi-Fi loss, large-video transfer,
selected videos, selection removal/replacement, grant expiration, 2FA or
multiple-account journey is claimed by these tests. A physical
phone and those scenarios remain follow-up validation even after this first
emulator sign-in/backup journey passes.
