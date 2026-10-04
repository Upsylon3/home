# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning follows
[SemVer](https://semver.org/): one version number for the whole
ecosystem (see root `package.json`), bumped on any meaningful release.

## [1.8.0] — Atari refresh: Android palette, contrast fixes, real favicons

Closes out the remaining items from the refresh.

### Added
- **HomeSync Android** wears the same palette (`Color.kt`, the XML color
  resources, the launcher icon). Constants only: **not compiled here (no
  Android SDK)**, so it needs one build on a real machine.
- **Favicons and home-screen icons for every app**, generated from the icon
  set by `design/make-favicons.mjs` into `design/favicons/` and copied by
  `design/sync-assets.sh`. Four apps previously had no tab icon at all and
  HomeCloud had old placeholders. Links use `%BASE_URL%` so each app
  resolves its own icon behind the gateway (`/media/favicon.svg`, not the
  root's).
- `.error-banner.is-ok` / `.is-warn` variants in HomeCloud.

### Fixed
- **Contrast.** Light-theme amber and teal measured 4.3 to 4.4:1 on the
  raised surface. Now `#834909` and `#235f5f`: at least 4.8:1 on all three
  light surfaces.
- **Android light-theme buttons** used near-black text on deep amber, only
  3.2:1 (2.8:1 after a straight palette swap). Now cream, 6.2:1.
- HomeCloud's teal and amber banners had their colors typed inline in the
  JSX, so they could not follow the theme. They now use the new classes.
  (The white behind the 2FA QR code stays literal on purpose, with a
  comment: QR scanners need plain white.)

## [1.7.1] — Docs: the Atari direction is written down

Documentation only; no code changed.

### Changed
- `docs/DESIGN_SYSTEM.md` now describes the Atari direction: the rules
  (one hero detail per screen, physical not neon, no glow, never copy the
  trademarks), a palette table **generated from `design/tokens.css`** so it
  cannot drift from the code, the type choices, the three retro intensity
  levels, how each app's room wears the style, and where everything lives
  (`design/` is the source of truth; never edit the synced copies).
- `HOME_ARTISTIC_DIRECTION.md` gets an addendum that says which of its
  lines are superseded (sections 6, 7, 10, 11 and the per-app sections)
  and which stand. The original text is untouched; the four superseded
  sections carry a one-line note pointing at the addendum.
- The earlier "decided as final" notes (brass `#C99A3B`, system-font
  stack) are recorded as superseded, with the history kept. The code had
  already drifted from the brass value (it used `#e8a33d`).
- A "Not done yet" list: HomeSync's Android theme, a contrast polish pass,
  one stray typed-in color in HomeCloud's Settings page, favicon exports.

## [1.7.0] — Atari refresh, phase 5: the per-app passes

Each app keeps its "room" from the design direction, now with the retro
touches that suit it. No glow anywhere; everything is hard-edged.

### HomeCloud (the cartridge shelf)
- **Folders are cartridges**: a striped label strip along the top, a lift
  on hover. `FolderGrid.jsx` was rewritten to use CSS classes instead of
  inline `style={{...}}` objects, which could not react to the theme,
  hover or the retro intensity setting.
- File table: a label-plate header, and a hard amber bar on the left of the
  row under the pointer or any row whose checkbox is ticked (a tinted row
  background for ticked rows too).
- Dropzone: heavier dashes that turn solid while a file is dragged over.

### HomeMedia (the gallery)
- Heavier tile borders; albums look like a small stack of prints (hard
  offset shadow); the lightbox photo gets a cream print frame
  (`--print-frame`, new token, same in both themes because the lightbox
  backdrop is always dark).
- **Full** retro intensity adds CRT scanlines and darkened edges over the
  lightbox (a see-through layer that never intercepts clicks).

### HomeNotes (the study)
- The editor is ruled paper: each rule sits under a line of text and the
  paper scrolls with the writing. Note cards get the same amber left edge.

### HomeVault (the safe)
- Restrained on purpose: only a quiet brass edge on the vault row under
  the pointer.

### All apps
- The current page in the sidebar gets a solid amber bar down its left
  edge (`design/components.css`).
- Retro intensity **Off** removes every one of these additions (flat
  folder chips, no stacked-print shadow, no print frame, blank page).

### Fixed
- HomeNotes' Write / Preview toggle rendered as two bare browser buttons:
  its markup used the `.segmented` class but the stylesheet never defined
  it. `.segmented` is now defined once in `design/components.css` and
  covers both that markup and HomeMedia's filter; HomeMedia's private copy
  of the same rules was removed.
- The storage gauge label wrapped awkwardly in HomeCloud's narrow sidebar
  ("24%" dropped onto its own line). The numbers now stay together as one
  unit and wrap as a whole.

## [1.6.1] — Atari refresh: no glow, anywhere

The 1970s Atari look is physical (wood, plastic, painted stripes), not
neon. Glow is a later, synthwave idea, and `HOME_ARTISTIC_DIRECTION.md`
already says no glowing borders. Version 1.6.0 contradicted that, so this
removes every glow, including ones that predate the refresh.

### Removed
- The blurred glow around status lamps in Home, HomeMedia, HomeNotes and
  HomeVault. Lamps are now solid dots with a hard-edged underside shadow,
  like a molded plastic dome.
- The glow on the rocker switch's lit knob (added in 1.4.0).
- The extra-strong lamp glow that **Full** retro intensity added (1.6.0).
- HomeCloud's pulsing activity-LED glow. It still flashes on uploads,
  downloads and deletes, now as a flat cream-to-teal color flash in two
  hard steps, and it holds still for people who ask for reduced motion.

### Changed
- **Full** is described as "CRT scanlines" (it is: thin dark lines and
  darkened edges, no light spilling out of anything).

## [1.6.0] — Atari refresh: retro intensity setting (Off / Subtle / Full)

A dial for how strongly the 1970s styling shows, so the retro look is
something you choose rather than something you get. It is independent of
light/dark: any combination works.

### Added
- **Retro intensity** in every app's Settings page (Home, HomeCloud,
  HomeMedia, HomeNotes, HomeVault), shared across all of them through one
  `localStorage` key (`home-retro`), the same way the theme is.
  - **Off**: warm colors and fonts only. No stripes, woodgrain, raised
    buttons, rocker switches or LED segments in the storage gauge.
  - **Subtle** (default): everything from versions 1.2.0 to 1.5.0.
  - **Full**: deeper buttons (`--press` 4px), taller stripe bands (20px),
    a stronger status lamp glow, and a CRT scanline + vignette layer on the
    dashboard hero.
- `design/retro.js` (storage + apply) and `design/RetroControl.jsx` (the
  three-choice control), synced into every app by `design/sync-assets.sh`.
- `.segmented` control styles in `design/components.css`.
- `--band-height` token (stripe band thickness).
- A pre-paint script line in every `index.html`, so the page never flashes
  the wrong level on load.

### Accessibility
- The control is a proper radio group: `role="radiogroup"`, `aria-checked`,
  a roving `tabindex`, and arrow keys that move and wrap, like native radio
  buttons.
- The scanline layer is static (not motion) and kept faint; it never
  intercepts clicks (`pointer-events: none`).

## [1.5.0] — Atari refresh, phase 6 (first half): sign-in screens and icons

Every visit starts at a sign-in screen, so these got the stripes first.
The icon set also got heavier strokes so it matches the chunky look and
stays readable at small sizes.

### Added
- **Stripe band on every sign-in card** (Home, HomeCloud, HomeMedia,
  HomeNotes, HomeVault). It is added in `design/components.css` with a
  `::before` box, so no page markup changed. It is scoped to
  `.auth-screen .auth-card` on purpose: HomeCloud's Settings page reuses
  `.auth-card` for plain section cards, and those must not get stripes.
- A card can tone the band down with `--auth-band-height` and
  `--auth-band-bg`. **HomeVault** does, using a thin 4px brass line instead
  of the arcade stripes, because the safe should look restrained.

### Changed
- **Icon strokes are heavier**: frame 2 to 3, glyph 1.8 to 2.4 (both the
  `design/icons/*.svg` files and the inline `AppIcon.jsx`). Compared at
  48, 28 and 16px: details stay open (HomeMedia's lens, HomeTasks'
  checkbox), and small sidebar icons are noticeably clearer. Going
  heavier (3.4 / 3) made the HomeMedia lens fill in, so it stopped there.
  The wordmark was left alone.
- Sign-in card corners use `--radius-md` and the card gets the same raised
  edge as buttons.

## [1.4.0] — Atari refresh, phase 4: the Home dashboard hero

The dashboard now opens like the front panel of a 1970s console: a
woodgrain frame around a dark label plate, the greeting in the display
font, a one-line system status, and the four signature stripes along the
bottom edge. Each app card also gets a small rocker switch.

### Added
- **Hero header** on the Home dashboard (`.hero`, `.hero-plate`,
  `.hero-stripes`). Woodgrain appears on this one surface only, by design.
- **System status line** under the greeting, built from the health report
  the page already loads: "All systems normal", "Needs attention:
  storage", or "Checking systems…". It is always words *and* a lamp, never
  color alone, and is announced to screen readers (`role="status"`).
- **Rocker switch** on every app card: the knob slides right and lights
  amber when the app is enabled. Decorative (`aria-hidden`); the card's
  footer still says "Launch" or "Disabled" in words. Disabled apps are
  dimmed.
- A neutral "pending" lamp style for states that are not known yet.

### Fixed
- Buttons that are really links (the "Launch" button) were underlined and
  could not play the press animation, because links are inline boxes and
  `transform` does not apply to those. Shared `.btn` is now
  `inline-block` with no underline.

## [1.3.0] — Atari refresh, phase 3: shared components

Buttons, card surfaces, checkboxes and the storage gauge now come from one
shared file, `design/components.css`, instead of five near-identical
copies, and they carry the retro look: buttons are raised "console keys"
that press down, cards have a chunky outline and a faint bevel, and the
storage gauge is a striped, segmented LED bar.

### Added
- **`design/components.css`**, synced into every frontend next to
  `tokens.css` by `design/sync-assets.sh` and imported *after* each app's
  `index.css` so the shared rule wins a tie.
- New tokens `--border-width` (2px) and `--press` (3px, how far a button
  sticks up; set it to `0px` to flatten every button at once).
- Custom checkboxes (the browser default clashed with the palette),
  including the "some selected" dash state.
- `prefers-reduced-motion` support for every new transition.

### Changed
- **Storage gauge** is now four signature stripes cut into LED segments.
  Past 90% it turns red *and* says "almost full" in words, so the warning
  never depends on color alone. The bar also shows the percentage and is
  exposed to screen readers as a `meter` with its current value.
- Button, card and gauge rules were removed from the five `index.css`
  files (HomeCloud keeps one line making its buttons full-width).

## [1.2.0] — Atari refresh, phases 1 and 2: shared design tokens and self-hosted fonts

The first step of a visual refresh toward a warm 1970s Atari look (black
vinyl, cream paper, orange and brass), built the way a modern retro
product is: retro in color and material, modern in layout and
readability. This release changes the foundation only: one shared source
for the look, and fonts that no longer come from Google. The bigger
visual pieces (woodgrain hero, stripe band on screens, component
restyling) build on it in later releases.

### Added
- **`design/tokens.css`** is now the single source of truth for colors,
  corner radii, fonts, the four stripe colors and a woodgrain surface,
  plus the `.stripe-band` and `.woodgrain` helpers. `design/sync-assets.sh`
  copies it to `apps/<name>/src/styles/tokens.css` in every frontend, the
  same pattern the icons already use. Edit the `design/` copy only.
- **Display font** (Fredoka, bundled) for page and card titles. Labels,
  brand marks and numbers stay in IBM Plex Mono.
- New tokens: `--on-accent`, `--red-soft`, `--radius-sm/md/lg`,
  `--font-display`, `--stripe-1..4`, `--wood-base`, `--wood-grain`.

### Changed
- **New palette**, same token names so no component needed rewriting:
  warm brown-black dark theme ("console"), ivory light theme ("manual"),
  more orange accent, rust red, 70s teal. Contrast was checked against
  WCAG AA; a few light-theme accents on the *raised* surface land just
  under 4.5:1 and are worth a look in the polish pass.
- Corners are chunkier (`--radius-sm` 6px, `--radius-md` 10px) and status
  pills are now fully round.
- 53 hardcoded `rgba(...)` tints and 16 hardcoded hex colors across the
  five stylesheets now read the tokens (via `color-mix()`), so a future
  palette change no longer leaves stale glows behind.
- Browser and PWA chrome colors (`theme-color`, manifests) and the
  HomeSync info page follow the new page color.

### Removed
- Every Google Fonts `<link>` tag. Fonts are bundled from `@fontsource`
  packages, so pages render correctly with no internet and never contact
  a third party.

## [1.1.5] — Continuous integration; Docker and Android build fixes; dependency updates

The first release with automated checks on GitHub. `.github/workflows/`
now runs the tests, a build of every frontend, a dependency audit, a full
Docker build and boot of the whole stack, and a build of the Android app,
none of which depend on this project's development machine having Docker
or the Android SDK. Running them for the first time found real problems
that nothing had caught before: no Docker image could build since the move
to npm workspaces, two services misbehaved when the stack actually started,
and the Android app's build file and database dependency were broken under
the toolchain [1.1.4] had upgraded to. All of that is fixed below. The
release also brings `README.md` and `docs/` back in line with the repo
(test counts, versions, statuses), and includes the Dependabot updates
merged since [1.1.4].

### Fixed
- **Test counts were out of date.** `README.md` and `docs/DEVELOPMENT.md`
  said 190 across seven suites (44 / 39 / 18 / 24 / 20 / 27 / 18);
  running every suite gives 207 across eight (45 / 41 / 18 / 24 / 20 /
  28 / 20, plus 11 in `apps/homenotes`, the Markdown-sanitizer tests,
  which neither listed). `docs/DEVELOPMENT.md` also said `apps/homevault`
  was the only frontend with automated tests, which stopped being true
  once HomeNotes got its own.
- **HomeSync Android's status still read "never built"** in
  `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md` and
  `docs/ROADMAP.md`. Now says what [1.1.4] actually did: one real build
  attempt, one bug found and fixed, and the toolchain upgrades since
  still uncompiled.
- **`docs/SECURITY.md`** still introduced HomeVault as "a design
  document with no implementation yet", and still described the `qs`
  `overrides` pin that [1.1.4] removed. Both corrected, and the
  [1.1.4] Alpine/nginx bumps and Dependabot config are now recorded
  there.
- **`README.md` and `docs/ARCHITECTURE.md` called HomeVault "not yet
  security-reviewed"**, which undersold the two self-review passes in
  [1.1.0] and [1.1.3]. Now "self-reviewed twice, not independently
  reviewed" — the independent review is still the open item.
- **`docs/API.md` was missing `POST /api/admin/users/:id/reset-password`**,
  the admin-panel substitute for an email reset flow. Found by comparing
  the code's 114 route declarations against the doc.
- **`docs/ROADMAP.md`** pointed at "item 4 above" for permission
  enforcement, which isn't on that list (item 4 is the icon work), and
  still said "HomeVault: everything" was deferred. Both corrected.
- The root `package.json`'s `//test` comment listed five workspaces; the
  script actually runs all eight suites.

- **`apps/homesync-android/app/build.gradle.kts` did not compile under
  Kotlin 2.3.20**, the version [1.1.4] upgraded to. The `android {
  kotlinOptions { jvmTarget = "17" } }` block was deprecated for a long
  time and became a hard error in Kotlin 2.3 ("Using 'jvmTarget: String'
  is an error"), so Gradle failed while reading the build file itself,
  before any app code was touched. Found by the first run of
  `.github/workflows/android.yml`, which is exactly the compile-check the
  [1.1.4] entry said was missing. Replaced with the `kotlin {
  compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }` form. Not yet
  confirmed by a green run, and more errors may follow: nothing past this
  point in the build has been reached yet.

- **No Docker image could build, since the move to npm workspaces.**
  Found by the first run of `ci.yml`'s Docker job. Two problems, one
  behind the other. First, seven Dockerfiles did `COPY package.json
  package-lock.json ./` from their own folder, but the repo has one
  lockfile, at the root, so the build stopped with "package-lock.json:
  not found". Second, every backend depends on `@home/homecore-client`,
  a private package in `packages/` that isn't on npm, which a build
  limited to `apps/x-backend/` could never have installed, so fixing
  only the first would have failed at `npm ci` instead. All eleven Node
  services (six backends, five frontends) now build from the repository
  root (`build: { context: ., dockerfile: ... }` in `docker-compose.yml`)
  and install with `npm ci --workspace=<that service>`. The backends
  became two-stage builds: dependencies are installed with the compilers
  in a first stage, and only `node_modules`, the shared package and the
  service itself are copied into a plain `node:22-slim` for the final
  image (about 21 MB of installed files for HomeSync's backend, with no
  frontend libraries in it). A root `.dockerignore` keeps
  `node_modules`, every `.env`, runtime data and the docs out of the
  build context, so secrets can't end up in an image layer.
  Side effect: four frontends (`home`, `homemedia`, `homenotes`,
  `homevault`) used to run `npm install` with no lockfile, which
  contradicted the "locked dependency versions" line in
  `docs/SECURITY.md`; all eleven now use `npm ci`. Verified by repeating
  each Dockerfile's steps by hand (same `.dockerignore` exclusions, same
  `npm ci --workspace`, same file copies into a fresh runtime layout):
  all six backends boot and answer their health check, and all five
  frontends build. Not verified: the `docker build` itself, since Docker
  isn't available here, so the Docker job's next run is the real test.

- **HomeCloud's backend never became healthy in Docker.** Found by the
  Docker job's first run past the build. `docker-compose.yml` loads
  `homecore/.env` into that container (to share `HOMECORE_INTERNAL_SECRET`),
  and that file contains `PORT=4000` for HomeCore itself. The backend
  inherited it, listened on 4000, and failed its healthcheck, the gateway's
  route and its own Dockerfile, which all say 4500. Fixed with an explicit
  `PORT: "4500"` under `environment:`, which takes precedence over
  `env_file:`. Anyone following `docs/SETUP.md` would have hit the same
  thing, since the example file is copied as-is.
- **The gateway could crash on startup.** It waited only for `homecore`,
  but nginx resolves every upstream hostname once at startup and exits
  with "host not found in upstream" if one isn't running yet. Every other
  service waits for HomeCloud's backend, so the gateway started first and
  restarted in a loop until they appeared. It now waits for all six
  backends to be healthy and all five frontends to have started. This
  fixes the crash without fixing the design: a gateway that fails to start
  because one optional app is down contradicts the "graceful degradation"
  principle in `docs/ARCHITECTURE.md`, which is now `docs/ROADMAP.md`
  item 10.

- **HomeSync Android: annotation processing failed on Room 2.6.1.** Found
  by the second run of `.github/workflows/android.yml`, once the `jvmTarget`
  fix let the build get as far as resources, manifest and dependencies.
  `kspDebugKotlin` stopped with "unexpected jvm signature V", a known KSP2
  bug when an old Room processes `suspend` DAO methods that return nothing,
  which is exactly `SyncedMediaDao.insert`. The KSP maintainers' answer is
  to upgrade Room to 2.7.0 or later. `room-runtime`, `room-ktx` and
  `room-compiler` all moved from 2.6.1 to 2.8.5 (the current stable
  release), which supersedes the two Dependabot PRs that proposed the same
  bump for runtime and compiler separately, where merging either alone
  would have left the pair mismatched. The "fall back to KSP1" note that
  sat above these lines was removed, since it was a guess made before the
  failure was known. Not yet confirmed by a green run: the build has not
  yet compiled any of the app's own Kotlin sources, so more errors may
  follow.

### Changed
- **Dependency updates merged from Dependabot**, each one gated on the
  checks above. Android: Kotlin and the Compose compiler plugin 2.3.20 to
  2.4.20, KSP 2.3.10 to 2.3.12, Android Gradle Plugin 8.13.0 to 8.13.2,
  Gradle wrapper 8.13 to 8.14.5, Material Components 1.12.0 to 1.14.0,
  WorkManager 2.9.1 to 2.12.0, Retrofit 2.11.0 to 2.12.0, coroutines 1.8.1
  to 1.11.0, AndroidX test junit 1.2.1 to 1.3.0, Espresso 3.6.1 to 3.7.0.
  Docker: `alpine` 3.22 to 3.24 (backup), `nginx` 1.30 to 1.31 (the five
  frontends). npm: minor and patch bumps of `vite` (8.3.1), `dotenv`
  (18.0.4), `sharp` (0.35.5), `dompurify` (3.4.16), `marked` (18.0.14) and
  `jsdom` (30.1.1). Majors that can't be taken one at a time were closed
  and are now blocked in `.github/dependabot.yml` (see below).
- **`android.yml` installs Gradle 8.14.5**, up from 8.13, to match the
  wrapper in `apps/homesync-android/gradle/wrapper/gradle-wrapper.properties`
  that the Gradle bump above changed. The workflow installs Gradle
  separately, since the repo has no `gradlew` script, so the two have to be
  kept in step by hand. Checked by the workflow's next run.
- `.github/dependabot.yml` no longer offers minor or major updates of the
  Compose BOM, `androidx.navigation:*` or `androidx.lifecycle:*`. Found
  when the Compose BOM PR (2025.10.01 to 2026.09.00) failed `android.yml`
  with "requires Android Gradle plugin 9.1.0 or higher" and "compile
  against version 37 or later": the new BOM pulls in Navigation 2.10.2 and
  Lifecycle 2.11.0, and AGP 8.13, which the app is deliberately held on,
  caps at compileSdk 36. Patch updates still arrive. `androidx.core:core-ktx`
  is blocked only from 1.19.0 up (where it starts needing the same), so
  1.14 to 1.18.x are still offered. Added `docs/ROADMAP.md` item 11 for the
  AGP 9 migration that would lift all of this.

- `.github/dependabot.yml` groups the Kotlin, Compose-compiler and KSP
  plugins into one PR (`kotlin-toolchain`). Dependabot had opened them
  separately, and merging the Kotlin 2.4.20 PR on its own left the Compose
  plugin on 2.3.20, which `apps/homesync-android/build.gradle.kts` says
  must match Kotlin exactly. Not yet seen working: the next Kotlin bump
  should arrive as a single combined PR.

- **`gateway/Dockerfile` is pinned** to `nginx:1.31-alpine` (it was the
  floating tag `nginx:alpine`), matching the five frontends after their
  Dependabot bump. That closes the "found, not changed" note below. Checked
  by `ci.yml`'s Docker job on the next push, which builds it and sends every
  smoke-test request through it.

### Confirmed
After the fixes above, `ci.yml` (tests and frontend builds, dependency
audit, and the Docker build and smoke test) and `android.yml` (debug APK
and unit tests) all ran green on GitHub. That closes the "not yet verified"
notes in this entry: the Docker job builds every image and boots the whole
stack, and the smoke test passes through the gateway. The Android job
compiles the app and passes its unit tests. Still not verified: the app
running on a device, and a real browser session against the running stack.

### Added
- `.github/workflows/ci.yml`, three independent jobs on every push to
  `main` and every pull request. **Tests and frontend builds**: `npm
  ci`, every workspace's tests, and a production build of each
  frontend (the tests don't compile `.jsx`, so a broken import would
  otherwise pass). **Dependency audit**: `npm audit` failing only on high
  or critical, and kept as its own job so a newly published advisory
  can't make an unrelated PR's tests look red. **Docker build and smoke
  test**: builds all 13 images, boots the stack with `docker compose up
  --wait`, then goes through the gateway the way a browser would. It
  checks that every frontend is served, every backend answers its health
  check, a protected route returns 401 without a token, and a token from
  a fresh registration is accepted by HomeCloud's backend (which has no
  user database and has to ask HomeCore). This is the end-to-end boot
  `docs/ROADMAP.md` item 6 said had never been done.
