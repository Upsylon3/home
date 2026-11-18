package com.homeecosystems.homesync.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The app's local database stores [BackupRun] outcomes and [SyncedMediaEntity], the
 * on-device record of what's already been backed up (see SyncedMediaDao's
 * header comment for why this exists alongside the server's own /check
 * endpoint rather than instead of it).
 *
 * Version 2 retains unscoped v1 rows. Version 3 adds an optional media revision.
 * Existing scoped rows keep their confirmed hashes and recheck on the next scan.
 */
@Database(entities = [SyncedMediaEntity::class, BackupRun::class], version = 4, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {

    abstract fun syncedMediaDao(): SyncedMediaDao
    abstract fun backupRunDao(): BackupRunDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // v1 never recorded a destination. Retain every row and ID,
                // but never use an unproven legacy row to suppress a backup.
                db.execSQL("ALTER TABLE synced_media ADD COLUMN destinationKey TEXT NOT NULL DEFAULT ''")
                db.execSQL("DROP INDEX index_synced_media_localMediaId")
                db.execSQL("CREATE UNIQUE INDEX index_synced_media_destinationKey_localMediaId ON synced_media(destinationKey, localMediaId)")
            }
        }
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE synced_media ADD COLUMN sourceVersion TEXT")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, destinationKey TEXT NOT NULL, workId TEXT NOT NULL, manual INTEGER NOT NULL, startedAt INTEGER NOT NULL, finishedAt INTEGER, status TEXT NOT NULL, attempts INTEGER NOT NULL, uploaded INTEGER NOT NULL, skipped INTEGER NOT NULL, failed INTEGER NOT NULL)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_backup_runs_destinationKey_id ON backup_runs (destinationKey, id)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_backup_runs_workId_destinationKey ON backup_runs (workId, destinationKey)")
            }
        }

        // @Volatile + synchronized double-checked locking: the standard,
        // textbook way to make a lazily-created singleton safe when
        // multiple threads might call getInstance() at close to the same
        // time (a very real possibility here — MainActivity's UI thread
        // and a WorkManager background thread running BackupWorker can
        // both legitimately want a database instance around app startup).
        // Without @Volatile, one thread's write to INSTANCE isn't
        // guaranteed to be visible to another thread reading it — a
        // subtle bug that would only show up occasionally, which is
        // exactly the kind of bug worth preventing structurally rather
        // than hoping never happens.
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "homesync.db"
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4).build().also { INSTANCE = it }
            }
        }
    }
}
