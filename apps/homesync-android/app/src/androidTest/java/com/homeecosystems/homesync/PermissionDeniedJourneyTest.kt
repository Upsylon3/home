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
import androidx.test.uiautomator.Until
import androidx.test.uiautomator.UiDevice
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
    private val settingsRecovery get() = InstrumentationRegistry.getArguments().getString("permissionRecovery") == "settings"
    private val proofName get() = if (settingsRecovery) "settings" else "permission"

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
        enter("Username", if (settingsRecovery) "emulator_settings" else "emulator_denied")
        enter("Password", "DisposableEmulator123!")
        compose.onNodeWithText("Sign in").performClick()
        // Network completion is external to Compose. Finish sign-in before
        // UI Automator starts waiting for a stable separate system window.
        waitFor { (context.applicationContext as HomeSyncApplication).sessionManager.isSignedIn() }
        compose.waitForIdle()
        answerPrompts("permission_deny_button")
        assertEquals(PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES))
        compose.onNodeWithContentDescription("Photos").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Media access is blocked", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Back Up Now").assertIsNotEnabled()
        shell("screencap -p /data/local/tmp/homesync-$proofName-denied.png")
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
        if (settingsRecovery) {
            answerPrompts("permission_deny_button")
            compose.waitUntil(10_000) { !compose.activity.shouldShowRequestPermissionRationale(Manifest.permission.READ_MEDIA_IMAGES) }
            assertEquals(PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES))
            // A third request must not produce another dialog after two actual
            // denials. Keep advancing Compose while Android returns its result.
            compose.onNodeWithText("Review media access").performScrollTo().performClick()
            val deny = By.res(Pattern.compile(".*:id/permission_deny_button"))
            try { compose.waitUntil(3_000) { device.hasObject(deny) } }
            catch (_: ComposeTimeoutException) { /* Expected: Android suppresses the request. */ }
            assertFalse("A permanently denied request must not prompt again", device.hasObject(deny))
            compose.onNodeWithText("Back Up Now").assertIsNotEnabled()
            assertEquals(0, status().getInt("files")); assertEquals(0, status().getInt("devices"))
            shell("screencap -p /data/local/tmp/homesync-settings-suppressed.png")
            compose.onNodeWithText("Android app settings").performScrollTo().performClick()
            clickSystemText("Permissions")
            clickSystemText("Photos and videos")
            clickSystemText("(?i)(always )?allow all.*")
            assertEquals(PackageManager.PERMISSION_GRANTED, ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES))
            shell("screencap -p /data/local/tmp/homesync-settings-permissions.png")
            repeat(3) { device.pressBack(); device.waitForIdle() }
        } else {
            answerPrompts("permission_allow(_all)?_button")
        }
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
            shell("screencap -p /data/local/tmp/homesync-$proofName-recovered.png")
        } finally { wm.cancelAllWork().result.get(5, TimeUnit.SECONDS); context.contentResolver.delete(uri, null, null) }
    }

    private fun answerPrompts(buttonId: String) {
        var answered = 0
        repeat(3) {
            val selector = By.res(Pattern.compile(".*:id/$buttonId"))
            // Keep Compose's virtual clock advancing while asynchronous login
            // and its LaunchedEffect open a separate Android system window.
            try {
                compose.waitUntil(if (answered == 0) 20_000 else 2_000) { device.hasObject(selector) }
            } catch (_: ComposeTimeoutException) { /* A later optional prompt may be absent. */ }
            val button = device.findObject(selector)
            if (button != null) { button.click(); answered++ }
        }
        if (answered == 0) {
            val hierarchy = java.io.ByteArrayOutputStream()
            device.dumpWindowHierarchy(hierarchy)
            println("PERMISSION_UI_HIERARCHY " + hierarchy.toString("UTF-8"))
            println("COMPOSE_UI " + runCatching { compose.onRoot().printToString() }.getOrNull())
            shell("screencap -p /data/local/tmp/homesync-permission-missing.png")
        }
        assertTrue("Expected a real Android permission dialog", answered > 0)
    }
    private fun clickSystemText(text: String) {
        val node = device.wait(Until.findObject(By.text(Pattern.compile(text))), 10_000)
        if (node == null) {
            val hierarchy = java.io.ByteArrayOutputStream()
            device.dumpWindowHierarchy(hierarchy)
            println("SETTINGS_UI_HIERARCHY " + hierarchy.toString("UTF-8"))
        }
        checkNotNull(node) { "Missing Android Settings control: $text" }.click()
    }

    private fun status(): JSONObject {
        val route = if (settingsRecovery) "settings-status" else "denied-status"
        val c = URL("http://127.0.0.1:18083/__fixture__/$route").openConnection() as HttpURLConnection
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