- `.github/workflows/android.yml`: builds a debug APK and runs the
  Android unit tests, only when `apps/homesync-android` changes (or when
  started by hand from the Actions tab). Gradle is installed by the
  workflow directly because the repo has
  `gradle/wrapper/gradle-wrapper.properties` but not the `gradlew` script
  or wrapper jar. The APK is kept as a downloadable artifact for 14
  days. A green run proves the app compiles and its unit tests pass; it
  does not prove it runs on a device.
- A `github-actions` entry in `.github/dependabot.yml`, so the actions
  the workflows use get update PRs like everything else.
- `ignore` rules in `.github/dependabot.yml` for major bumps that can't
  be taken one PR at a time. Added after the first 24 PRs arrived. Node
  (11 PRs, one per Dockerfile, some to 25 and some to 26: Node 25 is an
  odd-numbered release that went end-of-life on 2026-06-01, and the mix
  would have left the services on different Node versions while CI and
  the docs say 22). `better-sqlite3` 13, already tried and reverted in
  [1.1.4]. Android Gradle Plugin 9 with Gradle 9, and Retrofit/OkHttp
  majors, which each need their sibling artifacts moved in the same
  change. Minor and patch updates of all of these still arrive normally.
- `docs/ROADMAP.md` items 7 (pin the gateway image) and 8 (triage
  Dependabot's first PRs).
- A "Continuous integration" section in `docs/DEVELOPMENT.md`.

Verified on the release commit's tree: `npm ci` on Node 22 is clean, all
207 tests pass (45 / 41 / 18 / 24 / 20 / 28 / 20 / 11 across the eight
suites), all 5 frontends build, and `npm audit` reports 0 vulnerabilities.
The CI workflows, including the Docker boot and the Android build, ran
green on GitHub before the dependency PRs above were merged. Not verified:
the Android app running on a device, a real browser session against the
running stack, `docs/API.md` beyond a rough automated comparison of route
names against the code, and the Gradle 8.14.5 change to `android.yml`
above until its first run.

## [1.1.4] — First real HomeSync Android build; full dependency audit

The roadmap's next two items after [1.1.3]: `apps/homesync-android`'s
actual first Gradle sync/build (never previously run against a real
Android toolchain), and a full outdated/deprecated dependency sweep
across the whole repo. Both surfaced real, fixable problems.

### Fixed
- **`apps/homesync-android` failed its first real build**: AAPT
  couldn't link `Theme.Material3.DayNight.NoActionBar`, the parent
  style `themes.xml` inherits from. That style ships in the classic
  Material Components library, not in Compose's
  `androidx.compose.material3:material3` — the only Material artifact
  the project declared. Static review never caught this since imports
  still resolved; it only surfaces once AAPT actually tries to link
  resources. Added `com.google.android.material:material:1.12.0`.
- **The Windows dev launcher (`scripts/dev-home-ui.ps1`) failed with
  `Environment variable <path> not defined`** for every service. Root
  cause: each service was launched as one long `cmd /k` command line
  (`cd /d "..." && set "K=V" && set "K=V" && ... && npm run dev`)
  built through PowerShell's own argument quoting, ending up with a
  dozen-plus embedded `"` characters. `cmd.exe` only reliably preserves
  quoting when the whole line has *exactly two* quote characters; past
  that it falls back to a crude "strip the first quote, strip the
  last quote" rule, which can sever a `set "KEY=VALUE"` from its value
  entirely. Rewrote to write each service's commands to its own temp
  `.bat` file and hand `cmd /k` just that one file path instead — a
  single, unambiguous quoted argument.
- **`services/backup/Dockerfile` was on Alpine 3.20**, which reached
  end-of-life on 2026-04-30 (confirmed against Alpine's own EOL
  schedule, not assumed) and receives no further security patches.
  Bumped to `alpine:3.22`.
- **Five frontend Dockerfiles (`apps/home`, `homecloud`, `homemedia`,
  `homenotes`, `homevault`) were pinned to `nginx:1.27-alpine`**,
  missing several CVE fixes already backported to the `1.30` stable
  line (buffer overflow and memory-disclosure fixes across
  `ngx_http_v3_module`, `ngx_http_proxy_v2_module`,
  `ngx_http_slice_module`, and others). Bumped to `nginx:1.30-alpine`.
- Removed the `qs` override in the root `package.json`. It was a
  workaround for an advisory in Express 4's own dependency tree (see
  [1.0.0]); Express 5 (below) resolves a patched `qs` on its own —
  confirmed via `npm ls qs` and `npm audit` (0 vulnerabilities) with
  the override removed, not assumed.

