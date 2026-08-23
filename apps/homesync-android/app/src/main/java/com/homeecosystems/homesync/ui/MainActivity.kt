package com.homeecosystems.homesync.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.homeecosystems.homesync.HomeSyncApplication
import com.homeecosystems.homesync.data.local.AppDatabase
import com.homeecosystems.homesync.ui.home.HomeScreen
import com.homeecosystems.homesync.ui.home.HomeViewModel
import com.homeecosystems.homesync.ui.login.LoginScreen
import com.homeecosystems.homesync.ui.login.LoginViewModel
import com.homeecosystems.homesync.ui.theme.HomeSyncTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = application as HomeSyncApplication

        setContent {
            HomeSyncTheme {
                // Three states, not two: null while the stored session is
                // still loading from DataStore, so the login screen never
                // flashes for a moment before swapping to the home screen
                // for someone who's actually already signed in.
                var isSignedIn by remember { mutableStateOf<Boolean?>(null) }

                LaunchedEffect(Unit) {
                    app.sessionManager.initialize()
                    isSignedIn = app.sessionManager.isSignedIn()
                }

                val permissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestMultiplePermissions()
                ) { /* Backup silently finds nothing to do if these are denied — see MediaScanner — rather than the app needing to branch on the result here. */ }

                LaunchedEffect(isSignedIn) {
                    if (isSignedIn == true) {
                        permissionLauncher.launch(requiredPermissions())
                    }
                }

                when (isSignedIn) {
                    null -> Unit // brief moment loading the stored session — nothing to show yet
                    false -> LoginScreen(
                        viewModelFactory = LoginViewModel.Factory(app.apiClient, app.sessionManager),
                        onLoggedIn = { isSignedIn = true }
                    )
                    true -> HomeScreen(
                        viewModelFactory = HomeViewModel.Factory(
                            applicationContext,
                            app.settingsStore,
                            app.apiClient,
                            AppDatabase.getInstance(applicationContext).syncedMediaDao()
                        )
                    )
                }
            }
        }
    }

    /** Android 13+ split blanket storage access into per-media-type grants; older versions still use the single legacy permission — see AndroidManifest.xml. */
    private fun requiredPermissions(): Array<String> = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.READ_MEDIA_IMAGES)
            add(Manifest.permission.READ_MEDIA_VIDEO)
            add(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }.toTypedArray()
}
