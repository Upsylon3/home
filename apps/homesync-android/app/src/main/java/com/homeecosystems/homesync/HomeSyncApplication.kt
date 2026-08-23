package com.homeecosystems.homesync

import android.app.Application
import com.homeecosystems.homesync.data.SessionManager
import com.homeecosystems.homesync.data.SettingsStore
import com.homeecosystems.homesync.data.api.ApiClient
import com.homeecosystems.homesync.sync.BackupScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * A plain manual service locator rather than Hilt/Dagger — deliberately:
 * fewer moving parts, no annotation-processor step to get subtly wrong in
 * an environment where it can't be verified by actually building the
 * project (see the project README's HomeSync section). Small enough here
 * that the usual case for a DI framework — a large graph of interdependent
 * objects — doesn't really apply yet.
 */
class HomeSyncApplication : Application() {

    lateinit var sessionManager: SessionManager
        private set
    lateinit var settingsStore: SettingsStore
        private set
    lateinit var apiClient: ApiClient
        private set

    override fun onCreate() {
        super.onCreate()
        sessionManager = SessionManager(this)
        settingsStore = SettingsStore(this)
        apiClient = ApiClient(sessionManager)

        // Re-arms the periodic backup schedule on process start (covers a
        // freshly relaunched process after the OS killed it, or a device
        // reboot — see AndroidManifest's RECEIVE_BOOT_COMPLETED). A no-op
        // if nobody's signed in yet.
        CoroutineScope(Dispatchers.IO).launch {
            sessionManager.initialize()
            if (sessionManager.isSignedIn()) {
                val settings = settingsStore.current()
                if (settings.enabledCategories().isNotEmpty()) {
                    BackupScheduler.schedulePeriodic(this@HomeSyncApplication, settings.wifiOnly, settings.chargingOnly)
                }
            }
        }
    }
}
