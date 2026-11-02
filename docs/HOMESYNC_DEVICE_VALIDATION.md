# HomeSync device validation

Roadmap item 2 needs an actual Android runtime, not just a successful compile.
The first reproducible target is a fresh API 34 Google APIs x86_64 Pixel 6
emulator on a disposable GitHub Ubuntu runner. The instrumented journeys are in
`BackupJourneyTest` and `PermissionDeniedJourneyTest`. The first
UI/WorkManager/upload journey was exercised on
2026-11-02; final workflow logs and evidence are linked from
[PR #79](https://github.com/Upsylon3/home/pull/79). A successful Android workflow
requires both instrumented tests and independent backend verification.
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
persistent limited-coverage warning; its policy has JVM coverage, but the
selected-photo picker itself is not exercised by this journey. Android app
settings provides recovery when Android stops showing permission prompts.
Disabling a blocked category allows other enabled categories to proceed.
Permission failures during scanning/opening are terminal worker failures;
permission revocation can also cause Android process termination, which this
test does not establish recovery from.

## Isolation and reproduction

The workflow boots Core, Cloud and Sync using existing integration helpers,
each with its own temporary SQLite/storage directory. It loads no dotenv or
installed account/data directory. Only fixed dummy credentials and synthetic
media are used. The fixture listens on 127.0.0.1:18083; `adb reverse` connects
the fresh emulator to that loopback service. The HTTP proxy preserves API paths;
it is not a real nginx/TLS deployment. Fixture rate limits are disabled.

The new test dependencies are Android-test-only Compose UI test support and
AndroidX permission rules and UI Automator 2.3.0, using the app's existing
Compose BOM. The emulator
action is pinned to a reviewed v2 commit. KVM permissions change only on the
ephemeral GitHub runner, never the developer's machine.

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

## Evidence limits that remain after a pass

One API 34 emulator is not a physical phone or a platform/device matrix.
The full-access journey uses explicit test grants; the separate denial/recovery
journey uses real system dialogs. Activity recreation
does not establish process-death or reboot recovery. No six-hour interval,
Doze, vendor background restriction, Wi-Fi loss, large-video transfer,
selected-photo picker, permanent-denial settings recovery, 2FA or
multiple-account journey is claimed by these tests. A physical
phone and those scenarios remain follow-up validation even after this first
emulator sign-in/backup journey passes.
