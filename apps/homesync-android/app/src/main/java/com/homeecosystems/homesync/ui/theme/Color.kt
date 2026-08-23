package com.homeecosystems.homesync.ui.theme

import androidx.compose.ui.graphics.Color

// Same tokens as home/src/styles/index.css and homemedia/src/styles/index.css
// — same amber/dark identity across every surface in the ecosystem,
// mobile included, per HOME_ARTISTIC_DIRECTION.md's "one visual language."
val DarkBg = Color(0xFF14171C)
val DarkPanel = Color(0xFF1D2128)
val DarkPanelRaised = Color(0xFF262B33)
val DarkBorder = Color(0xFF333A45)
val DarkText = Color(0xFFE8E6E1)
val DarkTextDim = Color(0xFF9AA1AD)

val LightBg = Color(0xFFF6F2EA)
val LightPanel = Color(0xFFECE6D9)
val LightPanelRaised = Color(0xFFE0D8C5)
val LightBorder = Color(0xFFD2C7AE)
val LightText = Color(0xFF2A2419)
val LightTextDim = Color(0xFF766C58)

// Amber is deliberately the *same* vivid value in both themes (used for
// buttons/accents against a fixed near-black label — see AmberOnLabel)
// while AmberText below is deepened for the light theme specifically,
// exactly matching the reasoning in frontend/src/styles/index.css.
val Amber = Color(0xFFE8A33D)
val AmberTextDark = Color(0xFFE8A33D)
val AmberTextLight = Color(0xFF8A5A16)
val AmberOnLabel = Color(0xFF1A1103) // near-black text on top of an amber button, both themes

val Teal = Color(0xFF4FB0A5)
val RedDark = Color(0xFFD65F5F)
val RedLight = Color(0xFFB23B3B)
