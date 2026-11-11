package com.homeecosystems.homesync.sync

import android.content.Context
import android.os.Build
import androidx.work.workDataOf
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.homeecosystems.homesync.data.SessionManager
import com.homeecosystems.homesync.data.SettingsStore
import com.homeecosystems.homesync.data.api.ApiClient
import com.homeecosystems.homesync.data.api.CheckFileEntry
import com.homeecosystems.homesync.data.api.CheckRequest
import com.homeecosystems.homesync.data.api.HomeSyncApi
import com.homeecosystems.homesync.data.api.RegisterDeviceRequest
import com.homeecosystems.homesync.data.local.AppDatabase
import com.homeecosystems.homesync.data.local.SyncedMediaEntity
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import java.time.Instant
import kotlinx.coroutines.CancellationException
import java.io.IOException

/**
 * One backup run: scan → hash → ask the server what it's missing →
 * upload. Deliberately keeps going past a single file's failure (a
 * corrupt/unreadable file, one dropped connection) rather than aborting
 * the whole batch — the spec's own HomeSync lifecycle is "discover, queue,
 * upload, retry, resume, deduplicate, complete" per file, not
 * all-or-nothing. A file that fails just isn't recorded as synced, so the
 * next run (manual or scheduled) picks it up again automatically.
 *
 * True byte-range-resumable upload (picking a large video back up mid-way
 * after a dropped connection, rather than restarting it) is deliberately
 * not implemented — see the project README's HomeSync section for why
 * that's a real, separate piece of work rather than an oversight.
 */
class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val sessionManager = SessionManager(applicationContext)
    private val settingsStore = SettingsStore(applicationContext)
    private val apiClient = ApiClient(sessionManager)
    private val mediaScanner = MediaScanner(applicationContext)
    private val db = AppDatabase.getInstance(applicationContext)
    private var total = 0
    private var uploadedCount = 0
    private var matched = 0
    private var failed = 0

    private fun snapshot(phase: String, reason: String? = null) = workDataOf(
        "phase" to phase, "total" to total, "uploaded" to uploadedCount,
        "matched" to matched, "failed" to failed, "reason" to reason
    )
    private suspend fun report(phase: String) = setProgress(snapshot(phase))
    private fun completed() = Result.success(snapshot("completed"))

    override suspend fun doWork(): Result = try {
        backup()
    } catch (e: SecurityException) {
        permissionFailure()
    } catch (e: IOException) {
        Result.retry()
    }

    private fun permissionFailure() = Result.failure(snapshot("failed", "media-permission-required"))

    private suspend fun backup(): Result {
        sessionManager.initialize()
        if (!sessionManager.isSignedIn()) return Result.failure(snapshot("failed", "sign-in-required"))
        report("scanning")

        val settings = settingsStore.current()
        val categories = settings.enabledCategories()
        if (categories.isEmpty()) return completed()
        if (MediaAccess.current(applicationContext).blockedCategories(categories).isNotEmpty()) return permissionFailure()

        val api = apiClient.getApi()
        val deviceId = ensureDeviceId(api) ?: return Result.retry()

        val dao = db.syncedMediaDao()
        val alreadyKnownLocalIds = dao.allSyncedLocalIds().toSet()

        val candidates = mediaScanner.scan(categories).filter { it.localId !in alreadyKnownLocalIds }
        total = candidates.size
        if (candidates.isEmpty()) return completed()
        report("hashing")

        // Hashing is CPU-bound and needs no network — do it all up front,
        // so a flaky connection only affects the upload step below.
        val hashed = candidates.mapNotNull { candidate ->
            try {
                mediaScanner.openStream(candidate.localId)?.use { stream -> HashedFile(candidate, FileHasher.sha256(stream)) }
            } catch (e: SecurityException) {
                throw e
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null // File deleted or temporarily unreadable; try again next run.
            }
        }
        failed = candidates.size - hashed.size
        if (hashed.isEmpty()) return Result.retry()
        report("checking")

        // Covers cross-device dedup (see homesync-backend/src/sync.js) —
        // batched to respect its 500-entries-per-call cap.
        val alreadySyncedHashes = mutableSetOf<String>()
        for (batch in chunked(hashed, 500)) {
            val response = try {
                api.check(CheckRequest(batch.map { CheckFileEntry(it.contentHash, it.candidate.sizeBytes) }))
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { null }
            response?.body()?.results?.forEach { if (it.alreadySynced) alreadySyncedHashes += it.hash }
        }

        val plan = planSync(hashed, alreadySyncedHashes)

        // Server already has these (backed up from another device, most
        // likely) — record locally without re-uploading, so future runs
        // skip them too instead of re-checking every time.
        for (file in plan.alreadySynced) {
            dao.insert(file.toEntity())
            matched++
        }

        report("uploading")
        for (file in plan.toUpload) {
            val uploaded = try { uploadOne(api, deviceId, file) }
            catch (e: SecurityException) { throw e }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { false }
            if (uploaded) {
                dao.insert(file.toEntity())
                uploadedCount++
            } else {
                failed++
            }
            report("uploading")
        }

        // Only ask WorkManager to retry the whole run if something
        // actually failed — files that succeeded are already recorded and
        // won't be re-attempted regardless, so a partial success still
        // reports Result.retry() to pick up the rest, not Result.failure().
        return if (failed > 0) Result.retry() else completed()
    }

    private fun HashedFile.toEntity() = SyncedMediaEntity(
        localMediaId = candidate.localId,
        contentHash = contentHash,
        category = candidate.category.toApiValue(),
        sizeBytes = candidate.sizeBytes,
        uploadedAtEpochMs = System.currentTimeMillis()
    )

    private suspend fun ensureDeviceId(api: HomeSyncApi): Int? {
        sessionManager.deviceId.value?.let { return it }
        return try {
            val response = api.registerDevice(RegisterDeviceRequest(name = Build.MODEL ?: "Android device"))
            response.body()?.device?.id?.also { sessionManager.saveDeviceId(it) }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { null }
    }

    private suspend fun uploadOne(api: HomeSyncApi, deviceId: Int, file: HashedFile): Boolean {
        val length = file.candidate.sizeBytes
        val stream = mediaScanner.openStream(file.candidate.localId) ?: return false
        // Streams straight from the on-device file into the multipart body
        // rather than buffering it into a ByteArray first — buffering a
        // multi-hundred-MB video into memory on a phone is a real OOM risk
        // this specifically avoids. The stream is closed by writeTo() below.
        val body = streamingRequestBody(file.candidate.mimeType.toMediaTypeOrNull(), stream, length)
        val filePart = MultipartBody.Part.createFormData("file", file.candidate.displayName, body)
        val plainText = "text/plain".toMediaTypeOrNull()

        val response = api.upload(
            file = filePart,
            deviceId = deviceId.toString().toRequestBody(plainText),
            category = file.candidate.category.toApiValue().toRequestBody(plainText),
            contentHash = file.contentHash.toRequestBody(plainText),
            capturedAt = file.candidate.capturedAtEpochMs?.let { Instant.ofEpochMilli(it).toString().toRequestBody(plainText) }
        )
        return response.isSuccessful
    }

    companion object {
        const val WORK_NAME = "homesync_backup"
    }
}

private fun streamingRequestBody(contentType: okhttp3.MediaType?, inputStream: java.io.InputStream, length: Long): RequestBody =
    object : RequestBody() {
        override fun contentType() = contentType
        override fun contentLength() = length
        override fun writeTo(sink: BufferedSink) {
            inputStream.source().use { source -> sink.writeAll(source) }
        }
    }