### Changed — dependency bumps, each verified before and after
- `express` `^4.19.2` → `^5.2.1`, `express-rate-limit` `^7.4.0` →
  `^8.7.0`, `helmet` `^7.1.0` → `^8.3.0`, `dotenv` `^16.4.5` → `^18.0.0`
  across every backend. Checked every route/middleware call site first
  for Express 5's known breaking patterns (wildcard routes, `app.del`,
  `req.param()`, custom rate-limit option names) — none present.
- `bcryptjs` `^2.4.3` → `^3.0.3` in `homecore` — auth-critical, so
  confirmed `hash`/`compare`'s async signature is unchanged before
  touching it (bcryptjs 3's breaking changes are ESM packaging and a
  `$2b$` hash-prefix default; `compare()` still verifies `$2a$` hashes
  fine).
- `marked` `^13.0.3` → `^18.0.13` in `homenotes` — already used the
  stable `.parse()` API with no custom renderer; all 11 markdown
  sanitization tests (including the malicious-payload ones) still
  pass.
- `react`/`react-dom` `^18.3.1` → `^19.3.0` across all 5 frontends —
  every entrypoint already used `createRoot`, with no `defaultProps`,
  `PropTypes`, string refs, or other legacy pattern anywhere in the
  codebase.
- Attempted `better-sqlite3` `^11.3.0` → `^13.0.3` to clear a
  `prebuild-install@7.1.3` deprecation warning (v13 bundles prebuilt
  binaries directly rather than fetching them at install time).
  **Reverted after finding a real regression**: a plain `npm install`
  against the *committed* lockfile (as opposed to one that regenerates
  it from scratch) reliably tried to compile from source instead of
  using the bundled binary, needing a C++ toolchain most Windows dev
  machines don't have. Reproduced 3/3 times against the exact
  unzip-then-`npm install` workflow before reverting. Left at
  `^11.10.0` — a cosmetic deprecation warning beats a build that
  doesn't complete.
