# HOME --- Artistic & Cosmetic Direction

## Purpose

This is the visual and emotional companion to the **HOME Master
Specification**. It is intentionally non-technical: it defines the
artistic direction, visual philosophy, interaction language, and thought
process that should guide Home, HomeCloud, HomeCore, and every future
Home application.

**HomeCloud remains the visual foundation.** New products should feel
like they belong to the same family rather than looking like unrelated
redesigns.

------------------------------------------------------------------------

# 1. The central idea

**Home should feel like your own private digital place.**

Not a corporate SaaS dashboard. Not a futuristic hacker terminal. Not
generic glassmorphism. Not a collection of templates.

The emotional target sits somewhere between:

-   a beautifully organized personal computer
-   a quiet private server room
-   a personal archive
-   a modern operating system
-   a familiar room that belongs to you

The name **Home** matters. It should feel calm, personal, dependable,
and quietly capable.

The design should communicate:

> Everything here belongs to you, is organized by you, and is under your
> control.

The suite should therefore be **quietly sophisticated rather than loudly
impressive**.

------------------------------------------------------------------------

# 2. Design philosophy

Five principles govern the suite.

### Familiar before impressive

A user should understand what something does before noticing how
beautiful it is.

### Calm before energetic

Home is software people may open every day. Avoid bouncing animations,
glowing borders, excessive shadows, notification spam, and giant
decorative effects.

Motion should communicate state, not decorate every interaction.

### Dense when useful, spacious when important

HomeCloud is a file manager and needs information density. Home can
breathe more. HomeMedia can become immersive. HomeNotes can become
typographically focused.

The design language is shared, but **density is application-dependent**.

### Private rather than corporate

Avoid the visual language of enterprise dashboards, fintech, startup
landing pages, generic AI products, and "tech bro" aesthetics.

The suite should feel like software made for **one person's digital
life**.

### Consistency through behavior

Applications do not need identical layouts. They need the same visual
vocabulary, interaction conventions, spacing logic, typography, motion
principles, and feedback patterns.

**Different rooms in the same house, not identical rooms.**

------------------------------------------------------------------------

# 3. HomeCloud as the visual foundation

HomeCloud is the first room.

Home is the house.

HomeCore is the invisible infrastructure behind the walls.

Do not redesign HomeCloud simply to create the ecosystem. Preserve its
recognizable personality, identify its strongest visual traits,
formalize them into a design system, and extend them gradually.

The suite should look as if one mind designed everything from the
beginning.

------------------------------------------------------------------------

# 4. The house metaphor

Use the metaphor as an internal design guide, not as literal decoration.

### Home

The entrance / hallway.

It tells you: - where you are - what is available - what happened
recently - whether everything is healthy

### HomeCloud

The archive / storage room.

Organized, practical, dependable.

### HomeMedia

The gallery.

Visual, image-first, immersive, less chrome.

### HomeNotes

The study.

Quiet typography, concentration, minimal distraction.

### HomeTasks

The desk.

Practical, structured, actionable.

### HomeMonitor

The utility room / control panel.

Information-dense, precise, status-oriented.

### HomeVault

The safe.

Visually restrained and security-conscious.

### HomeAI

The library / assistant.

Conversational and intelligent, but never visually dominant over the
content.

### HomeSync

The connection between the outside world and the house.

When it works correctly, it should almost disappear.

------------------------------------------------------------------------

# 5. Brand personality

Home should feel:

-   calm
-   intelligent
-   personal
-   capable
-   understated
-   trustworthy
-   modern
-   slightly warm
-   technical without being "tech bro"
-   premium without being luxurious

It should not feel:

-   childish
-   sterile
-   cyberpunk
-   aggressively futuristic
-   corporate
-   generic productivity SaaS
-   aggressively minimalist
-   noisy
-   overly "AI"

A good test:

> If the interface looks impressive in a screenshot but annoying after
> six hours of use, it failed.

------------------------------------------------------------------------

# 6. Color philosophy

Use a restrained neutral foundation:

-   near-black / deep charcoal
-   dark gray
-   soft white
-   muted gray text
-   subtle borders

Accent colors should primarily communicate meaning.

