# Android CI must test the declared toolchain

Date: 2026-11-02. Baseline: `188e0bd`.

## Observed failure and cause

- [PR 76](https://github.com/Upsylon3/home/pull/76) changes only the wrapper
  properties, from Gradle 9.3.1 to 9.8.2. Its Android run passed, but CI still
  explicitly installed and invoked **9.3.1**. That green check does not validate
  the proposed Gradle version.
- [PR 77](https://github.com/Upsylon3/home/pull/77) changes only AGP 9.1.1 to
  9.5.0. Its Android job fails with minimum supported Gradle **9.6.0**, current
  version **9.3.1**. Separate AGP/Gradle proposals cannot establish compatibility.

The checkout has wrapper properties but no wrapper script/jar, so CI installs
Gradle through setup-gradle and invokes `gradle` directly. Duplicating the version
in that action caused the false green. The prior migration synchronized those
values, but did not prevent future drift.

## Decision and proof

Read the version from the committed HomeSync wrapper properties before
setup-gradle. Pass that exact version as the action input; do not fall back to
the old CI version or a moving alias. The small Python helper accepts the current
official stable `services.gradle.org` bin/all distribution forms. Missing,
duplicate or unsupported declarations fail before setup; alternate formats
require explicit support rather than silently selecting another toolchain.

Five isolated Python tests cover changed wrapper versions (including PR 76's
9.8.2), normal properties/CRLF, all distributions, missing/duplicate declarations
and unsupported URLs/aliases. Android CI runs them before resolving its version.
Changes to the helper/tests also trigger Android CI. The full APK/unit-test job
must still pass with the selected version. No compile check is weakened.

Keep the validated AGP 9.1.1 / Gradle 9.3.1 / Kotlin-Compose 2.4.21 baseline.
Route AGP and Gradle **minor and major** upgrades through coordinated manual
assessment; patch proposals remain eligible for individual review and CI.
Other AndroidX updates remain unblocked. PRs 76/77 are deferred under this policy,
not accepted on the strength of the earlier green checks. No AGP/Gradle upgrade
or Kotlin compatibility claim is made here.

Rollback restores the old CI selection and therefore its known blind spot;
there is no application/data migration. Application settings and code remain
unchanged. The repository's normal gates and Android build remain required.

## Device validation remains separate

This session's local `emulator -accel-check` returned code 6 and reported that
the Android Emulator hypervisor driver is not installed. No personal AVD was
started or modified, and no driver/host virtualization setting was changed.
No suitable emulator run was established. Re-check readiness on a future host;
real-device/emulator sign-in, scheduling and backup remain open in roadmap item 2.