- Android/Gradle stack in `apps/homesync-android`: AGP `8.5.2` →
  `8.13.0` (the last 8.x release — deliberately not 9.x, which bundles
  its own Kotlin support and conflicts with the separately-applied
  `org.jetbrains.kotlin.android` plugin here), Kotlin `1.9.24` →
  `2.3.20`, KSP → `2.3.10`, Gradle wrapper `8.7` → `8.13`, Compose BOM
  `2024.06.00` → `2025.10.01`, `compileSdk` `34` → `36` (`targetSdk`
  deliberately left at 34 — a runtime-behavior commitment worth its
  own deliberate pass, not a side effect of a dependency refresh).
  Kotlin 2.0+ moves the Compose compiler into its own Gradle plugin;
  added `org.jetbrains.kotlin.plugin.compose` and removed the now-dead
  `composeOptions { kotlinCompilerExtensionVersion }` block.

### Added
- `.github/dependabot.yml`: one `npm` entry at the workspace root
  (workspace-aware — pointing Dependabot at individual app folders
  instead is a documented way to get PRs that edit a `package.json`
  without updating the lockfile that actually governs the install),
  one `gradle` entry for `apps/homesync-android`, and two `docker`
  entries covering all 13 Dockerfiles, grouped by shared base image.

### Known limitation of this entry
- The Android/Gradle changes above are not compile-verified — this
  work was done from an environment with no Android SDK/AAPT
  toolchain available, unlike the AAPT fix above (which *was* diffed
  against the actual failing build output). Reasoned through against
  each tool's own release notes and compatibility tables, but that is
  not the same as watching a Gradle sync succeed.

