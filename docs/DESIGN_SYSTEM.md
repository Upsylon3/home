# Design system

HOME uses warm Atari-era materials with modern, accessible layouts. Keep daily
work calm and readable. [Artistic intent](../HOME_ARTISTIC_DIRECTION.md).

## Source of truth

Edit shared assets in `design/`, then run `design/sync-assets.sh`. Do not edit
the generated copies under apps.

| Source | Purpose |
|---|---|
| `tokens.css` | Colors, fonts, radii, depth and retro overrides |
| `components.css` | Buttons, panels, controls, storage gauges and shared states |
| `retro.js` / `RetroControl.jsx` | Off/Subtle/Full preference, shared through `home-retro` |
| `session.js` | Shared session-token handling |
| `icons/` / `AppIcon.jsx` / `Wordmark.jsx` | Canonical app marks and wordmark |
| `make-favicons.mjs` | Generated browser/PWA icons and Android adaptive foreground |

When an icon or brand color changes, run `node design/make-favicons.mjs`,
then sync assets. Commit the generated outputs. When adding an app, register
it with the sync/icon tools and reuse existing components.

CSS load order: tokens, app layout styles, shared components. Override supported
variables instead of forking shared files.

## Colors and type

Use named tokens, not copied hex values. Dark surfaces are warm brown-black;
light surfaces are cream/paper. Higher dark surfaces get lighter; raised light
surfaces get slightly darker.

| Token | Use |
|---|---|
| `--bg`, `--panel`, `--panel-raised` | Surface hierarchy |
| `--text`, `--text-dim` | Primary/secondary text |
| `--amber`, `--amber-dim` | Accent and attention |
| `--teal` | Healthy/informational |
| `--red` | Danger/error |
| `--on-accent` | Text on accent surfaces |

Headings use Fredoka, reading text Inter, labels/numbers IBM Plex Mono.
Bundle fonts locally through `@fontsource`; no external font CDN.

## Retro intensity

| Mode | Behavior |
|---|---|
| Off | Warm palette/type; remove decorative stripes, wood, frames, raised effects and scanlines |
| Subtle (default) | Restrained stripes, hard button depth, cartridge folders, print frames and ruled notes |
| Full | Stronger depth/stripes and dark scanlines, still without glow |

New decoration needs an Off behavior. Do not add Full-only intensity to Subtle.
Use woodgrain on at most one hero surface per screen, currently the dashboard
and Tasks Today header. Forms and working lists stay quiet.

## Application character

- Home: entrance/dashboard, wood header and app controls.
- Cloud: archive, cartridge folders and clear file rows.
- Media: gallery, print frames and albums.
- Notes: study, restrained ruled-paper treatment.
- Tasks: desk, clear due/overdue/priority words and Today header.
- Monitor/Sync: quiet utility/status interfaces.
- Vault: restrained safe, thin brass details rather than loud decoration.

## Interaction and accessibility

- Familiar controls, consistent placement and clear wording.
- Visible keyboard focus, labels, adequate contrast and usable touch targets.
- Never communicate status only through color; write overdue/error states.
- Respect reduced motion. Motion communicates state; sound is off by default.
- Show actionable loading, empty, error and unavailable states.
- Check actual narrow layouts and Android interaction separately.
- No neon, blurred glow, decorative animation spam or copied trademarks.

## Icons and Android

Use the shared simple geometric icon family and common frame. Generate
favicons/adaptive foregrounds from those sources; keep the Android adaptive
mark in its safe zone. Native Android uses the shared palette and recognizable
actions while following platform navigation/permission conventions.
