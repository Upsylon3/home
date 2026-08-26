package com.homeecosystems.homesync.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One row per file this device knows it has already backed up — the
 * local half of dedup (the other half being the server-side /check call;
 * see BackupWorker.doWork's comment on why both exist: this table lets a
 * backup run skip re-hashing/re-checking a file it already knows about,
 * while /check catches files backed up *from a different device*, which
 * this table can't know about on its own).
 *
 * [localMediaId] has a unique index because it's how BackupWorker filters
 * MediaScanner's results down to genuinely new candidates
 * (`dao.allSyncedLocalIds()` — see BackupWorker.doWork) — two rows for
 * the same on-device file would be a bug, not a valid state, so the
 * database itself refuses to allow it rather than relying on every call
 * site to check first.
 */
@Entity(
    tableName = "synced_media",
    indices = [androidx.room.Index(value = ["localMediaId"], unique = true)]
)
data class SyncedMediaEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    /** MediaScanner's own id format, e.g. "images:1234" — see MediaScanner.uriFor for how this gets turned back into a content:// Uri. */
    @ColumnInfo(name = "localMediaId")
    val localMediaId: String,

    /** The same SHA-256 hex string the server was told about via /check and /upload — see sync/SyncLogic.kt's FileHasher. */
    @ColumnInfo(name = "contentHash")
    val contentHash: String,

    /** One of BackupCategory's wire values ("Photos", "Videos", "Screenshots", "Downloads") — see BackupCategory.toApiValue(). */
    @ColumnInfo(name = "category")
    val category: String,

    @ColumnInfo(name = "sizeBytes")
    val sizeBytes: Long,

    @ColumnInfo(name = "uploadedAtEpochMs")
    val uploadedAtEpochMs: Long
)