Suggested semantic roles:

-   **Primary accent:** identity / interaction
-   **Green:** healthy / successful
-   **Amber:** attention
-   **Red:** danger / destructive
-   **Blue:** informational
-   **Purple:** optional AI / special capability

These are semantic accents, not giant decorative color fields.

Avoid rainbow gradients, neon everywhere, excessive colored cards, and
giving every application a completely unrelated palette.

------------------------------------------------------------------------

# 7. Light and dark themes

Dark mode should feel like a natural environment, not a blackened
version of light mode.

Dark: - deep charcoal backgrounds - slightly elevated surfaces - soft
borders - controlled contrast - comfortable text

Avoid pure black wherever possible.

Light: - warm or neutral off-white backgrounds - slightly darker
surfaces - subtle borders - comfortable text

Avoid pure white everywhere.

The two themes should feel like two lighting conditions in the same
building.

------------------------------------------------------------------------

# 8. Surfaces and depth

Use a restrained hierarchy:

``` text
background
    ↓
surface
    ↓
raised surface
    ↓
dialog / overlay
```

Communicate depth through slight luminance differences, borders,
spacing, and occasional subtle shadows.

Do not build the entire interface out of floating cards. A page should
still feel like a page.

------------------------------------------------------------------------

# 9. Borders

Borders answer:

> Where does this thing end?

They should not answer:

> Look at this glowing box.

Use them especially for inputs, panels, file rows, tables, dialogs, and
selected states.

Avoid decorative borders around everything.

------------------------------------------------------------------------

# 10. Typography

Typography should be highly readable.

Prefer: - clean sans-serif UI typography - strong hierarchy - restrained
weights - comfortable line height - readable metadata

Do not use futuristic display fonts for normal UI.

Headings can have personality through weight, scale, spacing, and
capitalization.

HomeNotes may use a more editorial reading font for document content
while retaining the shared UI font around it.

------------------------------------------------------------------------

# 11. Iconography

Icons should be: - simple - geometric - consistent - recognizable -
preferably outlined or lightly weighted

Do not randomly mix filled icons, thin line icons, cartoon icons, and
emoji.

Each application can have a recognizable icon, but the icon family
should feel unified.

------------------------------------------------------------------------

# 12. Application icons

Each Home application gets a distinct symbol while sharing one visual
grammar.

Concepts:

``` text
Home        house / central mark
HomeCloud   cloud / archive
HomeMedia   image / aperture
HomeNotes   page / notebook
HomeTasks   check / list
HomeSync    arrows / connection
HomeMonitor pulse / system
HomeVault   lock / safe
HomeAI      abstract intelligence / star / node
```

Avoid clip-art literalism.

Icons must work at small sizes, as dashboard cards, favicons, and
Android launcher icons.

------------------------------------------------------------------------

# 13. The Home logo

The Home mark should be extremely simple.

It should communicate shelter, centrality, belonging, and connection
without necessarily drawing an actual house.

A strong direction is a minimal geometric symbol that can exist
independently of the word "Home."

It should work as:

``` text
HOME
[mark]

[mark] Home

[mark]
```

Do not over-design the logo. Familiarity comes through repetition.

------------------------------------------------------------------------

# 14. Layout philosophy

The suite should feel structured but not rigid.

Use a consistent spacing scale, for example:

``` text
4
8
12
16
24
32
48
64
```

The exact implementation may vary, but spacing must feel deliberate.

Whitespace communicates importance. Dense layouts communicate utility.

------------------------------------------------------------------------

# 15. Home dashboard

Home should not be a giant grid of identical application cards.

The dashboard needs hierarchy:

``` text
HOME

Good evening.

[ Important / recent information ]

┌───────────────────────────┐
│ HomeCloud                 │
│ 72 GB used                │
│ ███████░░                 │
└───────────────────────────┘

Your apps

[Cloud] [Media] [Notes]
[Tasks] [Sync]  [Monitor]

Recent activity

• Backup completed
• File uploaded
• HomeMedia indexed 42 photos

System

● All systems operational
```

The dashboard should feel alive without becoming a monitoring dashboard.

------------------------------------------------------------------------

