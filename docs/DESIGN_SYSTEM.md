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

- **Color:** a restrained neutral foundation (near-black/charcoal, soft
  white, muted gray text) with accents used *semantically* — green
  healthy, amber attention, red danger, blue informational, purple
  optional-AI-only. No rainbow gradients, no giving every app an
  unrelated palette.
- **Dark mode** is a natural environment (deep charcoal, not blackened
  light mode); **light mode** is warm/neutral off-white, not pure white.
  The two should feel like two lighting conditions in the same building.
- **Depth** through slight luminance differences, borders, and spacing —
  not an interface built entirely out of floating cards.
- **Typography:** clean, highly readable sans-serif UI type; HomeNotes
  may use a more editorial font for document content while keeping the
  shared UI font around it.
- **Icons:** simple, geometric, outlined/lightly weighted, one unified
  family — never mixing filled/thin-line/cartoon/emoji.
- **Motion:** quick, soft, purposeful, consistent. The interface should
  feel responsive before it feels animated.
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
in both themes.

**Never hand-edit a copy inside `apps/*/public/icons/` or
`apps/*/src/components/`** — run `./design/sync-assets.sh` after changing
anything under `design/`, which copies the canonical files out to every
frontend that uses them. The next run of that script silently overwrites
any local edit.

**Not yet done:** PNG/ICO favicon exports (only HomeCloud's frontend has
real PWA icon PNGs today) and an Android adaptive-icon split for
`apps/homesync-android` — see `ROADMAP.md`.

The accent color is a warm brass, `#C99A3B` (chosen specifically to
avoid the terracotta/coral a lot of AI-assisted design defaults to) —
**decided as final.** The typeface is the current placeholder
sans-serif system-font stack — also **decided as final** rather than
a placeholder waiting on a custom pick; revisit only if a real reason
comes up, not by default.
