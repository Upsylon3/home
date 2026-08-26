package com.homeecosystems.homesync.data

import com.homeecosystems.homesync.sync.BackupCategory

/**
 * The person's backup preferences: which media categories to back up, and
 * under what conditions (Wi-Fi only, charging only). This class is just
 * plain, immutable data — it doesn't know how to save or load itself.
 * That's [SettingsStore]'s job, which reads/writes one of these to disk.
 * Keeping the two separate is what makes `.copy(...)` (see HomeViewModel's
 * toggleCategory/setWifiOnly/setChargingOnly) a safe, simple way to change
 * one field without needing to think about persistence at the same time.
 *
 * Defaults to nothing enabled: a fresh install should never start silently
 * uploading photos before the person has actually chosen to back anything
 * up. `wifiOnly` defaults to `true` for the same reason from the other
 * direction — better to require an explicit opt-in to using mobile data
 * than to surprise someone with a phone bill.
 */
data class BackupSettings(
    val photosEnabled: Boolean = false,
    val videosEnabled: Boolean = false,
    val screenshotsEnabled: Boolean = false,
    val downloadsEnabled: Boolean = false,
    val wifiOnly: Boolean = true,
    val chargingOnly: Boolean = false
) {
    /**
     * Which [BackupCategory] values are currently turned on. This is what
     * MediaScanner.scan() is given, and what HomeViewModel checks to
     * decide whether a periodic backup schedule should even exist right
     * now (see BackupScheduler.schedulePeriodic vs. cancelPeriodic).
     */
    fun enabledCategories(): Set<BackupCategory> {
        val result = mutableSetOf<BackupCategory>()
        if (photosEnabled) result.add(BackupCategory.PHOTOS)
        if (videosEnabled) result.add(BackupCategory.VIDEOS)
        if (screenshotsEnabled) result.add(BackupCategory.SCREENSHOTS)
        if (downloadsEnabled) result.add(BackupCategory.DOWNLOADS)
        return result
    }
}
