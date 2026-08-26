package com.homeecosystems.homesync.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * All database access for [SyncedMediaEntity] goes through here — Room
 * generates the actual implementation of this interface at compile time
 * from the `@Query` strings below, which is also why those strings are
 * checked against the real column names at compile time, not just
 * trusted to be correct.
 */
@Dao
interface SyncedMediaDao {

    /**
     * Everything BackupWorker needs to know before scanning: which
     * on-device files (by MediaScanner's localId) have already been
     * recorded as synced, so they can be filtered out of this run's
     * candidates before any hashing happens — see BackupWorker.doWork.
     */
    @Query("SELECT localMediaId FROM synced_media")
    suspend fun allSyncedLocalIds(): List<String>

    /**
     * REPLACE rather than the default ABORT: BackupWorker calls this for
     * both freshly-uploaded files and ones the server already had (see
     * doWork's "for (file in plan.alreadySynced)" loop) — a second insert
     * of the same localMediaId should just update the row, not crash a
     * whole backup run over what's really a harmless re-confirmation.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: SyncedMediaEntity)

    /** For the Home screen's offline summary fallback — see HomeViewModel.refreshSummary. */
    @Query("SELECT COUNT(*) FROM synced_media")
    suspend fun count(): Int

    /** COALESCE guards against SQL's SUM(...) returning NULL (not 0) over an empty table — a fresh install with nothing synced yet should report 0 bytes, not crash trying to unwrap a null Long. */
    @Query("SELECT COALESCE(SUM(sizeBytes), 0) FROM synced_media")
    suspend fun totalBytes(): Long

    /** Null on a fresh install (nothing synced yet) — HomeViewModel handles that directly rather than this DAO inventing a fake "never" timestamp. */
    @Query("SELECT MAX(uploadedAtEpochMs) FROM synced_media")
    suspend fun lastUploadedAtEpochMs(): Long?
}
