package com.homeecosystems.homesync.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.homeecosystems.homesync.sync.BackupCategory
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun HomeScreen(viewModelFactory: HomeViewModel.Factory) {
    val viewModel: HomeViewModel = viewModel(factory = viewModelFactory)
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.message) {
        // A real app would surface this via a Snackbar (needs a
        // Scaffold+SnackbarHostState at the MainActivity level to do
        // properly) — left as plain state for now since the messaging
        // itself, not its presentation chrome, is what matters here.
        if (state.message != null) {
            delay(2500)
            viewModel.messageShown()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        Text("HomeSync", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Automatic phone backup",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 20.dp)
        )

        LastBackupCard(state)

        state.message?.let {
            Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 12.dp))
        }

        Button(
            onClick = viewModel::backUpNow,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp, bottom = 24.dp)
        ) {
            Text("Back Up Now")
        }

        Text("What to back up", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
        CategoryToggleRow("Photos", state.settings.photosEnabled) { viewModel.toggleCategory(BackupCategory.PHOTOS, it) }
        CategoryToggleRow("Videos", state.settings.videosEnabled) { viewModel.toggleCategory(BackupCategory.VIDEOS, it) }
        CategoryToggleRow("Screenshots", state.settings.screenshotsEnabled) { viewModel.toggleCategory(BackupCategory.SCREENSHOTS, it) }
        CategoryToggleRow("Downloads", state.settings.downloadsEnabled) { viewModel.toggleCategory(BackupCategory.DOWNLOADS, it) }

        Text(
            "When to back up",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 20.dp, bottom = 8.dp)
        )
        CategoryToggleRow("Wi-Fi only", state.settings.wifiOnly, viewModel::setWifiOnly)
        CategoryToggleRow("Only while charging", state.settings.chargingOnly, viewModel::setChargingOnly)
    }
}

@Composable
private fun LastBackupCard(state: HomeUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Last backup", style = MaterialTheme.typography.titleMedium)
            val summary = state.summary
            if (summary == null || summary.fileCount == 0) {
                Text(
                    "No backups yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp)
                )
            } else {
                Text(
                    "${summary.fileCount} files • ${formatBytes(summary.totalBytes)}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 4.dp)
                )
                summary.lastSyncedAt?.let {
                    Text(
                        formatTimestamp(it),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun CategoryToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unitIndex = 0
    while (value >= 1024 && unitIndex < units.size - 1) {
        value /= 1024
        unitIndex++
    }
    return if (unitIndex == 0) "${value.toInt()} ${units[unitIndex]}" else "%.1f %s".format(value, units[unitIndex])
}

/**
 * homesync-backend's timestamps come straight from SQLite's
 * `datetime('now')` — "YYYY-MM-DD HH:MM:SS", space-separated, no
 * timezone suffix, implicitly UTC — not the "2026-08-14T12:30:00Z" shape
 * `Instant.parse()` expects. Parsed explicitly against that actual
 * format instead, rather than assuming standard ISO-8601.
 */
private fun formatTimestamp(raw: String): String = try {
    val sqliteFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
    val utcInstant = LocalDateTime.parse(raw, sqliteFormat).atZone(ZoneOffset.UTC).toInstant()
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
        .withZone(ZoneId.systemDefault())
        .format(utcInstant)
} catch (e: Exception) {
    raw
}
