package com.homeecosystems.homesync.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import java.util.concurrent.TimeUnit

/**
 * Owns all interaction with WorkManager so BackupWorker itself doesn't
 * need to know how it gets scheduled. Wi-Fi-only and charging-only map
 * directly onto WorkManager's native Constraints — this is deliberately
 * *not* hand-rolled scheduling logic; letting the OS own "when is it okay
 * to run this" is both less code and more correct than an app trying to
 * poll network/battery state itself.
 */
object BackupScheduler {

    private const val PERIODIC_INTERVAL_HOURS = 6L
    private const val MANUAL_WORK_NAME = "${BackupWorker.WORK_NAME}_manual"

    private fun buildConstraints(wifiOnly: Boolean, chargingOnly: Boolean) = Constraints.Builder()
        .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .setRequiresCharging(chargingOnly)
        .setRequiresBatteryNotLow(true)
        .build()

    /** Call whenever settings change (see HomeViewModel) — UPDATE policy means this safely replaces any existing schedule rather than stacking duplicates. */
    fun schedulePeriodic(context: Context, wifiOnly: Boolean, chargingOnly: Boolean) {
        val request = PeriodicWorkRequestBuilder<BackupWorker>(PERIODIC_INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(buildConstraints(wifiOnly, chargingOnly))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build()

        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(BackupWorker.WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * The "Back Up Now" button — still respects the Wi-Fi/charging
     * settings. An explicit "now" means "don't wait for the next
     * scheduled window," not "ignore my data and battery preferences,"
     * since silently burning mobile data because someone tapped a button
     * expecting it to just back up their photos would be a genuinely
     * unpleasant surprise on their next bill.
     */
    fun backupNow(context: Context, wifiOnly: Boolean, chargingOnly: Boolean) {
        val request = OneTimeWorkRequestBuilder<BackupWorker>()
            .setConstraints(buildConstraints(wifiOnly, chargingOnly))
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(MANUAL_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancelPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(BackupWorker.WORK_NAME)
    }

    /** For the Home screen's progress indicator while a manual run is active. */
    fun observeManualWork(context: Context) =
        WorkManager.getInstance(context).getWorkInfosForUniqueWorkLiveData(MANUAL_WORK_NAME)
}
