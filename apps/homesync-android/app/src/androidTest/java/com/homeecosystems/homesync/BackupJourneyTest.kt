package com.homeecosystems.homesync

import android.Manifest
import android.content.ContentValues
import android.os.Build
import android.os.BatteryManager
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Base64
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.homeecosystems.homesync.sync.BackupWorker
import com.homeecosystems.homesync.ui.MainActivity
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackupJourneyTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(GrantPermissionRule.grant(
        Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.POST_NOTIFICATIONS
    )).around(compose)
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val base = "http://127.0.0.1:18083"

    @Test fun signInConstrainedBackupAndRepeat() {
        check(InstrumentationRegistry.getArguments().getString("homeFixture") == "disposable")
        check(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"))
        val context = instrumentation.targetContext
        val wm = WorkManager.getInstance(context)
        fun work(name: String) = wm.getWorkInfosForUniqueWork(name).get(5, TimeUnit.SECONDS)
        fun waitFor(condition: () -> Boolean) = compose.waitUntil(120_000, condition)
        fun toggle(label: String) = compose.onNodeWithContentDescription(label)
            .performScrollTo().performClick()
        fun enter(label: String, value: String) = compose.onNode(hasSetTextAction() and hasText(label)).performTextReplacement(value)

        waitFor { compose.onAllNodesWithText("Server address").fetchSemanticsNodes().isNotEmpty() }
        enter("Server address", "127.0.0.1:18083")
        enter("Username", "emulator_owner")
        enter("Password", "wrong password")
        compose.onNodeWithText("Sign in", ignoreCase = false).performClick()
        waitFor { compose.onAllNodesWithText("That username or password wasn't right.").fetchSemanticsNodes().isNotEmpty() }
        enter("Password", "DisposableEmulator123!")
        compose.onNodeWithText("Sign in").performClick()
        waitFor { compose.onAllNodesWithText("Back Up Now").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(0, status().getInt("files"))
        assertTrue(work(BackupWorker.WORK_NAME).isEmpty())

        // App-owned synthetic media only. The real MediaStore scanner, hasher,
        // multipart client and Cloud storage must handle these exact bytes.
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "homesync-emulator-proof.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/HomeSyncCI")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = checkNotNull(context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        try {
            context.contentResolver.openOutputStream(uri)!!.use { it.write(Base64.decode(PHOTO, Base64.DEFAULT)) }
            context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            shell("dumpsys battery unplug")
            shell("dumpsys battery set status 3")
            toggle("Only while charging")
            toggle("Photos")
            waitFor { work(BackupWorker.WORK_NAME).isNotEmpty() }
            val periodic = work(BackupWorker.WORK_NAME).single()
            assertTrue(periodic.constraints.requiresCharging())
            // Enqueueing a six-hour schedule is checked; this test does not wait
            // six hours or claim Doze/reboot delivery. Avoid racing two uploads.
            wm.cancelUniqueWork(BackupWorker.WORK_NAME).result.get(5, TimeUnit.SECONDS)
            compose.onNodeWithText("Back Up Now").performScrollTo().performClick()
            val manualName = "${BackupWorker.WORK_NAME}_manual"
            waitFor { work(manualName).isNotEmpty() }
            Thread.sleep(2_000)
            assertFalse(context.getSystemService(BatteryManager::class.java).isCharging)
            assertTrue(work(manualName).single().constraints.requiresCharging())
            assertEquals(WorkInfo.State.ENQUEUED, work(manualName).single().state)
            assertEquals(0, status().getInt("files"))
            shell("dumpsys battery set ac 1")
            shell("dumpsys battery set status 2")
            waitFor { work(manualName).single().state == WorkInfo.State.SUCCEEDED }
            val proof = status()
            assertEquals(1, proof.getInt("files")); assertEquals(1, proof.getInt("synced"))
            assertTrue(proof.getBoolean("bytesMatch")); assertTrue(proof.getBoolean("hashMatches"))
            val firstId = work(manualName).single().id
            compose.onNodeWithText("Back Up Now").performScrollTo().performClick()
            waitFor { work(manualName).single().let { it.id != firstId && it.state == WorkInfo.State.SUCCEEDED } }
            assertEquals(1, status().getInt("files"))
            compose.activityRule.scenario.recreate()
            waitFor { compose.onAllNodesWithText("1 files", substring = true).fetchSemanticsNodes().isNotEmpty() }
            val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
            File(checkNotNull(context.getExternalFilesDir("proof")), "backup.png").outputStream().use {
                screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            screenshot.recycle()
        } finally {
            wm.cancelAllWork().result.get(5, TimeUnit.SECONDS)
            context.contentResolver.delete(uri, null, null)
            shell("dumpsys battery reset")
        }
    }

    private fun status(): JSONObject {
        val connection = URL("$base/__fixture__/status").openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000; connection.readTimeout = 5_000
        return try { JSONObject(connection.inputStream.bufferedReader().use { it.readText() }) }
        finally { connection.disconnect() }
    }

    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }

    companion object {
        private const val PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPYEiWyJUqEAUIBACJGBImnebzNAAAAAElFTkSuQmCC"
    }
}
