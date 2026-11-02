package com.homeecosystems.homesync

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Base64
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.homeecosystems.homesync.sync.BackupWorker
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

// Separate fresh installation/instrumentation invocation: no grant rule can
// leak the preceding happy journey's permissions or saved session into this case.
@RunWith(AndroidJUnit4::class)
class PermissionDeniedJourneyTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device get() = UiDevice.getInstance(instrumentation)

    @Test fun denialBlocksWorkAndGrantRestoresBackup() {
        check(InstrumentationRegistry.getArguments().getString("homeFixture") == "disposable")
        check(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"))
        val context = instrumentation.targetContext
        assertEquals("Fresh install must start without media access", PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES))
        val wm = WorkManager.getInstance(context)
        fun waitFor(condition: () -> Boolean) = compose.waitUntil(120_000, condition)
        fun enter(label: String, value: String) = compose.onNode(hasSetTextAction() and hasText(label)).performTextReplacement(value)
        waitFor { compose.onAllNodesWithText("Server address").fetchSemanticsNodes().isNotEmpty() }
        enter("Server address", "127.0.0.1:18083")
        enter("Username", "emulator_denied")
        enter("Password", "DisposableEmulator123!")
        compose.onNodeWithText("Sign in").performClick()
        answerPrompts("permission_deny_button")
        assertEquals(PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES))
        compose.onNodeWithContentDescription("Photos").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Media access is blocked", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Back Up Now").assertIsNotEnabled()
        shell("screencap -p /data/local/tmp/homesync-permission-denied.png")
        wm.cancelAllWork().result.get(5, TimeUnit.SECONDS)

        // A previously queued worker must enforce the same boundary even when
        // invoked without the UI. Use real WorkManager, not its test driver.
        val request = OneTimeWorkRequestBuilder<BackupWorker>().build()
        wm.enqueue(request).result.get(5, TimeUnit.SECONDS)
        waitFor { wm.getWorkInfoById(request.id).get(5, TimeUnit.SECONDS)?.state?.isFinished == true }
        val failed = checkNotNull(wm.getWorkInfoById(request.id).get(5, TimeUnit.SECONDS))
        assertEquals(WorkInfo.State.FAILED, failed.state)
        assertEquals("media-permission-required", failed.outputData.getString("reason"))
        assertEquals(0, status().getInt("files")); assertEquals(0, status().getInt("devices"))

        compose.onNodeWithText("Review media access").performScrollTo().performClick()
        answerPrompts("permission_allow(_all)?_button")
        waitFor { ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED }
        waitFor { compose.onAllNodesWithText("Media access is blocked", substring = true).fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("Back Up Now").assertIsEnabled()
        val uri = checkNotNull(context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "homesync-permission-proof.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/HomeSyncCI")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }))
        try {
            context.contentResolver.openOutputStream(uri)!!.use { it.write(Base64.decode(PHOTO, Base64.DEFAULT)) }
            context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            compose.onNodeWithText("Back Up Now").performScrollTo().performClick()
            waitFor { wm.getWorkInfosForUniqueWork("${BackupWorker.WORK_NAME}_manual").get(5, TimeUnit.SECONDS).any { it.state == WorkInfo.State.SUCCEEDED } }
            val proof = status()
            assertEquals(1, proof.getInt("files")); assertTrue(proof.getBoolean("bytesMatch")); assertTrue(proof.getBoolean("hashMatches"))
            shell("screencap -p /data/local/tmp/homesync-permission-recovered.png")
        } finally { wm.cancelAllWork().result.get(5, TimeUnit.SECONDS); context.contentResolver.delete(uri, null, null) }
    }

    private fun answerPrompts(buttonId: String) {
        var answered = 0
        repeat(3) {
            val button = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/$buttonId"))), if (answered == 0) 20_000 else 2_000)
            if (button != null) { button.click(); answered++ }
        }
        if (answered == 0) {
            val hierarchy = java.io.ByteArrayOutputStream()
            device.dumpWindowHierarchy(hierarchy)
            println("PERMISSION_UI_HIERARCHY " + hierarchy.toString("UTF-8"))
            println("COMPOSE_UI " + compose.onRoot().printToString())
            shell("screencap -p /data/local/tmp/homesync-permission-missing.png")
        }
        assertTrue("Expected a real Android permission dialog", answered > 0)
    }
    private fun status(): JSONObject {
        val c = URL("http://127.0.0.1:18083/__fixture__/denied-status").openConnection() as HttpURLConnection
        c.connectTimeout = 5_000; c.readTimeout = 5_000
        return try { JSONObject(c.inputStream.bufferedReader().use { it.readText() }) } finally { c.disconnect() }
    }
    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }
    companion object {
        private const val PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPYEiWyJUqEAUIBACJGBImnebzNAAAAAElFTkSuQmCC"
    }
}