Verified (JS/Node side only, per the limitation above): all 207 tests
pass, all 5 frontends build clean, `npm audit` reports 0
vulnerabilities, `npm outdated` is clean except the deliberately-kept
`better-sqlite3` `11.10.0`.

## [1.1.3] — HomeVault: a deeper, adversarial self-review pass

No independent security/cryptography reviewer is available for this
project (see `docs/SECURITY.md`'s HomeVault status callout — that
remains the honest, unchanged bottom line). This is a second pass at
`apps/homevault/src/crypto.js` and the actual unlock/setup/recovery/
settings flows that's different in kind from the one that shipped with
[1.1.0]: not "does the code match the design doc" but deliberately
trying to find a way to break it, the way a real reviewer would start.

### Fixed
- **A mistyped recovery-key character was silently dropped rather than
  flagged.** `parseRecoveryKey` stripped anything outside its base32
  alphabet before decoding, so a single transcription error just
  produced a different, wrong 32-byte key — which safely failed to
  unwrap the vault (AES-GCM's own authentication tag still caught it;
  this was never a confidentiality issue), but with a generic "doesn't
  match this vault" message and no indication where the typo was, in
  exactly the flow that exists because the primary path already failed.
  Fixed by giving the recovery key format a trailing checksum character
  (CRC-8, deliberately non-cryptographic — its only job is catching an
  accidental typo before wasting an unwrap attempt, not resisting a
  deliberate attacker, who could trivially recompute it). A mistyped
  character now fails immediately with a distinct "Recovery key has a
  typo" message. 2 new tests
  (`apps/homevault/test/crypto.test.js`): a single flipped character is
  rejected before any unwrap is attempted, and a correctly-transcribed
  key (checksum included) still round-trips.
- **Copying the recovery key to the clipboard had no auto-clear.**
  Bitwarden and 1Password both clear the clipboard a short while after
  copying a credential, specifically because clipboard managers,
  clipboard history, and cross-device clipboard sync can otherwise keep
  an indefinitely-live copy of a key that can never be reissued if it
  leaks. Added a 30-second auto-clear (write an empty string,
  unconditionally, rather than reading the clipboard back first to
  check — avoids needing clipboard-read permission for this) to both
  places the recovery key can be copied (`Setup.jsx`, initial creation;
  `Settings.jsx`, regeneration), with a "Copied — clears in 30s" label
  so it's not a silent behavior change.
- A code comment in `crypto.js` described the "wrong password" verifier
  check backwards — "encrypting it and comparing the result," which
  would actually be broken given AES-GCM's random per-encryption IVs
  (the same plaintext encrypts to different ciphertext every time). The
  actual code was always correct — decrypt the stored verifier with the
  freshly-derived key and compare plaintext, relying on AES-GCM's own
  authentication tag to reject a wrong key before the comparison even
  matters. Fixed the comment to describe what the code actually does.

### Investigated, confirmed no issue
- No `Math.random()` anywhere in HomeVault's security-critical path —
  every salt, key, and IV goes through `crypto.getRandomValues` /
  `crypto.subtle.generateKey`.
- IVs are never caller-suppliable and are freshly generated per call;
  confirmed by tracing the actual encrypt call sites in `ItemDetail.jsx`
  that a title and its item data get independent IVs even within the
  same item, not just by reading the `encryptBytes` implementation and
  assuming callers use it correctly.
- Salt and KDF parameters are correctly persisted per-vault and passed
  in from stored server data on every unlock attempt, never
  regenerated locally (which would have permanently locked people out
  of their own vault).
- Recovery-key rotation exists (`Settings.jsx`) and correctly
  invalidates the previously-issued recovery key; the recovery key
  itself is never sent to or stored on the server, confirmed by
  checking the actual `api.vault.create()`/`rewrap()` payloads, not
  just the code that generates it.
