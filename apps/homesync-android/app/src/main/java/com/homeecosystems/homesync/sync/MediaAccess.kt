package com.homeecosystems.homesync.sync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

enum class MediaScope { NONE, SELECTED, FULL }

/** A live OS snapshot, never persisted: grants can change while the app is away. */
data class MediaAccess(val images: MediaScope = MediaScope.NONE, val videos: MediaScope = MediaScope.NONE) {
    fun blockedCategories(categories: Set<BackupCategory>) = categories.filter {
        when (it) {
            BackupCategory.PHOTOS, BackupCategory.SCREENSHOTS -> images == MediaScope.NONE
            BackupCategory.VIDEOS -> videos == MediaScope.NONE
            BackupCategory.DOWNLOADS -> false // Separate scoped-storage rules still apply.
        }
    }

    fun notice(categories: Set<BackupCategory>): String? {
        val blocked = blockedCategories(categories)
        if (blocked.isNotEmpty()) return "Media access is blocked for ${blocked.joinToString { it.toApiValue() }}. Allow access or turn off these categories before backing up."
        val selected = (images == MediaScope.SELECTED && categories.any { it == BackupCategory.PHOTOS || it == BackupCategory.SCREENSHOTS }) ||
            (videos == MediaScope.SELECTED && BackupCategory.VIDEOS in categories)
        return if (selected) "Only selected photos or videos can be backed up. Other media will not be backed up." else null
    }

    companion object {
        fun current(context: Context): MediaAccess {
            fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
            if (Build.VERSION.SDK_INT < 33) {
                val scope = if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) MediaScope.FULL else MediaScope.NONE
                return MediaAccess(scope, scope)
            }
            val partial = Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            fun scope(permission: String) = when {
                granted(permission) -> MediaScope.FULL
                partial -> MediaScope.SELECTED
                else -> MediaScope.NONE
            }
            return MediaAccess(scope(Manifest.permission.READ_MEDIA_IMAGES), scope(Manifest.permission.READ_MEDIA_VIDEO))
        }
    }
}
