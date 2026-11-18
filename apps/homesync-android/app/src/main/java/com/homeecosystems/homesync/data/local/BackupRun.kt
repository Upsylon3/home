package com.homeecosystems.homesync.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Entity(
    tableName = "backup_runs",
    indices = [Index(value = ["destinationKey", "id"]), Index(value = ["workId", "destinationKey"])]
)
data class BackupRun(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val destinationKey: String,
    val workId: String,
    val manual: Boolean,
    val startedAt: Long,
    val finishedAt: Long? = null,
    val status: String = "RUNNING",
    val attempts: Int = 1,
    val uploaded: Int = 0,
    val skipped: Int = 0,
    val failed: Int = 0
)

@Dao
abstract class BackupRunDao {
    @Query("SELECT * FROM backup_runs WHERE destinationKey = :destinationKey ORDER BY id DESC LIMIT 20")
    abstract fun recent(destinationKey: String): Flow<List<BackupRun>>

    @Query("SELECT * FROM backup_runs WHERE workId = :workId AND destinationKey = :destinationKey AND finishedAt IS NULL ORDER BY id DESC LIMIT 1")
    protected abstract suspend fun openRun(workId: String, destinationKey: String): BackupRun?

    @Insert
    protected abstract suspend fun insert(run: BackupRun): Long

    @Query("UPDATE backup_runs SET status = 'RUNNING', attempts = attempts + 1, skipped = 0, failed = 0 WHERE id = :id")
    protected abstract suspend fun resume(id: Long)

    @Transaction
    open suspend fun begin(workId: String, destinationKey: String, manual: Boolean, now: Long): BackupRun {
        val existing = openRun(workId, destinationKey)
        if (existing != null) {
            resume(existing.id)
            return existing.copy(status = "RUNNING", attempts = existing.attempts + 1, skipped = 0, failed = 0)
        }
        val run = BackupRun(destinationKey = destinationKey, workId = workId, manual = manual, startedAt = now)
        return run.copy(id = insert(run))
    }

    @Query("UPDATE backup_runs SET status = :status, finishedAt = :finishedAt, uploaded = :uploaded, skipped = :skipped, failed = :failed WHERE id = :id AND finishedAt IS NULL")
    abstract suspend fun checkpoint(id: Long, status: String, finishedAt: Long?, uploaded: Int, skipped: Int, failed: Int)

    @Query("UPDATE backup_runs SET status = 'CANCELLED', finishedAt = :now WHERE workId = :workId AND finishedAt IS NULL")
    abstract suspend fun cancel(workId: String, now: Long)

    @Query("DELETE FROM backup_runs WHERE destinationKey = :destinationKey AND finishedAt IS NOT NULL AND id NOT IN (SELECT id FROM backup_runs WHERE destinationKey = :destinationKey AND finishedAt IS NOT NULL ORDER BY id DESC LIMIT 20)")
    abstract suspend fun prune(destinationKey: String)
}