- **A nuance worth recording, not a new hole**: the master- and
  recovery-wrapping keys are imported non-extractable
  (`importAesKeyRaw`), but the vault key itself has to stay extractable
  (`generateVaultKey`) so it can be re-wrapped under a new password or
  a new recovery key. Since the vault key is the one that actually
  matters, the non-extractable choice on the wrapping keys provides
  less real protection than it might look like — it doesn't change the
  already-documented "Shared-origin XSS" exposure in `docs/SECURITY.md`
  at all. Recorded here for honesty, not treated as something to fix,
  since there's no way to make the vault key non-extractable without
  breaking password/recovery-key rotation entirely.

Verified: all 207 tests pass (was 205; +2 recovery-key checksum tests),
`apps/homevault` builds clean.

## [1.1.2] — Clearing the [1.1.1] security review's open items

Follow-up to [1.1.1]: fixes the `vite`/`esbuild` advisories that
review deliberately deferred, plus one more finding surfaced while
checking compatibility for that fix — an EOL base image affecting
every service, not just the frontends.

### Fixed
- **All four `vite`/`esbuild` dev-server advisories**
  ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
  [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9),
  [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3),
  [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff))
  — `vite` bumped `^5.4.20` → `^8.3.0` and `@vitejs/plugin-react`
  `^4.3.1` → `^6.1.1` across all five frontends. `npm audit` goes from
  4 advisories (1 high, 3 moderate) to 0. Checked the vite 5→8 migration
  notes against every frontend's actual `vite.config.js` first — plain
  `react()` plugin, `server.port`/`proxy`/`base` only, nothing
  esbuild-specific or SSR-specific — so this landed with zero config
  changes needed, matching what Vite's own migration guide says to
  expect for a project shaped like this. Verified, not just built
  clean: each frontend's dev server was actually started and hit with
  a real request (confirmed React Fast Refresh injection and the JSX
  transform both still work), on top of all five production builds
  succeeding and the full test suite still passing.
- **Every Dockerfile in the repo (all 11 — every frontend and every
  backend) was pinned to `node:20-slim`.** Found as a side effect of
  checking Node-version compatibility for the `vite@8` upgrade above,
  not something this review went looking for — and confirmed against
  Node's own release schedule, not assumed: **Node.js 20 reached
  end-of-life on 2026-04-30** and has received no security patches
  since. Unlike the `vite` advisories above, this one is not dev-only —
  it's every service's actual production base image. Bumped to
  `node:22-slim` (Maintenance LTS, security support through
  2027-04-30) in all 11 Dockerfiles, and `docs/DEVELOPMENT.md`'s
  "Node.js 20+" prerequisite to "Node.js 22+" to match. Checked first
  that this doesn't trip a `better-sqlite3` requirement this project
  can't meet yet: confirmed directly (not by reading the registry's
  "latest" dist-tag, which is an unrelated, much newer 13.x line with
  its own newer floor) that the version this project's `^11.3.0` range
  actually resolves to, 11.10.0, declares no `engines` constraint at
  all.

### Known limitation of this entry
- The Dockerfile change above was made from an environment without
  Docker available, so `docker-compose build && docker-compose up`
  was never actually run against it. The change itself is low-risk
  (same Debian base as `node:20-slim`, same package manager, nothing
  else in any Dockerfile references a Node-20-specific detail) and was
  reasoned through carefully, but reasoning through a Docker change
  and watching it boot are different kinds of confidence — see
  `docs/ROADMAP.md`.

Verified: all 205 tests still pass, all 5 frontends build clean against
`vite@8`, `npm audit` reports 0 vulnerabilities (was 4).

## [1.1.1] — Security review pass

A self-review of the whole codebase (no independent audit available —
see `README.md`), done by me (Claude) after the [1.1.0] release,
following the same "verify empirically, don't infer" discipline as
everywhere else in this project: every finding below was reproduced or
disproved directly, not assumed, before being written up or fixed.

### Fixed
- **Real, confirmed stored XSS in HomeNotes**
  (`apps/homenotes/src/pages/NoteEditor.jsx`): the Markdown preview
  rendered `marked.parse()` output straight into `dangerouslySetInnerHTML`
  with zero sanitization. Confirmed empirically that `marked` passes
  `<script>`, `onerror=`, and `javascript:` URIs straight through
  unescaped. Because every app sits behind the same gateway origin, a
  script injected via a note could read every app's token out of
  `localStorage` — HomeVault's included — a live, concrete instance of
  `docs/SECURITY.md`'s "Shared-origin XSS" threat, not just the
  abstract case it originally described. Fixed by extracting rendering
  into `renderMarkdownToSafeHtml()` (new file,
  `apps/homenotes/src/markdown.js`), piping `marked`'s output through
  `DOMPurify.sanitize()`. 11 new tests
  (`apps/homenotes/test/markdown.test.js`) cover real payloads
  (`<script>`, `<img onerror>`, `javascript:` hrefs, `<iframe>`,
  `<svg onload>`, `<style>`) plus legitimate-Markdown-still-works
  checks; confirmed the malicious-payload tests fail without the fix
  and pass with it (temporarily reverted, ran, restored — same
  discipline as the foreign-keys item below).
- **`docs/ARCHITECTURE.md` §5 incorrectly claimed the gateway's single
  origin gives every frontend a shared login**, via one common
  `homecloud_token` key in `localStorage`. Not what the code does, and
  never was: each frontend keeps its own key (`home_token`,
  `homecloud_token`, `homemedia_token`, `homenotes_token`,
  `homevault_token`) and logs in independently against HomeCore, with
  no session-sharing mechanism (no shared cookie, no cross-app token
  forwarding, no silent re-auth) anywhere in the codebase. Corrected;
  the doc now also explains what the single origin actually buys
  (simpler routing, one future TLS termination point) and the "shared
  attack surface" that's the real flip side of it.
