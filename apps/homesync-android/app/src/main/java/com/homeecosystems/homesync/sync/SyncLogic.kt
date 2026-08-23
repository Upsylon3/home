package com.homeecosystems.homesync.sync

import java.io.InputStream
import java.security.MessageDigest

/**
 * The category a candidate file falls into — mirrors exactly the four
 * values homesync-backend's /upload endpoint accepts (see
 * homesync-backend/src/sync.js's VALID_CATEGORIES). Kept as an enum here
 * so a typo can never reach the network layer; toApiValue() is the only
 * place the exact wire string is decided.
 */
enum class BackupCategory {
    PHOTOS, VIDEOS, SCREENSHOTS, DOWNLOADS;

    fun toApiValue(): String = when (this) {
        PHOTOS -> "Photos"
        VIDEOS -> "Videos"
        SCREENSHOTS -> "Screenshots"
        DOWNLOADS -> "Downloads"
    }
}

/** A file MediaScanner found on the device, before anything's been uploaded. */
data class CandidateFile(
    val localId: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val capturedAtEpochMs: Long?,
    val category: BackupCategory
)

/** Same file, once its content hash has been computed. */
data class HashedFile(
    val candidate: CandidateFile,
    val contentHash: String
)

/**
 * Streaming SHA-256 — deliberately reads in fixed-size chunks rather than
 * loading a whole video into memory at once, since backup candidates can
 * be several hundred MB.
 */
object FileHasher {
    private const val BUFFER_SIZE = 64 * 1024

    fun sha256(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

/**
 * Splits a hashed batch into "needs uploading" vs "server already has it",
 * given the server's /check response (see homesync-backend/src/sync.js).
 * Pure function — no network, no disk — so the actual upload loop can stay
 * simple and just iterate whatever this returns.
 */
data class SyncPlan(
    val toUpload: List<HashedFile>,
    val alreadySynced: List<HashedFile>
)

fun planSync(hashedFiles: List<HashedFile>, alreadySyncedHashes: Set<String>): SyncPlan {
    val toUpload = mutableListOf<HashedFile>()
    val alreadySynced = mutableListOf<HashedFile>()
    for (file in hashedFiles) {
        if (file.contentHash in alreadySyncedHashes) alreadySynced.add(file)
        else toUpload.add(file)
    }
    return SyncPlan(toUpload, alreadySynced)
}

/** /check is capped at 500 entries per call server-side — batch client-side to match. */
fun <T> chunked(items: List<T>, size: Int = 500): List<List<T>> {
    require(size > 0)
    return items.chunked(size)
}
