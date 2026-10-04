# Design system

Non-technical on purpose — this is the visual/emotional companion to
`ARCHITECTURE.md`, meant to guide anyone designing a screen for Home,
HomeCloud, or any future application.

## The central idea

**Home should feel like your own private digital place** — not a
corporate SaaS dashboard, not a hacker terminal, not generic
glassmorphism. Somewhere between a beautifully organized personal
computer, a quiet private server room, and a modern OS. The suite should
be quietly sophisticated, not loudly impressive.

> Everything here belongs to you, is organized by you, and is under your
> control.

## The Atari direction (since 1.2.0)

Home has a visual identity now: **Atari, 1977, built today.** Warm black
vinyl, cream paper, orange and brass, painted stripes, a little woodgrain.
The idea is the one a modern retro-styled car follows: **retro in color,
material and small details; modern in layout, readability and
accessibility.** File lists, forms and settings stay clean and quick to
read. The retro lives at the edges.

The rules that keep it tasteful:

- **One hero detail per screen.** Woodgrain appears on exactly one surface
  (Home's dashboard header). Everything else gets quieter touches.
- **Physical, never neon.** The 1970s look is wood, plastic and painted
  stripes. **No glow, anywhere**: no blurred `box-shadow`, no
  `text-shadow`, no pulsing halos. Shadows are hard-edged ("a wall under
  the button"), never soft. A lamp is a solid dot with a hard underside
  shadow, like a molded dome.
- **Take the feel, not the assets.** Never copy Atari's logo, wordmark or
  other trademarks.
- **Retro is a dial, not a mandate.** Every person can turn it down (see
  *Retro intensity* below). The default is deliberately Subtle.
- **Everything in the sections above still applies**: semantic color,
  never color alone for meaning, reduced motion, visible focus.

### The palette

All values live in `design/tokens.css` (this table was generated from that
file). Components use the *names* (`var(--amber)`), never the hex values.

| Token | Dark ("console") | Light ("manual") | Role |
|---|---|---|---|
| `--bg` | `#17120e` | `#f3e9d2` | Page background |
| `--panel` | `#221a13` | `#ebdfc3` | Cards, sidebars |
| `--panel-raised` | `#2d231a` | `#e0d2b0` | Things sitting on cards: menus, hovered rows |
| `--border` | `#4a3a2b` | `#cdbb94` | Dividers and outlines |
| `--text` | `#f2e6cf` | `#2b2118` | Main text |
| `--text-dim` | `#b0a088` | `#66563f` | Secondary text: hints, timestamps |
| `--amber` | `#e0892b` | `#834909` | Brand accent, and "needs attention" |
| `--amber-dim` | `#7d5426` | `#b9946a` | Quiet version of the accent |
| `--teal` | `#4aaaa5` | `#235f5f` | "Healthy" and informational |
| `--red` | `#e0664a` | `#a03522` | "Danger" |
| `--on-accent` | `#1f1205` | `#fff6e6` | Text sitting on an accent-colored surface |

Dark is warm brown-black, never cool gray, and surfaces get lighter as
they rise. Light is ivory paper, where surfaces get slightly *darker* as
they rise (you can't go lighter than paper) and accents are deepened so
they stay readable. Four **stripe colors** (`--stripe-1` to `--stripe-4`:
gold, orange, rust, brown) make the signature band, and `--wood-base` /
`--wood-grain` make the woodgrain. The accent is orange, with the quiet
`--amber-dim` as its companion. Status colors keep their meaning:
amber attention, teal healthy, rust red danger.

### Type

- **Headings:** Fredoka, a chunky rounded face (`--font-display`).
- **Reading text:** Inter (`--font-sans`).
- **Labels, numbers, file names, readouts:** IBM Plex Mono (`--font-mono`).

All three are bundled from `@fontsource` packages, **not loaded from a
CDN**: Home has to work with no internet, and a page should never phone a
third party just to draw itself. (The old "no futuristic display fonts for
normal UI" rule still holds: Fredoka is for headings, which the artistic
direction already allows to have personality.)

### Retro intensity: Off / Subtle / Full

A setting in every app's Settings page, independent of light/dark and
shared across all apps (one `localStorage` key, `home-retro`).

| Level | What you get |
|---|---|
| **Off** | Warm colors and fonts only. No stripes, woodgrain, raised buttons, rocker switches, cartridge label strips, print frames or ruled paper. The storage gauge becomes a plain solid bar. |
| **Subtle** (default) | Stripe bands, the woodgrain dashboard header, raised "console key" buttons, cartridge folders, print frames, ruled note paper. |
| **Full** | Louder: deeper buttons, taller stripe bands, and CRT scanlines with darkened edges over the dashboard header and the HomeMedia lightbox. |

Full is still glow-free: the scanlines are thin dark lines and a darkened
edge, and no light spills out of anything. If you add a retro effect, give
it an Off behavior too, and keep anything that *adds* intensity out of
Subtle.

### How each room wears it

| App | Room | Atari expression |
|---|---|---|
| Home | Entrance | Woodgrain header on a dark label plate, stripe band, rocker switch on each app card showing on/off |
| HomeCloud | Archive | Folders as cartridges (striped label strip), label-plate table header, amber edge on the row you point at, a drive-activity LED that flashes flat |
| HomeMedia | Gallery | Photos as prints: heavier borders, albums as a stack, cream print frame in the lightbox |
| HomeNotes | Study | Ruled paper that scrolls with the writing, index-card hover |
| HomeVault | The safe | Restrained on purpose: a thin brass line instead of stripes, only a brass edge on hover |
| HomeSync | Connection | The Android app wears the same palette (`Color.kt`); it has no stripes or wood, since it is a quiet background service |

### Where it lives, and how to change it

`design/` is the single source of truth, and `./design/sync-assets.sh`
copies it into every frontend. **Never edit the copies** (anything named
`tokens.css`, `components.css`, `retro.js`, `RetroControl.jsx`,
`AppIcon.jsx` under `apps/`): the next sync silently overwrites them.

| File | What it holds |
|---|---|
| `design/tokens.css` | Every color, radius, font, stripe color, the `--press` key depth, and the Off/Full overrides |
| `design/components.css` | Shared pieces: buttons, card surfaces, checkboxes, storage gauge, sign-in stripe band, segmented control, the active nav bar, and the Off behavior |
| `design/retro.js`, `design/RetroControl.jsx` | The retro intensity setting and its three-choice control |
| `design/icons/`, `AppIcon.jsx`, `Wordmark.jsx` | The icon set |
| `design/make-favicons.mjs`, `design/favicons/` | Browser-tab and home-screen icons, **generated from the icon set**. Run `node design/make-favicons.mjs && ./design/sync-assets.sh` only when an icon or the brand color changes; the generated files are committed |

Load order in each app's `main.jsx` is `tokens.css`, then `index.css`, then
`components.css`: because the shared file loads last, it wins ties, which
is what lets it restyle shared pieces without touching an app's layout
code. An app that needs to differ sets a variable instead of forking the
file (HomeVault does this with `--auth-band-height` and `--auth-band-bg`).

**When you build a new screen:** use `var(--...)` tokens and the shared
classes (`.btn`, `.panel`, `.segmented`...), never a typed-in color or a
pixel radius, and give any new decoration an Off behavior.

## Five governing principles

1. **Familiar before impressive** — understand what something does
   before noticing how it looks.
2. **Calm before energetic** — this is software people open daily; avoid
   bouncing animation, glowing borders, notification spam. Motion
   communicates state, not decoration.
3. **Dense when useful, spacious when important** — HomeCloud needs
   density (it's a file manager); Home can breathe more; HomeMedia can
   go immersive. Shared language, application-dependent density.
4. **Private rather than corporate** — avoid enterprise-dashboard,
   fintech, and "tech bro" visual language. Software for one person's
   digital life.
5. **Consistency through behavior, not identical layouts** — same
   spacing logic, typography, motion, and feedback patterns everywhere;
   different information architecture per app. *Different rooms in the
   same house, not identical rooms.*

## The house metaphor (internal guide, not literal decoration)

| App | Room | Feeling |
|---|---|---|
| Home | Entrance/hallway | Where you are, what's available, what happened |
| HomeCloud | Archive/storage room | Organized, practical, dependable |
| HomeMedia | Gallery | Visual, image-first, immersive |
| HomeNotes | Study | Quiet typography, minimal distraction |
| HomeTasks | Desk | Practical, scannable |
| HomeMonitor | Utility room | Precise, compact, technical |
| HomeVault | The safe | Restrained, security-conscious — nothing casual |
| HomeAI | Library/assistant | Conversational, never visually dominant |
| HomeSync | The connection to the outside world | Should almost disappear when working |

## Practical rules

- **Color:** a restrained warm foundation (brown-black, cream, muted
  warm-gray text; see *The palette* above) with accents used
  *semantically* — teal healthy, amber attention, rust red danger,
  purple optional-AI-only. No rainbow gradients (the stripe band is the
  one deliberate exception), no giving every app an unrelated palette.
- **Dark mode** is a natural environment (warm brown-black, not blackened
  light mode); **light mode** is ivory paper, not pure white.
  The two should feel like two lighting conditions in the same building.
- **Depth** through slight luminance differences, borders, spacing and
  hard-edged shadows — never soft blurs or glow, and not an interface
  built entirely out of floating cards.
- **Typography:** highly readable type (see *Type* above); HomeNotes may
  use a more editorial font for document content while keeping the shared
  UI font around it.
- **Icons:** simple, geometric, outlined with a confident weight (frame 3,
  glyph 2.4 on the 48-unit grid), one unified family — never mixing
  filled/thin-line/cartoon/emoji.
- **Motion:** quick, soft, purposeful, consistent. The interface should
  feel responsive before it feels animated. Hard "on/off" steps (the
  activity LED) suit the style better than smooth fades, and every
  animation must have a reduced-motion behavior.
- **Accessibility is part of the aesthetic**, not a checklist bolted on
  after: readable contrast, visible focus, large touch targets,
  reduced-motion support, and never color-only status indicators.
- **Sound** is almost nonexistent by default.
- **Errors are calm and actionable** — always answer: what happened, was
  anything lost, what can I do next. Never `ERROR 500!! SOMETHING WENT
  WRONG!!`.

## The five-second test

A new user opens Home and thinks, in order: *"This is my stuff." →
"Everything is here." → "I understand how it works." → "I trust it."*
That emotional progression matters more than any individual visual
trick.

## Icon system

**Built and integrated.** `design/` is the single source of truth — nine
app icons plus a wordmark (`design/icons/*.svg`, `design/AppIcon.jsx`,
`design/Wordmark.jsx`). Every mark shares one frame (a rounded square
with a doorway-notch cut into the bottom edge — the undecorated **Home**
mark on its own), and every application icon reuses that exact frame
with its own glyph inside — cloud outline (HomeCloud), lens ring + iris
hexagon (HomeMedia), page with folded corner (HomeNotes), checkbox +
list (HomeTasks), refresh arcs (HomeSync), pulse line (HomeMonitor),
padlock (HomeVault), four connected nodes for HomeAI (deliberately *not*
a sparkle/star, to avoid reading as "the AI app with purple gradients,"
per principle 4 above). All strokes use `currentColor` so one file works
in both themes. Strokes are deliberately heavy (frame 3, glyph 2.4 on a
48-unit grid): they match the chunky look and stay readable at sidebar
size, and going heavier (3.4 / 3) made HomeMedia's lens fill in.

**Never hand-edit a copy inside `apps/*/public/icons/` or
`apps/*/src/components/`** — run `./design/sync-assets.sh` after changing
anything under `design/`, which copies the canonical files out to every
frontend that uses them. The next run of that script silently overwrites
any local edit.

**Not yet done:** PNG/ICO favicon exports (only HomeCloud's frontend has
real PWA icon PNGs today) and an Android adaptive-icon split for
`apps/homesync-android` — see `ROADMAP.md`.

### Superseded decisions (kept for history)

Earlier versions of this doc recorded two choices as **final**: a warm
brass accent, `#C99A3B`, and a plain system-font stack. The Atari
direction (requested for 1.2.0) **supersedes both**: the accent is now the
orange in the palette above and the type is the trio above. For the record,
the code had already drifted from that note (it used `#e8a33d`, not
`#C99A3B`). If a future decision wants brass back, it is a change to
`design/tokens.css` and nothing else.

## Android

`apps/homesync-android/.../ui/theme/Color.kt` holds the same values as
`design/tokens.css`, and **has to be kept in step by hand**: there is no
automatic sync from CSS to Kotlin. Two things differ on purpose: it has one
`Teal` for both themes, and it uses Material's default type and corner
shapes rather than Fredoka and chunky radii. (Bundling Fredoka would need a
`.ttf` file, and the npm font package ships only web formats.)

The Android light theme used to put near-black text on its deep amber
buttons, only 3.2:1. It now uses cream (`AmberOnLabelLight`, 6.2:1), the
same choice as `--on-accent` on the web.

## Not done yet

- **The Android theme change has not been compiled or run.** It is color
  constants only, but there was no Android SDK where it was made, so it
  needs one build on a real machine.
- HomeVault's real, unlocked pages (the item list and Settings page) were
  checked only as isolated markup and styles, not with a real unlocked
  vault behind them.
- Adaptive-icon split for the Android launcher (the launcher icon is
  still the older sync-arrows mark, recolored).
