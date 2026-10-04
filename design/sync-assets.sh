#!/usr/bin/env bash
# Copies the canonical icon set and AppIcon.jsx component out to every
# frontend that uses them. design/ is the single source of truth — never
# hand-edit a copy inside apps/*/public/icons/ or apps/*/src/components/
# directly, since the next run of this script will silently overwrite it.
#
# Why copies instead of an npm-workspace-linked shared package: these are
# independent Vite builds (see docs/DEVELOPMENT.md), and a raw .jsx file
# inside a workspace package needs extra Vite config to be transformed
# correctly — real, but fiddly, plumbing that isn't worth it for nine
# small icons and one component. A plain copy, kept in sync by this
# script, is simpler and just as safe as long as design/ stays the only
# place anyone edits.
#
# Run this after changing anything under design/:
#   ./design/sync-assets.sh

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root, regardless of where this is invoked from

FRONTENDS=(apps/home apps/homecloud apps/homemedia apps/homenotes apps/homevault)
# apps/homecloud has no shared branded Layout.jsx component yet (unlike
# its four siblings) but it still gets the icon files themselves for
# its favicon/manifest.

for app in "${FRONTENDS[@]}"; do
  mkdir -p "$app/public/icons"
  cp design/icons/*.svg "$app/public/icons/"
  echo "synced icons -> $app/public/icons/"
done

# Design tokens + shared components (buttons, cards, checkboxes, gauge) go to EVERY
# frontend, into src/styles/ right next to that app's own index.css. Each
# app's main.jsx imports tokens.css BEFORE index.css (so index.css can use
# var(--amber) and friends) and components.css AFTER it (so the shared
# pieces win ties). Same rule as the icons: edit the files in design/
# only; the copies below get overwritten on every run.
for app in "${FRONTENDS[@]}"; do
  mkdir -p "$app/src/styles"
  cp design/tokens.css "$app/src/styles/tokens.css"
  echo "synced tokens.css -> $app/src/styles/tokens.css"
  cp design/components.css "$app/src/styles/components.css"
  echo "synced components.css -> $app/src/styles/components.css"
done

# Retro intensity (Off / Subtle / Full): the storage helper goes next to each
# app's theme.js, the 3-choice control next to its other components. Every
# app offers the setting, so every app gets both files.
for app in "${FRONTENDS[@]}"; do
  cp design/retro.js "$app/src/retro.js"
  cp design/RetroControl.jsx "$app/src/components/RetroControl.jsx"
  echo "synced retro.js + RetroControl.jsx -> $app/src"
done

# Browser-tab and home-screen icons, generated from the icon set by
# design/make-favicons.mjs (run that first if an icon changed). Each app gets
# its OWN icon, copied into its public/ folder, which the build serves as-is.
for app in "${FRONTENDS[@]}"; do
  name="$(basename "$app")"
  cp design/favicons/"$name"/* "$app/public/"
  echo "synced favicons -> $app/public"
done

# AppIcon.jsx only goes where it's actually imported today: Home (app
# launcher cards + sidebar app list) and the three sibling apps whose
# Layout.jsx renders a branded sidebar/topbar (HomeMedia, HomeNotes,
# HomeVault).
for app in apps/home apps/homemedia apps/homenotes apps/homevault; do
  mkdir -p "$app/src/components"
  cp design/AppIcon.jsx "$app/src/components/AppIcon.jsx"
  echo "synced AppIcon.jsx -> $app/src/components/AppIcon.jsx"
done

# Wordmark.jsx only goes where it's used today: Home's own login screen.
mkdir -p apps/home/src/components
cp design/Wordmark.jsx apps/home/src/components/Wordmark.jsx
echo "synced Wordmark.jsx -> apps/home/src/components/Wordmark.jsx"
