package com.homeecosystems.homesync.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The app's one local database — currently just [SyncedMediaEntity], the
 * on-device record of what's already been backed up (see SyncedMediaDao's
 * header comment for why this exists alongside the server's own /check
 * endpoint rather than instead of it).
 *
 * Version 2 exports its schema and retains all v1 rows under the empty legacy
 * destination. The explicit migration never guesses an old row's owner/server.
 */
@Database(entities = [SyncedMediaEntity::class], version = 2, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {

    abstract fun syncedMediaDao(): SyncedMediaDao

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
                ).addMigrations(MIGRATION_1_2).build().also { INSTANCE = it }
            }
        }
    }
}
