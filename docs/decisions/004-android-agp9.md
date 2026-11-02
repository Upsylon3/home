# HomeSync Android AGP 9 migration

Assessment date: 2026-11-02. Baseline: `8224f90`.
Scope: build toolchain migration; device validation remains open.

## Compatibility assessment

Use AGP **9.1.1**, Gradle **9.3.1**, JDK **17** and compile SDK **37**.
This is the smallest documented stable AGP line supporting API 37, rather
than an upgrade to every newest tool. The wrapper properties and CI must agree.

- [AGP 9.1.1 compatibility](https://developer.android.com/build/releases/agp-9-1-0-release-notes)
  specifies API 37 support, Gradle 9.3.1 and JDK 17.
- [Built-in Kotlin migration](https://developer.android.com/build/migrate-to-built-in-kotlin)
  requires removing `org.jetbrains.kotlin.android`. HomeSync has one application
  module, no KMP/kapt/custom AGP plugin, and already uses `compilerOptions`.
- [AGP's higher-KGP mechanism](https://developer.android.com/build/releases/agp-9-0-0-release-notes#runtime-dependency-on-kotlin-gradle-plugin)
  allows the root buildscript classpath to retain Kotlin **2.4.21**, aligned
  with the existing Compose compiler plugin. Simply removing kotlin-android
  would leave AGP's older default compiler in play; do not rely on that.
- [Kotlin compatibility](https://kotlinlang.org/docs/gradle-configure-project.html)
  lists Kotlin 2.4.20–2.4.21 support through Gradle 9.7.0 / AGP 9.3.1.
- [KSP releases](https://github.com/google/ksp/releases) include built-in-Kotlin
  fixes before the existing **2.3.12** release. Retain KSP 2.3.12 and all three
  Room **2.8.5** artifacts; compilation of generated DAO code remains a gate.

The old wrapper said 8.14.6 while CI ran 8.14.5; this change synchronizes them.
CI explicitly installs `platforms;android-37.0` and `build-tools;36.0.0` rather
than assuming the runner image contains the required SDK.

## Acceptance and compatibility boundaries

Require `:app:assembleDebug :app:testDebugUnitTest` in Android CI, including KSP,
Compose/resource compilation and a saved debug APK, plus all normal repository
gates. The existing JVM tests cover hashing/dedup behavior, not Android runtime
operation. Local absence of the matching JDK/Gradle/complete SDK is not a reason
to bypass CI or claim a local build happened.

Keep target SDK **34**, minimum SDK **26**, application id, version code/name,
permissions, backup constraints, Room schema and all application dependencies
unchanged. Raising compile SDK permits compilation against newer APIs; it does
not opt into new target-SDK behavior. No app installation, signing release,
personal database migration or real server access belongs to this task.

Lift only the AndroidX Dependabot restrictions imposed by AGP 8 / API 36
(Compose BOM, Navigation, Lifecycle and Core). Future library updates still
require their own Android build/test checks. Keep future AGP/Gradle majors and
the independent Retrofit/OkHttp major migration blocked.

## Rollback and remaining proof

Rollback reverts this coherent toolchain/CI/Dependabot change; no data or APK
upgrade was performed. Restore both Gradle version declarations together and
restore the old AndroidX restrictions. Do not opt out of built-in Kotlin or
silence compiler/SDK compatibility checks just to pass a build.

Even a green debug build leaves sign-in, permission prompts, WorkManager timing
and a complete backup on a real device/emulator unverified. Roadmap item 2 stays
open. A future target-SDK change and library refresh are separate tasks.
