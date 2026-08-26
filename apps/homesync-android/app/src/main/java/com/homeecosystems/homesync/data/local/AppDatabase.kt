package com.homeecosystems.homesync.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * The app's one local database — currently just [SyncedMediaEntity], the
 * on-device record of what's already been backed up (see SyncedMediaDao's
 * header comment for why this exists alongside the server's own /check
 * endpoint rather than instead of it).
 *
 * `exportSchema = false`: schema export (writing a JSON snapshot of the
 * table structure to disk on every build, for verifying migrations later)
 * is genuinely useful once this app has shipped and needs real migrations
 * between versions — not yet, for a version-1 schema with no released
 * users to migrate. Turn it on together with adding a real migration the
 * first time this schema actually changes.
 */
@Database(entities = [SyncedMediaEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {

    abstract fun syncedMediaDao(): SyncedMediaDao

    companion object {
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
                ).build().also { INSTANCE = it }
            }
        }
    }
}
