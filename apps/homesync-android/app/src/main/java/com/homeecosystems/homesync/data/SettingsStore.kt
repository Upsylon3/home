package com.homeecosystems.homesync.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

// A separate DataStore file from SessionManager's — deliberately: signing
// out shouldn't have any reason to touch backup preferences, and clearing
// SessionManager's file (see SessionManager.clearSession) can never
// accidentally wipe these out, because they're not in the same file to
// begin with.
private val Context.settingsDataStore by preferencesDataStore(name = "homesync_settings")

/**
 * Reads and writes the person's [BackupSettings] to disk via Jetpack
 * DataStore. This class only knows how to persist a `BackupSettings` —
 * it has no opinion on what any of the fields *mean*; that's
 * `BackupSettings.enabledCategories()`'s job, and BackupScheduler's job
 * for turning that into an actual WorkManager schedule.
 */
class SettingsStore(private val context: Context) {

    private object Keys {
        val PHOTOS = booleanPreferencesKey("photos_enabled")
        val VIDEOS = booleanPreferencesKey("videos_enabled")
        val SCREENSHOTS = booleanPreferencesKey("screenshots_enabled")
        val DOWNLOADS = booleanPreferencesKey("downloads_enabled")
        val WIFI_ONLY = booleanPreferencesKey("wifi_only")
        val CHARGING_ONLY = booleanPreferencesKey("charging_only")
    }

    /**
     * A live stream of settings. HomeViewModel `.collect()`s this in its
     * `init` block so the Home screen stays in sync with whatever changed
     * it — including, in principle, a change made somewhere else in the
     * app, not just through this exact ViewModel instance.
     *
     * Falling back to each field's own default (matching BackupSettings'
     * own defaults) when a key hasn't been written yet is what makes a
     * completely fresh install — before this DataStore file even exists
     * on disk — behave identically to one that's explicitly saved
     * "nothing enabled yet," rather than needing special first-run logic.
     */
    val settings: Flow<BackupSettings> = context.settingsDataStore.data.map { prefs ->
        BackupSettings(
            photosEnabled = prefs[Keys.PHOTOS] ?: false,
            videosEnabled = prefs[Keys.VIDEOS] ?: false,
            screenshotsEnabled = prefs[Keys.SCREENSHOTS] ?: false,
            downloadsEnabled = prefs[Keys.DOWNLOADS] ?: false,
            wifiOnly = prefs[Keys.WIFI_ONLY] ?: true,
            chargingOnly = prefs[Keys.CHARGING_ONLY] ?: false
        )
    }

    /**
     * A one-shot read of the current settings, for call sites that aren't
     * already `.collect()`-ing [settings] — BackupWorker (a single
     * background run, not a long-lived UI observer) and
     * HomeSyncApplication's startup check both use this instead.
     */
    suspend fun current(): BackupSettings = settings.first()

    /**
     * Reads the current settings, applies `transform`, writes the result
     * back — the same read-modify-write shape every setting-changing call
     * in HomeViewModel uses via `.copy(...)`, e.g.
     * `settingsStore.update { it.copy(wifiOnly = enabled) }`.
     */
    suspend fun update(transform: (BackupSettings) -> BackupSettings) {
        val next = transform(current())
        context.settingsDataStore.edit { prefs ->
            prefs[Keys.PHOTOS] = next.photosEnabled
            prefs[Keys.VIDEOS] = next.videosEnabled
            prefs[Keys.SCREENSHOTS] = next.screenshotsEnabled
            prefs[Keys.DOWNLOADS] = next.downloadsEnabled
            prefs[Keys.WIFI_ONLY] = next.wifiOnly
            prefs[Keys.CHARGING_ONLY] = next.chargingOnly
        }
    }
}
