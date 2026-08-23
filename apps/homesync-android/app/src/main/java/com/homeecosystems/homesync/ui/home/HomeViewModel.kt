package com.homeecosystems.homesync.ui.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.homeecosystems.homesync.data.BackupSettings
import com.homeecosystems.homesync.data.SettingsStore
import com.homeecosystems.homesync.data.api.ApiClient
import com.homeecosystems.homesync.data.api.HistorySummary
import com.homeecosystems.homesync.data.local.SyncedMediaDao
import com.homeecosystems.homesync.sync.BackupCategory
import com.homeecosystems.homesync.sync.BackupScheduler
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

data class HomeUiState(
    val settings: BackupSettings = BackupSettings(),
    val summary: HistorySummary? = null,
    val isRefreshing: Boolean = false,
    val message: String? = null
)

class HomeViewModel(
    private val appContext: Context,
    private val settingsStore: SettingsStore,
    private val apiClient: ApiClient,
    private val localDao: SyncedMediaDao
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            settingsStore.settings.collect { settings -> _uiState.update { it.copy(settings = settings) } }
        }
        refreshSummary()
    }

    /** Server first (the authoritative, all-devices total); falls back to the local cache if the server can't be reached right now — the summary card should still show *something* offline. */
    fun refreshSummary() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            val fromServer = runCatching { apiClient.getApi().history() }.getOrNull()
            val serverSummary = fromServer?.takeIf { it.isSuccessful }?.body()?.summary
            if (serverSummary != null) {
                _uiState.update { it.copy(summary = serverSummary, isRefreshing = false) }
                return@launch
            }

            val count = localDao.count()
            val bytes = localDao.totalBytes()
            val lastAtMs = localDao.lastUploadedAtEpochMs()
            _uiState.update {
                it.copy(
                    summary = HistorySummary(count, bytes, lastAtMs?.let { ms -> Instant.ofEpochMilli(ms).toString() }),
                    isRefreshing = false
                )
            }
        }
    }

    fun toggleCategory(category: BackupCategory, enabled: Boolean) {
        viewModelScope.launch {
            settingsStore.update { current ->
                when (category) {
                    BackupCategory.PHOTOS -> current.copy(photosEnabled = enabled)
                    BackupCategory.VIDEOS -> current.copy(videosEnabled = enabled)
                    BackupCategory.SCREENSHOTS -> current.copy(screenshotsEnabled = enabled)
                    BackupCategory.DOWNLOADS -> current.copy(downloadsEnabled = enabled)
                }
            }
            rescheduleIfNeeded()
        }
    }

    fun setWifiOnly(enabled: Boolean) = viewModelScope.launch {
        settingsStore.update { it.copy(wifiOnly = enabled) }
        rescheduleIfNeeded()
    }

    fun setChargingOnly(enabled: Boolean) = viewModelScope.launch {
        settingsStore.update { it.copy(chargingOnly = enabled) }
        rescheduleIfNeeded()
    }

    private suspend fun rescheduleIfNeeded() {
        val settings = settingsStore.current()
        if (settings.enabledCategories().isNotEmpty()) {
            BackupScheduler.schedulePeriodic(appContext, settings.wifiOnly, settings.chargingOnly)
        } else {
            BackupScheduler.cancelPeriodic(appContext)
        }
    }

    fun backUpNow() {
        val settings = _uiState.value.settings
        if (settings.enabledCategories().isEmpty()) {
            _uiState.update { it.copy(message = "Turn on at least one of Photos, Videos, Screenshots, or Downloads first.") }
            return
        }
        BackupScheduler.backupNow(appContext, settings.wifiOnly, settings.chargingOnly)
        _uiState.update { it.copy(message = "Backup started.") }
        viewModelScope.launch {
            delay(4000) // give it a moment to make progress before refreshing
            refreshSummary()
        }
    }

    fun messageShown() = _uiState.update { it.copy(message = null) }

    class Factory(
        private val appContext: Context,
        private val settingsStore: SettingsStore,
        private val apiClient: ApiClient,
        private val localDao: SyncedMediaDao
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            HomeViewModel(appContext, settingsStore, apiClient, localDao) as T
    }
}
