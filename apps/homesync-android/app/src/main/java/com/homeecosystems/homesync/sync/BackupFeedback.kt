package com.homeecosystems.homesync.sync

import androidx.work.WorkInfo

data class BackupFeedback(val id: String, val kind: String, val status: String, val detail: String, val active: Boolean, val running: Boolean)

/** State comes from WorkManager, never from the button requesting work. */
fun backupFeedback(
    id: String, kind: String, state: WorkInfo.State, attempt: Int,
    phase: String? = null, total: Int = 0, uploaded: Int = 0,
    matched: Int = 0, failed: Int = 0, reason: String? = null
): BackupFeedback {
    val counts = "$uploaded uploaded · $matched already on server · $failed need retry · $total discovered"
    val status = when (state) {
        WorkInfo.State.RUNNING -> when (phase) {
            "scanning" -> "Scanning"
            "hashing" -> "Checking file contents"
            "checking" -> "Checking server copies"
            "uploading" -> "Uploading"
            else -> "Running"
        }
        WorkInfo.State.ENQUEUED -> if (attempt > 0) "Retry queued" else if (kind == "Automatic") "Scheduled" else "Queued"
        WorkInfo.State.BLOCKED -> "Waiting for prerequisite work"
        WorkInfo.State.SUCCEEDED -> "Completed"
        WorkInfo.State.FAILED -> "Failed"
        WorkInfo.State.CANCELLED -> "Cancelled"
    }
    val detail = when (state) {
        WorkInfo.State.ENQUEUED -> "Waiting for Android scheduling, network and battery/charging requirements." +
            if (attempt > 0) " Retry attempt $attempt; successful files stay backed up." else ""
        WorkInfo.State.BLOCKED -> "Android has not started this work."
        WorkInfo.State.FAILED -> when (reason) {
            "media-permission-required" -> "Review media access before trying again."
            "sign-in-required" -> "Sign in before trying again."
            else -> "The run could not finish. Review access and connection, then try again."
        }
        WorkInfo.State.CANCELLED -> "Work was cancelled; files already received by the server are kept."
        else -> if (phase == null) "No per-file counts were recorded for this run." else counts
    }
    return BackupFeedback(id, kind, status, detail, !state.isFinished, state == WorkInfo.State.RUNNING)
}