- Explicit `algorithms: ["HS256"]` allow-list added to both
  `jwt.verify()` call sites (`homecore/src/middleware/authMiddleware.js`,
  `homecore/src/auth.js`'s `/2fa/verify`). **Investigated as a possible
  bug, then disproved**: confirmed directly against the pinned
  `jsonwebtoken@9.0.3` that a forged `alg: "none"` token is already
  rejected by default, and the classic RS256-signed-as-HS256 confusion
  attack has nothing to attach to here since this project only ever
  signs with one HMAC secret — no keypair exists anywhere for an
  attacker to redirect verification onto. Pinned the allow-list anyway
  as defense-in-depth against a future change, with a new regression
  test (`homecore/test/auth.test.js`) asserting a forged `alg:none`
  token is rejected.

### Added
- `foreign_keys = ON` pragma set explicitly in
  `apps/homecloud-backend/src/db.js` and
  `apps/homevault-backend/src/db.js`, plus real cascade-delete tests
  that didn't exist before
  (`apps/homecloud-backend/test/folders.test.js`,
  `apps/homecloud-backend/test/publicShare.test.js`,
  `apps/homevault-backend/test/vault.test.js`). **Investigated as a
  possible bug, then disproved**: the pinned `better-sqlite3` version
  already defaults foreign-key enforcement on, so `ON DELETE CASCADE`
  was never silently broken — set explicitly anyway as
  defense-in-depth against a future dependency change, not because
  anything was actually wrong.
- `docs/SECURITY.md`: documented the HomeNotes XSS finding and fix
  (Part A and the "Shared-origin XSS" threat-catalog row), a confirmed
  (not assumed) account of every backend's `CORS_ORIGIN` shipping unset
  (`*`) in `docker-compose.yml` today and why the practical risk is low
  given this ecosystem's Bearer-token-only auth, and a minor, low-severity
  note that `/api/auth/login` reveals whether a disabled account exists
  via a distinct error message (deliberate trade-off, left as-is).

### Investigated, confirmed no issue
- **Every `dangerouslySetInnerHTML`/raw-HTML-injection site outside
  HomeNotes** — re-confirmed via grep across every backend and
  frontend's `src/` tree that HomeNotes' (now-sanitized) site is the
  only one; no `.innerHTML` assignment, `eval()`, `new Function()`, or
  raw-HTML `res.send()` anywhere either.
- **IDOR / ownership checks** — spot-checked every route across
  HomeCloud, HomeMedia, HomeNotes, HomeSync, and HomeVault (HomeCloud's
  files/folders, HomeMedia's collections/library, HomeNotes'
  notes/noteFolders, HomeSync's devices/sync, HomeVault's items/vault)
  plus HomeCore's admin routes. Every route that touches one specific
  resource either scopes its query by `user_id` directly, or delegates
  the check transitively through another service's own
  token-scoped API (HomeMedia's `downloadFile(req.token, fileId)`,
  same "delegated auth" pattern `docs/ARCHITECTURE.md` already
  documents). HomeCore's admin routes intentionally act on any user —
  gated by `requireAuth, requireAdmin` on the whole router, not a bug.
- **Rate limiting coverage** — every brute-forceable HomeCore auth
  route (`register`, `login`, `2fa/verify`, `change-password`,
  `2fa/setup`, `2fa/confirm`, `2fa/disable`, `2fa/recovery-codes`) has
  `authLimiter`; HomeCloud's share-link route has its own
  `shareLimiter`. HomeVault's routes have none, correctly — nothing
  in `apps/homevault-backend` ever verifies a password server-side
  (see `docs/SECURITY.md`'s HomeVault architecture), so there's
  nothing there for a rate limiter to protect.
- **File upload handling** (`apps/homecloud-backend/src/files.js`) —
  confirmed empirically that `path.extname()` never returns a path
  separator even when fed a traversal-style filename, and every stored
  filename is a server-generated `crypto.randomUUID()`, never derived
  from user input; download/thumbnail routes only ever read
  `stored_name`/`thumbnail_name` off the DB row, never a client-supplied
  path. The user-supplied `original_name` is only ever used as
  `res.download()`'s suggested filename (a header value, not a path).
- **Error message information leakage** — every backend's fallback
  error handler logs the full error server-side but returns only
  `err.message` for errors deliberately thrown with a `.status` (safe,
  expected messages like "Destination folder not found") and a generic
  "Internal server error." for anything else; no stack traces or
  internal paths ever reach a client.

### Known, not fixed here
- `vite`/`esbuild`'s dev-server advisories have grown since [1.1.0]:
  `npm audit` now reports **four**, not one — including a new **high**-severity
  one ([GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff),
  a `server.fs.deny` bypass on Windows). All four are dev-server-only by
  their own descriptions, same as the original; fixing all of them
  still means the same `vite@8` breaking major upgrade already planned
  — not forced through here for the same reason as before (needs
  dedicated per-frontend dev/build verification time) — but the
  severity increase is worth moving up in priority. See
  `docs/SECURITY.md` and `docs/ROADMAP.md`.

Verified: all 205 tests pass (was 190; +11 HomeNotes markdown
sanitization, +1 JWT alg:none regression, +3 foreign-key cascade tests
across HomeCloud/HomeVault), all 5 frontends build clean.

## [1.1.0] — HomeVault v0

The first new application since the [1.0.0] handoff cleanup — a
client-side-encrypted password/secrets manager, per the build order
decided below. **v0 is built and tested; it has not had an independent
security review** — see `docs/SECURITY.md`'s v0 status callout before
storing anything real in it. This release also folds in a full pass
resolving every decision left open by the handoff cleanup, and adding
the two governing spec documents that were missing from the repo.

### Added — HomeVault v0
- `apps/homevault-backend` (port 4600) — stores only ciphertext and
  public KDF parameters; structurally cannot decrypt anything it holds.
  The first app with zero dependency on `apps/homecloud-backend`. 27
  tests.
- `apps/homevault` (port 5177) — vault creation with a one-time
  recovery-kit display, unlock, recovery (lost password → recovery key
  → set a new one), item list/create/edit/delete (login/note/card
  types), settings (change master password, regenerate recovery kit,
  delete vault). `src/crypto.js` — the actual envelope encryption
  (Argon2id via `hash-wasm`, AES-256-GCM via the Web Crypto API) — is
  framework-free specifically so it has its own 18 tests, run in
  complete isolation from any UI, the same way HomeSync's
  `pathPlanner.js` is tested apart from Android.
- Registered in HomeCore's application registry, the gateway, and
  `docker-compose.yml`, following the existing patterns exactly. Added
  to the Windows dev launcher (`scripts/dev-home-ui.ps1`) as a new
  optional checkbox.
- `docs/SECURITY.md`'s HomeVault section now states plainly what's been
  verified by automated test, what was followed exactly as designed,
  and what still needs human review — not just the original design.

### Added
- `LICENSE` — proprietary, all rights reserved. Deliberately the most
  restrictive default (easy to relax later, hard to undo the other way).
- The two governing spec documents (`HOME_MASTER_SPECIFICATION.md`,
  `HOME_ARTISTIC_DIRECTION.md`) to the repo root — previously cited by
  section number throughout the codebase but absent from the repository
  itself (flagged during the [1.0.0] cleanup). Cross-checked a sample of
  citations against them: the implementation matches the spec's intent
  everywhere checked, with one real, documented deviation — see
  `docs/ARCHITECTURE.md`'s note and the roadmap item on
  `/api/auth`/`/api/admin`/`/api/activity` not being nested under
  `/api/core` the way §10 suggests. Tightened `docs/SECURITY.md`'s
  permission-enforcement note with the precise citation (§28, layer 3).

### Fixed
- A moderate-severity `qs` advisory, pulled in transitively through
  every backend's `express`/`body-parser`, patched via an `overrides`
  pin rather than a breaking Express 5 upgrade — see root
  `package.json`'s comment. `npm audit`: 5 vulnerabilities → 1
  (moderate, dev-server-only — see below).
- A stale `TRANSITIONAL` comment reference in
  `apps/homecloud-backend/test/helpers/client.js`, and three stale
  pre-gateway comments in `theme.js` across `apps/home`,
  `apps/homemedia`, `apps/homenotes`, found while working nearby.

### Known, not fixed here
- `vite`/`esbuild`'s moderate dev-server advisory remains — fixing it
  needs `vite@8`, a breaking upgrade across all five frontends. Flagged
  in `docs/ROADMAP.md` and `docs/SECURITY.md` rather than forced through
  without dedicated testing time.

### Decided (see the linked doc for each; recorded so the reasoning isn't lost)
- Version: 1.1.0 for this release.
- TLS: private overlay network (Tailscale/WireGuard) is the supported
  path to remote access, not a public reverse-proxy cert — `SECURITY.md`.
- HomeVault stays on the shared origin, hardened with a strict CSP,
  rather than a separate origin — `SECURITY.md`.
- HomeBridge's background-trigger auth: a scoped service credential
  HomeCore mints, not per-app shared-secret endpoints — `ARCHITECTURE.md`.
- Permission enforcement: deferred until HomeVault actually needs it,
  not built speculatively ahead of a consumer — `SECURITY.md`.
- Shared secrets between services stay as a shared `.env` file; no
  secrets manager introduced at this scale — `ARCHITECTURE.md`.
- Build order: HomeVault → HomeTasks → HomeBridge → HomeMonitor →
  HomeAI — `ROADMAP.md`.
- HomeCloud's owner-only file sharing stays as-is until a feature
  forces a real multi-user ACL model — `ARCHITECTURE.md`.
- Account deletion stays disable-only, permanently — no hard delete
  flow planned — `ARCHITECTURE.md`.
- Home's per-app dashboard stat stays hardcoded per app rather than a
  generic manifest field, for now.
- Design: the `#C99A3B` accent color and the current placeholder
  sans-serif typeface are both final, not pending a future pick —
  `DESIGN_SYSTEM.md`.
- HomeSync: whole-file retry (not chunked/resumable upload) and
  WorkManager's built-in battery constraint (not a numeric threshold)
  are both final designs, not gaps — `ROADMAP.md`.
- The still-missing `HOME_MASTER_SPECIFICATION.md` /
  `HOME_ARTISTIC_DIRECTION.md` remain an open item, not resolved here —
  `ARCHITECTURE.md`.

## [1.0.0] — Handoff cleanup pass

A full audit pass with no new features: verified every claim in the docs
against the actual code and test suites, fixed what didn't match, and
replaced the documentation set with a smaller, current-state-only one.

### Fixed
- HomeCloud, HomeMedia, and HomeNotes' frontends now pass `basename` to
  `<BrowserRouter>`. Without it, refreshing the page, opening a bookmark,
  or following a direct link to anything other than the app's exact root
  path (e.g. `/cloud/settings`) silently redirected to Home instead of
  loading the intended page.
- HomeCloud's service worker now registers at a base-aware path instead
  of a hardcoded `/sw.js`, which the gateway routed to Home, not
  HomeCloud — the service worker never actually activated.
- The gateway's `/sync/` route now targets `homesync-backend`'s real port
  (`4300`); it previously omitted the port entirely, which would 502.
- Fixed a leftover `[homecloud]` log-line prefix in three places inside
  `homecore/` (a service that has not been called "homecloud" since it
  was split out).
- `apps/homecloud-backend/.env` and its local database directory were
  missing from `.gitignore` — a real secret or local file/folder database
  could have been committed by accident. Added, and added the
  `.env.example` this service was missing entirely.

### Changed
- Renamed the env var/const `HOMECLOUD_URL` / `HOMECLOUD_INTERNAL_URL`
  (misleadingly named — it points at HomeCore, not HomeCloud) to
  `HOMECORE_URL` / `HOMECORE_INTERNAL_URL` everywhere, and the matching
  `homecloudUrl` health-check field to `homecoreUrl`.
- Renamed the Docker volume `homecloud_data` (it actually held HomeCore's
  database — a naming leftover from before the two were split into
  separate services) to `homecore_data`. Renamed HomeCore's own database
  file from `homecloud.db` to `homecore.db` for the same reason.
- Removed three dependencies (`sharp`, `multer`, `yazl`) from
  `homecore/package.json` — leftover from before file storage moved to
  `apps/homecloud-backend`; nothing in HomeCore imports them anymore.
- Rewrote every source comment that narrated the HomeCore/HomeCloud
  split as it happened ("Phase N of MIGRATION_PLAN.md") into a plain,
  present-tense description of how the code works now. The file being
  cited no longer exists (see Removed) and the narration made the
  reason for a design choice harder to find, not easier.
- Corrected four `package.json` `description` fields that described a
  transitional state that's since been completed (e.g. `homecore`'s said
  it "currently runs both HomeCore and HomeCloud's file-storage API in
  one process," which stopped being true once they were split).

### Removed
- `scripts/migrate-legacy-homecloud-data.js` and its Dockerfile, and the
  `migrate-legacy-data` Compose service — a one-time tool for moving data
  out of the pre-split, single-process layout. Not needed for a new
  deployment.
- `MIGRATION.md`, `MIGRATION_PLAN.md`, `VERSIONING.md` — process
  narrative from the HomeCore/HomeCloud split and early repo setup, both
  now finished. Full detail is preserved in git history for anyone who
  needs it; the architectural facts that are still true today live in
  `docs/ARCHITECTURE.md` instead.
- Root `README.md` and `docs/` were rewritten from scratch — see below.

### Documentation
- Replaced the ~1,600-line root `README.md` with a standard project
  README: what this is, quick start, project layout, and links out.
- Replaced `docs/` (previously nine files including a stale index) with:
  `ARCHITECTURE.md`, `SECURITY.md`, `API.md`, `DEVELOPMENT.md`,
  `DEPLOYMENT.md`, `DESIGN_SYSTEM.md`, and `ROADMAP.md` — each describing
  current, verified state, not the process of getting here.
- Added root `CONTRIBUTING.md`.
- **No `LICENSE` file exists in this repository.** That's a decision for
  whoever owns the project going forward, not something to guess at; see
  `README.md`.

## Earlier history (condensed)

The full detail for everything below is in git history and each
commit's own message. This is an orientation summary, not a ledger.

- **[0.9.x]** HomeCore and HomeCloud split into two genuinely separate
  services, each with its own process, database, and container —
  HomeCore now owns only identity/sessions/permissions/the app registry/
  the shared event feed; HomeCloud's files/folders/sharing moved to its
  own `apps/homecloud-backend`. The backup service was generalized to
  cover every app's volume instead of one hardcoded one.
- **[0.4.0]–[0.6.0]** `packages/homecore-client` extracted (the
  token-verification logic HomeMedia, HomeSync, and HomeNotes'
  backends each used to duplicate).
- **[0.2.0]–[0.3.0]** The icon set (9 app icons + wordmark) and HomeSync
  Android's networking/local-database layer, both previously designed
  but not present in the repository, were built out and integrated.
- **[0.1.0]** First git commit. Docker Compose project name pinned
  (`name: home`) to stop volumes silently changing across re-extracted
  copies of the repo; `.gitignore` updated to match the actual tree.
- **Before [0.1.0]** HomeCloud built and stabilized first (accounts,
  auth, 2FA, quotas, trash, sharing, admin panel). HomeCore introduced
  next, initially embedded in HomeCloud's own process. HomeMedia and
  HomeSync's backends built as genuinely separate services from the
  start. The gateway was introduced, accidentally dropped for a period
  during parallel work on different apps, then restored — the incident
  that motivated `docs/ARCHITECTURE.md`'s Tier 0/1/2 layering rule.
  HomeNotes was added as a fourth Tier 1 app.
