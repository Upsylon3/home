package com.homeecosystems.homesync.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkScheme = darkColorScheme(
    primary = AmberTextDark,
    onPrimary = AmberOnLabel,
    background = DarkBg,
    onBackground = DarkText,
    surface = DarkPanel,
    onSurface = DarkText,
    surfaceVariant = DarkPanelRaised,
    onSurfaceVariant = DarkTextDim,
    outline = DarkBorder,
    error = RedDark
)

private val LightScheme = lightColorScheme(
    primary = AmberTextLight,
    onPrimary = AmberOnLabel,
    background = LightBg,
    onBackground = LightText,
    surface = LightPanel,
    onSurface = LightText,
    surfaceVariant = LightPanelRaised,
    onSurfaceVariant = LightTextDim,
    outline = LightBorder,
    error = RedLight
)

/**
 * dynamicColor defaults to false: HomeEcosystems has its own established
 * amber/dark identity shared across every app in it (see Color.kt) — a
 * per-device Material You wallpaper-derived palette would make HomeSync
 * look like a different product from HomeCloud/HomeMedia sitting right
 * next to it, which defeats the point of a shared visual language. Left
 * as an opt-in parameter rather than deleted entirely in case that
 * tradeoff is ever worth revisiting.
 */
@Composable
fun HomeSyncTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkScheme
        else -> LightScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
