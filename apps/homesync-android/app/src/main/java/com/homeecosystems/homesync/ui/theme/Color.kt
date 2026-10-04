package com.homeecosystems.homesync.ui.theme

import androidx.compose.ui.graphics.Color

// Same values as design/tokens.css (the web apps' single source of truth),
// so the phone app wears the same warm "Atari, 1977" palette as the web
// apps: warm brown-black, cream, orange. If you change a color in
// design/tokens.css, change the matching constant here by hand (there is
// no automatic sync to Kotlin yet). See docs/DESIGN_SYSTEM.md.
val DarkBg = Color(0xFF17120E)
val DarkPanel = Color(0xFF221A13)
val DarkPanelRaised = Color(0xFF2D231A)
val DarkBorder = Color(0xFF4A3A2B)
val DarkText = Color(0xFFF2E6CF)
val DarkTextDim = Color(0xFFB0A088)

val LightBg = Color(0xFFF3E9D2)
val LightPanel = Color(0xFFEBDFC3)
val LightPanelRaised = Color(0xFFE0D2B0)
val LightBorder = Color(0xFFCDBB94)
val LightText = Color(0xFF2B2118)
val LightTextDim = Color(0xFF66563F)

// Amber is deliberately the *same* vivid value in both themes (used for
// buttons/accents against a fixed near-black label — see AmberOnLabel)
// while AmberText below is deepened for the light theme specifically,
// exactly matching the reasoning in frontend/src/styles/index.css.
val Amber = Color(0xFFE0892B)
val AmberTextDark = Color(0xFFE0892B)
val AmberTextLight = Color(0xFF834909)
val AmberOnLabel = Color(0xFF1F1205) // dark-brown text on top of the bright amber button (DARK theme)
// In the LIGHT theme the button itself is the deep amber above, so the label
// must be light instead: dark-brown on it measures only 2.8:1, cream 6.2:1
// (4.5:1 is the AA minimum). Matches --on-accent in design/tokens.css.
val AmberOnLabelLight = Color(0xFFFFF6E6)

val Teal = Color(0xFF4AAAA5)
val RedDark = Color(0xFFE0664A)
val RedLight = Color(0xFFA03522)
