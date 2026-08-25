#!/usr/bin/env bash
# Copies the canonical icon set and AppIcon.jsx component out to every
# frontend that uses them. design/ is the single source of truth — never
# hand-edit a copy inside apps/*/public/icons/ or apps/*/src/components/
# directly, since the next run of this script will silently overwrite it.
#
# Why copies instead of an npm-workspace-linked shared package: these are
# independent Vite builds (SETUP.md §4), and a raw .jsx file inside a
# workspace package needs extra Vite config to be transformed correctly —
# real, but fiddly, plumbing that isn't worth it for nine small icons and
# one component. A plain copy, kept in sync by this script, is simpler and
# just as safe as long as design/ stays the only place anyone edits.
#
# Run this after changing anything under design/:
#   ./design/sync-assets.sh

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root, regardless of where this is invoked from

FRONTENDS=(apps/home apps/homecloud apps/homemedia apps/homenotes)
# apps/homecloud has no shared branded Layout.jsx component yet (unlike its
# three siblings) — see MIGRATION_PLAN.md-adjacent note in CHANGELOG.md —
# but it still gets the icon files themselves for its favicon/manifest.

for app in "${FRONTENDS[@]}"; do
  mkdir -p "$app/public/icons"
  cp design/icons/*.svg "$app/public/icons/"
  echo "synced icons -> $app/public/icons/"
done

# AppIcon.jsx only goes where it's actually imported today: Home (app
# launcher cards + sidebar app list) and the two sibling apps whose
# Layout.jsx renders a branded sidebar/topbar (HomeMedia, HomeNotes).
for app in apps/home apps/homemedia apps/homenotes; do
  mkdir -p "$app/src/components"
  cp design/AppIcon.jsx "$app/src/components/AppIcon.jsx"
  echo "synced AppIcon.jsx -> $app/src/components/AppIcon.jsx"
done

# Wordmark.jsx only goes where it's used today: Home's own login screen.
mkdir -p apps/home/src/components
cp design/Wordmark.jsx apps/home/src/components/Wordmark.jsx
echo "synced Wordmark.jsx -> apps/home/src/components/Wordmark.jsx"
