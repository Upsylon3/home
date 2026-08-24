# Versioning & branching

Why this file exists: before this pass, there was **no git repository at
all** — every session's work existed only as a zip export, so different
sessions' work (this tiered-refactor pass, the icon system, HomeSync
Android's `data/` package) diverged into unmerged forks with no way to
tell what was ahead, behind, or missing relative to anything else. That's
the actual problem to solve — not "which version number scheme is more
correct," but "make it structurally impossible to lose work again."

## The one rule that matters most

**`main` is the only branch that's ever a source of truth.** Every session
— yours, mine, or another AI agent's — starts a new branch off the latest
`main`, does its work, and merges back into `main` before that work is
considered "real." A zip export, a chat transcript, or an uncommitted
working directory is not a source of truth; if it's not merged into
`main`, it doesn't fully exist yet as far as the next session is
concerned.

## Ecosystem version, not per-app versions (for now)

There is **one version number for the whole repo**, in the root
`package.json`. Not one per app. Reasoning: HomeCloud, HomeMedia, HomeSync,
and HomeNotes today all share a database process (via `homecore/`, see
`MIGRATION_PLAN.md`), a gateway, and a docker-compose file — they don't
ship or run independently yet, so independent version numbers would imply
a level of decoupling that doesn't exist and would just be more numbers to
keep in sync by hand. `apps/*/package.json` still each have their own
`version` field (useful internally — e.g. `seed.js` reads HomeCloud's own
`package.json` version into its app-registry entry), but the *repo-level*
version — the one you tag releases with — lives at the root.

Revisit this once a service is genuinely independently deployable (its own
database, no shared process with anything else). HomeMedia, HomeSync's
backend, and HomeNotes already qualify architecturally today, for what
it's worth — this is a deliberate "not yet," not a technical blocker.

## Semantic versioning, pre-1.0 rules

Standard [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`), with the
pre-1.0 convention applied honestly rather than stalling at `0.1.0`
forever:

- **PATCH** (`0.1.0` → `0.1.1`) — bug fixes, doc corrections, no new
  capability. The seed.js URL-fallback fix and the `.gitignore`/compose
  project-name fix in this pass are exactly patch-sized.
- **MINOR** (`0.1.0` → `0.2.0`) — a new capability lands and is verified
  working (per `docs/TESTING.md`'s "verified by actually running it," not
  "should work"). Finishing HomeSync's Android `data/` package, actually
  integrating the icon set, or completing the real HomeCore/HomeCloud
  split are each minor-version-sized.
- **MAJOR** stays at `0` until the platform-level contracts are stable
  enough that breaking them would actually break something depending on
  them — realistically, not before HomeCore is a real separate service
  with a versioned API other apps rely on. `1.0.0` is a deliberate future
  milestone, not a deadline.

Tag every merge to `main` that represents a real, verified checkpoint:

```bash
git tag -a v0.1.0 -m "Short description of what actually changed and was verified"
git push origin v0.1.0   # once a remote exists — see "Getting a remote" below
```

## Branch naming

```
feat/<area>-<short-description>     # new capability — feat/homecore-split, feat/homesync-data-layer
fix/<area>-<short-description>      # bug fix — fix/seed-url-fallback
docs/<short-description>            # docs-only changes
chore/<short-description>           # tooling, deps, CI, versioning itself
```

`<area>` is one of: `homecore`, `homecloud`, `homemedia`, `homesync`,
`homenotes`, `home`, `gateway`, `design`, or `repo` (cross-cutting). This
matters more than it looks like it should: it's what lets you glance at
`git branch -a` after a long gap and immediately know which module a
branch touches without opening it.

## The actual discipline (this is the part that prevents the fork pileup)

1. **Before starting any new work session, `git pull` (or ask for the
   latest `main`) — never assume the zip/checkout you have is current.**
   This single habit is what the old workflow was missing.
2. One branch, one concern. Don't let "fix the seed.js bug" and "start
   the HomeCore split" happen on the same branch — they finish (and get
   reviewed) on completely different timelines.
3. Merge early, merge often. A branch that's more than ~1–2 sessions old
   without merging is exactly how the icon-system and HomeSync-data-layer
   work went missing — it sat somewhere unmerged and the next session
   never saw it. If a branch is going to live longer than that, say so
   explicitly and note it in `CHANGELOG.md`'s Unreleased section so it
   isn't silently forgotten.
4. Delete branches after merging. A long `git branch -a` list is a sign
   the discipline above already slipped.
5. **Every session ends by committing, even if the work is incomplete.**
   An incomplete commit on a named branch can be found and resumed. Work
   that only exists in a chat transcript or an unzipped folder cannot.

## Getting a remote (recommended next step, outside this session)

This pass sets up a real local git repository with real history, but it
has no remote yet — it only exists wherever you unzip it. The very next
thing worth doing, by hand, once you have this: create an empty repo on
GitHub/GitLab/a self-hosted Gitea instance and run

```bash
git remote add origin <your-repo-url>
git push -u origin main --tags
```

Once that exists, every future session should clone/pull from there
instead of working from a fresh zip export — that's what actually closes
the loop on "10000 forks."

## The icon set and HomeSync Android's data layer: lost, not unmerged

An earlier version of this section assumed two pieces of work built in
past sessions — the icon SVG set and HomeSync Android's `data/` package
— could be pasted back in later as their own branches. That code is
confirmed gone; it only ever existed inside chat sessions that weren't
saved anywhere durable. **This is exactly the failure mode this file
exists to prevent going forward** — from `v0.1.0` on, if it isn't
committed to `main`, treat it as not existing yet, full stop, no matter
how recently it was written.

What does survive is the *specification* of both, now living in this
repo under `docs/` (folded in at `v0.1.1` — see `CHANGELOG.md`):

- `docs/DESIGN_SYSTEM.md`'s "Icon system" section — the shared frame, the
  per-app glyph for each of the nine apps, the `currentColor` requirement.
- `docs/SERVICES.md`'s HomeSync section — the exact list of missing
  Kotlin classes (`SessionManager`, `SettingsStore`, `ApiClient`/
  `HomeSyncApi`, `AppDatabase`, `SyncedMediaDao`, `SyncedMediaEntity`) and
  what each needs to do.
- Both are tracked as ordinary backlog items in `docs/ROADMAP.md` (#1 and
  #3) — rebuild from spec on their own branches
  (`feat/design-icon-system`, `feat/homesync-data-layer`) whenever it's
  time to tackle them. Neither blocks `MIGRATION_PLAN.md`; all three can
  proceed in any order.
