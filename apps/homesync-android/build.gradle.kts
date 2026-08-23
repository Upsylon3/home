// Top-level build file — plugin versions declared here, applied per-module
// (just :app for now) below. Versions chosen are stable, well-established
// releases as of this writing; bump them freely, nothing here pins to an
// exact patch version for a reason that would break by updating.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("com.google.devtools.ksp") version "1.9.24-1.0.20" apply false
}
