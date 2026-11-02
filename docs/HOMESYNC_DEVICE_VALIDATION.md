# HomeSync device validation

Roadmap item 2 needs an actual Android runtime, not just a successful compile.
The first reproducible target is a fresh API 34 Google APIs x86_64 Pixel 6
emulator on a disposable GitHub Ubuntu runner. The instrumented journey is in
`BackupJourneyTest`; its result must come from the Android workflow. Until it
passes, this document is a protocol, not proof that the app ran successfully.

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

## Isolation and reproduction

The workflow boots Core, Cloud and Sync using existing integration helpers,
each with its own temporary SQLite/storage directory. It loads no dotenv or
installed account/data directory. Only fixed dummy credentials and synthetic
media are used. The fixture listens on 127.0.0.1:18083; `adb reverse` connects
the fresh emulator to that loopback service. The HTTP proxy preserves API paths;
it is not a real nginx/TLS deployment. Fixture rate limits are disabled.

The new test dependencies are Android-test-only Compose UI test support and
AndroidX permission rules, using the app's existing Compose BOM. The emulator
action is pinned to a reviewed v2 commit. KVM permissions change only on the
ephemeral GitHub runner, never the developer's machine.

Run the Android workflow for a relevant PR or main commit. For a disposable,
already provisioned emulator and the fixture running on its host:

```bash
adb reverse tcp:18083 tcp:18083
cd apps/homesync-android
gradle --no-daemon --console=plain :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.homeFixture=disposable
curl -fsS http://127.0.0.1:18083/__fixture__/verify
```

Start the fixture from the repository root with Node 26:
`node apps/homesync-backend/test-support/android-fixture.cjs`.
Stop with Ctrl+C or POST `/__fixture__/stop`. Helpers remove only their owned
temporary directories. The test cancels its work, removes its synthetic media
and resets its emulator battery simulation. Never point this protocol at a
personal device, AVD or real HOME deployment.

## Evidence limits that remain after a pass

One API 34 emulator is not a physical phone or a platform/device matrix.
Permission dialogs are bypassed with explicit test grants. Activity recreation
does not establish process-death or reboot recovery. No six-hour interval,
Doze, vendor background restriction, Wi-Fi loss, large-video transfer, denied
permission, 2FA or multiple-account journey is claimed by this test. A physical
phone and those scenarios remain follow-up validation even after this first
emulator sign-in/backup journey passes.
