package com.homeecosystems.homesync

import android.os.Build
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.homeecosystems.homesync.data.destinationKey
import com.homeecosystems.homesync.data.local.AppDatabase
import com.homeecosystems.homesync.data.local.SyncedMediaEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DestinationLedgerMigrationTest {
    @Test fun upgradeRetainsLegacyRowsAndScopesNewBackups() = runBlocking {
        check(InstrumentationRegistry.getArguments().getString("homeFixture") == "disposable")
        check(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "ledger-migration-${UUID.randomUUID()}.db"
        // Exact v1 table/index from the shipped SyncedMediaEntity, including IDs.
        val old = FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(name).callback(object : SupportSQLiteOpenHelper.Callback(1) {
                override fun onCreate(db: SupportSQLiteDatabase) {
                    db.execSQL("CREATE TABLE synced_media (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, localMediaId TEXT NOT NULL, contentHash TEXT NOT NULL, category TEXT NOT NULL, sizeBytes INTEGER NOT NULL, uploadedAtEpochMs INTEGER NOT NULL)")
                    db.execSQL("CREATE UNIQUE INDEX index_synced_media_localMediaId ON synced_media(localMediaId)")
                }
                override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = error("Fixture is v1 only")
            }).build())
        old.writableDatabase.execSQL("INSERT INTO synced_media VALUES (41, 'images:1', 'legacy-hash', 'Photos', 123, 456)")
        old.close()
        val migrated = Room.databaseBuilder(context, AppDatabase::class.java, name)
            .addMigrations(AppDatabase.MIGRATION_1_2).build()
        try {
            // Opening Room runs both the real migration and generated schema validation.
            migrated.openHelper.writableDatabase.query("SELECT * FROM synced_media WHERE id=41").use { row ->
                assertTrue(row.moveToFirst())
                assertEquals("images:1", row.getString(row.getColumnIndexOrThrow("localMediaId")))
                assertEquals("legacy-hash", row.getString(row.getColumnIndexOrThrow("contentHash")))
                assertEquals("Photos", row.getString(row.getColumnIndexOrThrow("category")))
                assertEquals(123L, row.getLong(row.getColumnIndexOrThrow("sizeBytes")))
                assertEquals(456L, row.getLong(row.getColumnIndexOrThrow("uploadedAtEpochMs")))
                assertEquals("", row.getString(row.getColumnIndexOrThrow("destinationKey")))
            }
            val dao = migrated.syncedMediaDao()
            val a = destinationKey("http://a.test/", 1)
            val b = destinationKey("http://b.test/", 1)
            val otherAccount = destinationKey("http://a.test/", 2)
            assertEquals(1, dao.legacyCount())
            assertTrue(dao.allSyncedLocalIds(a).isEmpty())
            assertTrue(dao.allSyncedLocalIds("").isEmpty())
            for ((key, size) in listOf(a to 10L, b to 20L, otherAccount to 30L)) {
                dao.insert(SyncedMediaEntity(destinationKey = key, localMediaId = "images:1", contentHash = key,
                    category = "Photos", sizeBytes = size, uploadedAtEpochMs = size))
            }
            assertEquals(listOf("images:1"), dao.allSyncedLocalIds(a))
            assertEquals(1, dao.count(a))
            assertEquals(10L, dao.totalBytes(a))
            assertEquals(20L, dao.totalBytes(b))
            assertEquals(30L, dao.totalBytes(otherAccount))
            assertEquals(10L, dao.lastUploadedAtEpochMs(a))
            dao.insert(SyncedMediaEntity(destinationKey = a, localMediaId = "images:1", contentHash = "changed",
                category = "Photos", sizeBytes = 50, uploadedAtEpochMs = 60))
            assertEquals(1, dao.count(a))
            assertEquals(50L, dao.totalBytes(a))
            assertEquals(20L, dao.totalBytes(b))
            assertEquals(1, dao.legacyCount())
            migrated.openHelper.writableDatabase.query("SELECT MIN(id) FROM synced_media WHERE destinationKey != ''").use {
                assertTrue(it.moveToFirst()); assertTrue(it.getLong(0) > 41)
            }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}
