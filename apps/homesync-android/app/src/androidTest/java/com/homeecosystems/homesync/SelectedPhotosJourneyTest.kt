package com.homeecosystems.homesync

import android.Manifest
import android.content.ContentUris
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.homeecosystems.homesync.sync.BackupCategory
import com.homeecosystems.homesync.sync.BackupWorker
import com.homeecosystems.homesync.sync.MediaAccess
import com.homeecosystems.homesync.sync.MediaScanner
import com.homeecosystems.homesync.sync.MediaScope
import com.homeecosystems.homesync.ui.MainActivity
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SelectedPhotosJourneyTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device get() = UiDevice.getInstance(instrumentation)
    private fun id(name: String) = By.res(Pattern.compile(".*:id/$name"))
    private fun waitFor(condition: () -> Boolean) = compose.waitUntil(120_000, condition)

    @Test fun onlySelectedForeignPhotoIsBackedUp() {
        check(InstrumentationRegistry.getArguments().getString("homeFixture") == "disposable")
        check(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"))
        val context = instrumentation.targetContext
        val wm = WorkManager.getInstance(context)
        fun permission(name: String) = ContextCompat.checkSelfPermission(context, name)
        fun work() = wm.getWorkInfosForUniqueWork("${BackupWorker.WORK_NAME}_manual").get(5, TimeUnit.SECONDS).single()
        try {
            assertEquals(PackageManager.PERMISSION_DENIED, permission(Manifest.permission.READ_MEDIA_IMAGES))
            assertEquals(PackageManager.PERMISSION_DENIED, permission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED))
            waitFor { compose.onAllNodesWithText("Server address").fetchSemanticsNodes().isNotEmpty() }
            fun enter(label: String, value: String) = compose.onNode(hasSetTextAction() and hasText(label)).performTextReplacement(value)
            enter("Server address", "127.0.0.1:18083")
            enter("Username", "emulator_picker")
            enter("Password", "DisposableEmulator123!")
            compose.onNodeWithText("Sign in").performClick()
            waitFor { (context.applicationContext as HomeSyncApplication).sessionManager.isSignedIn() }
            compose.waitForIdle()
            waitFor {
                dismissLauncherAnr()
                dismissNotificationPrompt()
                device.hasObject(id("permission_allow_selected_button"))
            }
            device.findObject(id("permission_allow_selected_button")).click()
            // The shell seed records owner_package_name and distinct IDs, with
            // the expected selected photo newest by date_taken. Both must show.
            waitFor { device.findObjects(id("icon_thumbnail")).size == 2 }
            val photos = device.findObjects(id("icon_thumbnail")).sortedWith(compareBy({ it.visibleBounds.top }, { it.visibleBounds.left }))
            photos.first().click()
            shell("screencap -p /data/local/tmp/homesync-picker-selection.png")
            waitFor { device.hasObject(id("button_add")) }
            device.findObject(id("button_add")).click()
            repeat(3) {
                try { compose.waitUntil(2_000) { dismissLauncherAnr(); dismissNotificationPrompt() } }
                catch (_: ComposeTimeoutException) { /* Notification consent may already be answered. */ }
            }
            waitFor { permission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED }
            assertEquals(PackageManager.PERMISSION_DENIED, permission(Manifest.permission.READ_MEDIA_IMAGES))
            assertEquals(PackageManager.PERMISSION_DENIED, permission(Manifest.permission.READ_MEDIA_VIDEO))
            assertEquals(MediaScope.SELECTED, MediaAccess.current(context).images)
            val scanner = MediaScanner(context)
            assertEquals(listOf("homesync-picker-selected.png"), scanner.scan(setOf(BackupCategory.PHOTOS)).map { it.displayName })
            val excludedId = checkNotNull(InstrumentationRegistry.getArguments().getString("unselectedMediaId")).toLong()
            val excluded = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, excludedId)
            val read = runCatching { context.contentResolver.openInputStream(excluded)?.use { it.read() } }
            assertTrue("Unselected foreign photo must not be readable", read.isFailure || read.getOrNull() == null)
            compose.onNodeWithContentDescription("Only while charging").performScrollTo().performClick()
            compose.onNodeWithContentDescription("Photos").performScrollTo().performClick()
            waitFor { compose.onAllNodesWithText("Only selected photos or videos", substring = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Back Up Now").assertIsEnabled()
            wm.cancelAllWork().result.get(5, TimeUnit.SECONDS)
            assertEquals(0, status().getInt("files"))
            compose.onNodeWithText("Back Up Now").performScrollTo().performClick()
            waitFor { wm.getWorkInfosForUniqueWork("${BackupWorker.WORK_NAME}_manual").get(5, TimeUnit.SECONDS).isNotEmpty() }
            assertEquals(WorkInfo.State.ENQUEUED, work().state)
            shell("dumpsys battery set ac 1")
            shell("dumpsys battery set status 2")
            waitFor { work().state == WorkInfo.State.SUCCEEDED }
            val proof = status()
            assertEquals(1, proof.getInt("files")); assertTrue(proof.getBoolean("bytesMatch")); assertTrue(proof.getBoolean("hashMatches"))
            val firstId = work().id
            compose.onNodeWithText("Back Up Now").performScrollTo().performClick()
            waitFor { work().let { it.id != firstId && it.state == WorkInfo.State.SUCCEEDED } }
            assertEquals(1, status().getInt("files"))
            shell("screencap -p /data/local/tmp/homesync-picker-backup.png")
        } catch (failure: Throwable) {
            val hierarchy = java.io.ByteArrayOutputStream()
            device.dumpWindowHierarchy(hierarchy)
            println("PICKER_UI_HIERARCHY " + hierarchy.toString("UTF-8"))
            shell("screencap -p /data/local/tmp/homesync-picker-failure.png")
            throw failure
        } finally {
            wm.cancelAllWork().result.get(5, TimeUnit.SECONDS)
            shell("dumpsys battery reset")
        }
    }

    private fun dismissNotificationPrompt(): Boolean {
        if (!device.hasObject(By.textContains("notifications"))) return false
        val deny = device.findObject(id("permission_deny(_and_dont_ask_again)?_button")) ?: return false
        deny.click()
        return true
    }

    private fun dismissLauncherAnr() {
        if (device.hasObject(By.text("Pixel Launcher isn't responding"))) {
            println("EMULATOR_INFRA: closing exact Pixel Launcher ANR")
            shell("screencap -p /data/local/tmp/homesync-launcher-anr.png")
            checkNotNull(device.findObject(By.text("Close app"))).click()
        }
    }

    private fun status(): JSONObject {
        val connection = URL("http://127.0.0.1:18083/__fixture__/picker-status").openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000; connection.readTimeout = 5_000
        return try { JSONObject(connection.inputStream.bufferedReader().use { it.readText() }) }
        finally { connection.disconnect() }
    }

    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }
}