# 16. HomeCloud visual direction

HomeCloud is the baseline.

Its aesthetic is:

**organization + ownership + reliability**

Prioritize: - file names - folders - thumbnails - search - sorting -
navigation - upload state - storage state

Do not bury file management underneath decoration.

### File rows

``` text
[icon]  project.zip
        2.4 GB • Yesterday

                    ⋮
```

Metadata is secondary.

### Folders

Folders should feel tactile but not skeuomorphic. Avoid literal
physical-folder graphics.

### Uploads

Uploads should be visible and reassuring:

``` text
Uploading...

project.zip
██████████████░░ 82%

1.8 GB / 2.2 GB
```

The user should feel their data is being handled reliably.

------------------------------------------------------------------------

# 17. HomeMedia

HomeMedia is the visual escape from HomeCloud's density.

Let photographs dominate.

Use: - large thumbnails - masonry/grid where appropriate - timeline
grouping - subtle hover/selection states - immersive lightbox -
restrained metadata

Avoid thick borders around every photograph.

**The image itself is the surface.**

The feeling should be:

> My files have become memories.

------------------------------------------------------------------------

# 18. HomeNotes

HomeNotes should feel quiet.

A blank document should be comfortable to stare at.

Use typography and whitespace as the primary aesthetic. Formatting
controls should appear when useful rather than constantly occupying the
screen.

------------------------------------------------------------------------

# 19. HomeTasks

HomeTasks should feel practical and scannable.

Emphasize: - what needs doing - what is overdue - what is next - what is
completed

Use restrained semantic colors.

Completed tasks should visually recede rather than disappear
immediately.

------------------------------------------------------------------------

# 20. HomeMonitor

HomeMonitor can be denser.

It should feel like looking behind the house's walls:

-   precise
-   compact
-   technical
-   calm
-   data-oriented

Graphs should be simple. Do not turn every metric into a giant glowing
chart.

------------------------------------------------------------------------

# 21. HomeVault

HomeVault should be visually conservative.

The message is:

> Nothing here is casual.

Use darker surfaces, clear security status, strong destructive-action
confirmation, minimal animation, and clear security indicators.

Avoid making security look like a video game.

------------------------------------------------------------------------

# 22. HomeAI

HomeAI must not become "the AI app with purple gradients."

AI is a capability inside Home, not the brand.

Prioritize: - conversation - context - sources - files -
citations/references - actions

When HomeAI uses HomeCloud data, make that relationship visible:

``` text
Based on 3 files in HomeCloud

[project-spec.pdf]
[notes.md]
[architecture.txt]
```

The user should always understand where information came from.

------------------------------------------------------------------------

# 23. HomeSync

HomeSync should be almost invisible when working.

The emotional goal is:

> I don't have to think about backups anymore.

Primary state:

``` text
HomeSync

✓ Everything is backed up

Last backup
Today • 02:14

1,248 files
3.7 GB

Next automatic backup
When new photos are detected
```

Problems should be clear without being frightening.

------------------------------------------------------------------------

# 24. Motion design

Motion should be: - quick - soft - purposeful - consistent

Use animation for navigation, state changes, upload progress, modal
entry, and successful actions.

Avoid perpetual floating, bouncing UI, excessive parallax, long
transitions, and animation that delays interaction.

> **The interface should feel responsive before it feels animated.**

------------------------------------------------------------------------

# 25. Microinteractions

Small interactions provide confidence.

Examples:

``` text
Uploading...
→ ✓ Uploaded

Saving...
→ Saved

Syncing 13 files
→ ✓ Everything backed up
```

These tiny state changes are central to the emotional identity of Home.

The system should continually reassure the user that their private
infrastructure is doing what they asked.

------------------------------------------------------------------------

# 26. Empty states

Empty states should be useful, not decorative.

HomeCloud:

``` text
This folder is empty.

Drop files here or upload something
to get started.
```

HomeMedia:

``` text
Your gallery is empty.

Photos backed up from HomeSync
will appear here.
```

HomeNotes:

``` text
No notes yet.

Create your first note.
```

Avoid giant illustrations unless they genuinely help.

------------------------------------------------------------------------

