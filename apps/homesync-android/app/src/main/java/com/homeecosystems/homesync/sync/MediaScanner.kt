package com.homeecosystems.homesync.sync

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.InputStream

/**
 * Finds backup candidates on the device via MediaStore — Android's own
 * index of media, not a raw filesystem walk, so this respects scoped
 * storage correctly on every supported OS version rather than needing
 * broad filesystem permissions.
 *
 * Screenshots are technically stored as ordinary images, so they're
 * pulled from the same Images query as photos and split out by relative
 * path / filename convention (both fairly reliable heuristics, though
 * not something Android formally guarantees — a screenshot renamed or
 * saved somewhere unusual could be miscategorized as a regular photo;
 * a minor, low-stakes misclassification, not a correctness bug).
 */
class MediaScanner(private val context: Context) {

    fun scan(categories: Set<BackupCategory>): List<CandidateFile> {
        val results = mutableListOf<CandidateFile>()
        if (BackupCategory.PHOTOS in categories || BackupCategory.SCREENSHOTS in categories) {
            results += scanImages(
                wantPhotos = BackupCategory.PHOTOS in categories,
                wantScreenshots = BackupCategory.SCREENSHOTS in categories
            )
        }
        if (BackupCategory.VIDEOS in categories) {
            results += scanVideos()
        }
        if (BackupCategory.DOWNLOADS in categories) {
            results += scanDownloads()
        }
        return results
    }

    /** Reconstructs the content:// Uri for a candidate's localId (see the "store:id" format built below) so it can be opened for hashing/upload. */
    fun openStream(localId: String): InputStream? {
        val uri = uriFor(localId) ?: return null
        return context.contentResolver.openInputStream(uri)
    }

    private fun uriFor(localId: String): Uri? {
        val parts = localId.split(":", limit = 2)
        if (parts.size != 2) return null
        val id = parts[1].toLongOrNull() ?: return null
        return when (parts[0]) {
            "images" -> ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
            "video" -> ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
            "downloads" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id)
            } else null
            else -> null
        }
    }

    private fun scanImages(wantPhotos: Boolean, wantScreenshots: Boolean): List<CandidateFile> {
        val results = mutableListOf<CandidateFile>()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.RELATIVE_PATH
        )

        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_ADDED} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val dateTakenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol) ?: continue
                val relativePath = cursor.getString(pathCol) ?: ""
                val isScreenshot = relativePath.contains("Screenshot", ignoreCase = true) ||
                    name.startsWith("Screenshot", ignoreCase = true)

                if (isScreenshot && !wantScreenshots) continue
                if (!isScreenshot && !wantPhotos) continue

                // DATE_TAKEN is milliseconds and not always populated (depends on
                // whether the camera app/EXIF wrote it); DATE_ADDED is always
                // present but only second-precision — good enough for picking
                // which month folder a backup lands in.
                val capturedAtMs = cursor.getLong(dateTakenCol).takeIf { it > 0 }
                    ?: (cursor.getLong(dateAddedCol) * 1000)

                results += CandidateFile(
                    localId = "images:$id",
                    displayName = name,
                    mimeType = cursor.getString(mimeCol) ?: "image/*",
                    sizeBytes = cursor.getLong(sizeCol),
                    capturedAtEpochMs = capturedAtMs,
                    category = if (isScreenshot) BackupCategory.SCREENSHOTS else BackupCategory.PHOTOS
                )
            }
        }
        return results
    }

    private fun scanVideos(): List<CandidateFile> {
        val results = mutableListOf<CandidateFile>()
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.MIME_TYPE,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DATE_TAKEN,
            MediaStore.Video.Media.DATE_ADDED
        )

        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Video.Media.DATE_ADDED} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
            val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
            val dateTakenCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_TAKEN)
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol) ?: continue
                val capturedAtMs = cursor.getLong(dateTakenCol).takeIf { it > 0 }
                    ?: (cursor.getLong(dateAddedCol) * 1000)

                results += CandidateFile(
                    localId = "video:$id",
                    displayName = name,
                    mimeType = cursor.getString(mimeCol) ?: "video/*",
                    sizeBytes = cursor.getLong(sizeCol),
                    capturedAtEpochMs = capturedAtMs,
                    category = BackupCategory.VIDEOS
                )
            }
        }
        return results
    }

    /** MediaStore.Downloads only exists from API 29 (Android 10) — older devices simply don't get Downloads backup, matching the AndroidManifest's minSdk 26 supporting Photos/Videos/Screenshots universally. */
    private fun scanDownloads(): List<CandidateFile> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return emptyList()
        val results = mutableListOf<CandidateFile>()
        val projection = arrayOf(
            MediaStore.Downloads._ID,
            MediaStore.Downloads.DISPLAY_NAME,
            MediaStore.Downloads.MIME_TYPE,
            MediaStore.Downloads.SIZE,
            MediaStore.Downloads.DATE_ADDED
        )

        context.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Downloads.DATE_ADDED} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
            val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Downloads.MIME_TYPE)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Downloads.SIZE)
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DATE_ADDED)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol) ?: continue

                results += CandidateFile(
                    localId = "downloads:$id",
                    displayName = name,
                    mimeType = cursor.getString(mimeCol) ?: "application/octet-stream",
                    sizeBytes = cursor.getLong(sizeCol),
                    capturedAtEpochMs = cursor.getLong(dateAddedCol) * 1000,
                    category = BackupCategory.DOWNLOADS
                )
            }
        }
        return results
    }
}
