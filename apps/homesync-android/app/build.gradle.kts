// Needed for JvmTarget.JVM_17 in the `kotlin { compilerOptions }` block at
// the bottom of the android section. Imports must come first in the file.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.homeecosystems.homesync"
    // Raised from 34 alongside the compose-bom bump below (newer Compose
    // releases assume a newer compileSdk to compile cleanly against).
    // targetSdk deliberately left at 34 — that's a runtime behavior
    // commitment (edge-to-edge enforcement, etc.) worth its own deliberate
    // pass with a real device, not a side effect of a dependency refresh.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.homeecosystems.homesync"
        minSdk = 26 // Android 8.0 — WorkManager's constraint set (unmetered/charging/battery-not-low) is fully reliable from here on
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false // enable + tune proguard-rules.pro once this has a real signing/release process
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // No composeOptions { kotlinCompilerExtensionVersion = ... } here —
    // from Kotlin 2.0 on, the Compose compiler ships as its own Gradle
    // plugin (applied above) versioned together with Kotlin itself.

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

// Which Java version the compiled Kotlin targets. This has to match
// compileOptions (17) above, or Gradle stops with an "Inconsistent
// JVM-target compatibility" error.
//
// This used to be `android { kotlinOptions { jvmTarget = "17" } }`. That
// form was deprecated for a long time and became a hard ERROR in Kotlin
// 2.3, which stopped this whole file from compiling, so nothing else in
// the app was even attempted. It only surfaced once the Android workflow
// (.github/workflows/android.yml) ran the build on a machine with the real
// toolchain: the 1.1.4 upgrade to Kotlin 2.3.20 had never been compiled.
// `compilerOptions` is the replacement Kotlin asks for.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    // Compose
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Classic Material Components — NOT the same as androidx.compose.material3
    // above. Compose's material3 artifact only provides Kotlin/Compose
    // theming (MaterialTheme, etc.); it ships none of the XML styles.
    // themes.xml's Theme.HomeSync inherits from Theme.Material3.DayNight.NoActionBar,
    // an XML resource, so this library has to be present too or AAPT
    // fails to link it.
    implementation("com.google.android.material:material:1.12.0")

    // WorkManager — background/constrained backup runs (Wi-Fi only,
    // charging only, battery threshold all map onto its native Constraints)
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Room — local cache of what's been backed up, for the History screen
    // and offline "last backup" summary without a network round trip.
    // KSP now defaults to KSP2 (independent versioning since KSP 2.3.0,
    // paired with Kotlin 2.3.20 above). If Room's annotation processing
    // errors out after this bump, add `ksp { useKsp2 = false }` here in
    // this file (or `ksp.useKSP2=false` in gradle.properties) to fall
    // back to KSP1 while a fix lands — this hasn't been build-verified
    // since it needs a real Android SDK/AAPT toolchain to compile.
    implementation("androidx.room:room-runtime:2.8.5")
    implementation("androidx.room:room-ktx:2.8.5")
    ksp("androidx.room:room-compiler:2.8.5")

    // DataStore — session token and backup settings (Wi-Fi only, charging
    // only, which categories are enabled)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Retrofit/OkHttp — talking to HomeCloud's auth API and HomeSync's own API
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