# 27. Error states

Errors should be calm and actionable.

Bad:

``` text
ERROR 500!!!
SOMETHING WENT WRONG!!!
```

Good:

``` text
Couldn't connect to HomeCloud.

The server didn't respond.

[Retry]
[Server settings]
```

Always answer:

1.  What happened?
2.  Was anything lost?
3.  What can the user do next?

------------------------------------------------------------------------

# 28. Offline behavior

Home should not visually collapse when the server disappears.

Example:

``` text
Home

Offline

HomeCore isn't reachable.

Your locally available information remains here.

[Retry]
```

Applications should show their own unavailable state rather than a
generic blank screen.

------------------------------------------------------------------------

# 29. Responsive design

The suite should feel intentionally designed on: - small Android
phones - large Android phones - tablets - laptops - large desktops

Do not simply shrink desktop layouts.

Mobile should prioritize touch targets, thumb reach, bottom navigation
where useful, simple menus, sheets instead of oversized dialogs,
full-screen media viewing, and readable typography.

------------------------------------------------------------------------

# 30. Android visual language

Android applications should look like Home, not like web pages trapped
inside WebView.

Respect: - status/navigation bars - edge-to-edge layouts where
appropriate - keyboard behavior - Android back gesture - Android file
picker - share sheet - permissions - background work - notifications

Native controls can differ where platform conventions require it, while
the visual language remains recognizably Home.

------------------------------------------------------------------------

# 31. Web and mobile relationship

The user should feel:

``` text
Home on desktop
       ↕
Home in browser
       ↕
Home on Android
```

not:

``` text
website
+
random Android wrapper
```

The same information architecture and visual vocabulary should carry
across platforms.

------------------------------------------------------------------------

# 32. Accessibility

Accessibility is part of the aesthetic.

Prioritize: - readable contrast - visible focus - large touch targets -
reduced-motion support - keyboard navigation - screen-reader labels -
meaningful icons - non-color-only status indicators

Never communicate important status using color alone.

------------------------------------------------------------------------

# 33. Sound

Sound should be almost nonexistent by default.

Optional subtle feedback can exist for successful backup, important
security events, and destructive confirmations, but the default Home
environment should be silent.

------------------------------------------------------------------------

# 34. Illustration and imagery

Avoid stock illustrations and generic AI-generated people.

Prefer: - actual user content - abstract geometric forms - subtle
environmental textures - application-specific imagery - simple
iconography

HomeMedia naturally gets to be image-heavy. HomeCloud does not.

------------------------------------------------------------------------

# 35. The Home feeling

The key test is not:

> Does this look futuristic?

It is:

> Would I want this to be the place where my digital life lives?

That answer should come from consistency, calmness, reliability,
familiarity, and ownership---not spectacle.

------------------------------------------------------------------------

# 36. Design evolution

Start with HomeCloud.

Formalize what already works.

Then introduce Home.

Then introduce applications.

Do not make HomeCloud look alien just to match a new system.

Instead:

``` text
HomeCloud
   ↓
extract its visual DNA
   ↓
Home design system
   ↓
new applications
```

The suite should look as if one designer designed everything from the
beginning, even if the products were built years apart.

------------------------------------------------------------------------

# 37. The five-second test

A new user should open Home and think:

> This is my stuff.

Then:

> Everything is here.

Then:

> I understand how it works.

And finally:

> I trust it.

That emotional progression is more important than any individual visual
trick.

------------------------------------------------------------------------

# 38. Final artistic directive

When designing any future Home application, imagine another room in the
same private house.

Ask: - What is this room for? - What should be visible immediately? -
What should stay out of the way? - What emotional state should it
create? - Which HomeCloud conventions should remain? - What can this
application do that the others cannot? - How can it feel distinct
without feeling unrelated?

Do not make every application look identical.

Do not make every application reinvent the visual language.

The target is:

> **shared identity, individual personality.**

Home should be the quiet center.

HomeCloud should be the foundation.

HomeCore should be invisible.

The applications should feel like capabilities of one coherent personal
environment.

The user should never have to think about the architecture underneath
it.

They should simply feel:

# I'm home.
