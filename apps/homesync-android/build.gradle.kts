// Top-level build file — plugin versions declared here, applied per-module
// (just :app for now) below. Versions chosen are stable, well-established
// releases as of this writing; bump them freely, nothing here pins to an
// exact patch version for a reason that would break by updating.
//
// Deliberately held at the last AGP 8.x release (8.13) rather than AGP 9.x:
// AGP 9.0+ bundles its own built-in Kotlin support and conflicts with the
// separately-applied org.jetbrains.kotlin.android plugin below (a real,
// actively-reported breakage for exactly this plugin combination as of
// this writing). Revisit this once ecosystem plugins have caught up.
//
// Kotlin 2.0+ moved the Jetpack Compose compiler out of AGP and into its
// own Gradle plugin, versioned in lockstep with Kotlin itself — see the
// org.jetbrains.kotlin.plugin.compose line below and app/build.gradle.kts,
// where composeOptions { kotlinCompilerExtensionVersion = ... } has been
// removed accordingly (that mechanism no longer applies from Kotlin 2.0 on).
plugins {
    id("com.android.application") version "8.13.0" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.20" apply false
    id("com.google.devtools.ksp") version "2.3.10" apply false
}
