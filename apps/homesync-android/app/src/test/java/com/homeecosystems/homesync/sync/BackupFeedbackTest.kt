package com.homeecosystems.homesync.sync

import androidx.work.WorkInfo
import org.junit.Assert.*
import org.junit.Test

class BackupFeedbackTest {
    @Test fun `a queued request never claims it started or completed`() {
        val row = backupFeedback("id", "Manual", WorkInfo.State.ENQUEUED, 0)
        assertEquals("Queued", row.status)
        assertTrue(row.detail.contains("Waiting for Android"))
        assertTrue(row.active)
        assertFalse(row.running)
    }

    @Test fun `retry distinguishes backoff from a fresh request and retains completion limits`() {
        val row = backupFeedback("id", "Manual", WorkInfo.State.ENQUEUED, 3)
        assertEquals("Retry queued", row.status)
        assertTrue(row.detail.contains("Retry attempt 3"))
        assertTrue(row.detail.contains("successful files stay backed up"))
        assertEquals("Scheduled", backupFeedback("id", "Automatic", WorkInfo.State.ENQUEUED, 0).status)
    }

    @Test fun `running stages expose actual counts without claiming failed files completed`() {
        val row = backupFeedback("id", "Manual", WorkInfo.State.RUNNING, 0,
            "uploading", 10, 4, 3, 1)
        assertEquals("Uploading", row.status)
        assertTrue(row.running)
        assertTrue(row.detail.contains("4 uploaded"))
        assertTrue(row.detail.contains("3 already on server"))
        assertTrue(row.detail.contains("1 need retry"))
        assertTrue(row.detail.contains("10 discovered"))
        assertEquals("Checking file contents", backupFeedback("id", "Manual", WorkInfo.State.RUNNING, 0, "hashing").status)
    }

    @Test fun `terminal results distinguish permission failure cancellation and success`() {
        val denied = backupFeedback("id", "Manual", WorkInfo.State.FAILED, 0, reason = "media-permission-required")
        assertEquals("Failed", denied.status)
        assertTrue(denied.detail.contains("Review media access"))
        assertFalse(denied.active)
        assertTrue(backupFeedback("id", "Manual", WorkInfo.State.FAILED, 0,
            reason = "account-verification-required").detail.contains("verify this backup destination"))
        val cancelled = backupFeedback("id", "Manual", WorkInfo.State.CANCELLED, 0)
        assertTrue(cancelled.detail.contains("already received"))
        assertFalse(cancelled.active)
        val done = backupFeedback("id", "Manual", WorkInfo.State.SUCCEEDED, 0, "completed", 2, 1, 1)
        assertEquals("Completed", done.status)
        assertTrue(done.detail.contains("1 uploaded"))
        assertFalse(done.active)
    }

    @Test fun `older work without counters does not fabricate an empty successful run`() {
        val row = backupFeedback("id", "Manual", WorkInfo.State.SUCCEEDED, 0)
        assertEquals("No per-file counts were recorded for this run.", row.detail)
        assertEquals("Waiting for prerequisite work", backupFeedback("id", "Manual", WorkInfo.State.BLOCKED, 0).status)
    }
}
