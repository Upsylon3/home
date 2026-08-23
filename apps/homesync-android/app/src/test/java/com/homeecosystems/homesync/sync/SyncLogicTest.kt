package com.homeecosystems.homesync.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.MessageDigest

/**
 * Plain JVM unit tests (`./gradlew test`) — everything in SyncLogic.kt has
 * zero android.* / androidx.* imports specifically so it can be verified
 * this way, independent of an emulator or device. These exact assertions
 * (test vectors included) were compiled and run directly with kotlinc
 * during development, outside Gradle — see the project README for why
 * that distinction matters here.
 */
class SyncLogicTest {

    @Test
    fun `sha256 matches the known test vector for a short string`() {
        val hash = FileHasher.sha256(ByteArrayInputStream("hello world".toByteArray()))
        assertEquals("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", hash)
    }

    @Test
    fun `sha256 matches the well-known empty-input hash`() {
        val hash = FileHasher.sha256(ByteArrayInputStream(ByteArray(0)))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hash)
    }

    @Test
    fun `streaming hash matches a direct single-shot digest across a buffer boundary`() {
        val bigInput = ByteArray(200_000) { (it % 256).toByte() }
        val viaHasher = FileHasher.sha256(ByteArrayInputStream(bigInput))
        val viaDirectDigest = MessageDigest.getInstance("SHA-256").digest(bigInput).joinToString("") { "%02x".format(it) }
        assertEquals(viaDirectDigest, viaHasher)
    }

    @Test
    fun `planSync separates already-synced files from ones that need uploading`() {
        val candidate1 = CandidateFile("a", "photo1.jpg", "image/jpeg", 100, null, BackupCategory.PHOTOS)
        val candidate2 = CandidateFile("b", "photo2.jpg", "image/jpeg", 200, null, BackupCategory.PHOTOS)
        val hashed1 = HashedFile(candidate1, "hash-a")
        val hashed2 = HashedFile(candidate2, "hash-b")

        val plan = planSync(listOf(hashed1, hashed2), setOf("hash-a"))

        assertEquals(listOf(hashed1), plan.alreadySynced)
        assertEquals(listOf(hashed2), plan.toUpload)
    }

    @Test
    fun `planSync uploads everything when nothing is already synced`() {
        val hashed = HashedFile(CandidateFile("a", "x.jpg", "image/jpeg", 1, null, BackupCategory.PHOTOS), "hash-a")
        val plan = planSync(listOf(hashed), emptySet())
        assertEquals(1, plan.toUpload.size)
        assertTrue(plan.alreadySynced.isEmpty())
    }

    @Test
    fun `category wire values match homesync-backend's VALID_CATEGORIES exactly`() {
        assertEquals("Photos", BackupCategory.PHOTOS.toApiValue())
        assertEquals("Videos", BackupCategory.VIDEOS.toApiValue())
        assertEquals("Screenshots", BackupCategory.SCREENSHOTS.toApiValue())
        assertEquals("Downloads", BackupCategory.DOWNLOADS.toApiValue())
    }

    @Test
    fun `chunked respects the server's 500-item cap and preserves order`() {
        val items = (1..1204).toList()
        val chunks = chunked(items, 500)

        assertEquals(3, chunks.size)
        assertEquals(500, chunks[0].size)
        assertEquals(500, chunks[1].size)
        assertEquals(204, chunks[2].size)
        assertEquals(items, chunks.flatten())
    }
}
