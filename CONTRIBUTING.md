# Contributing

## Before you start

If a change would contradict [HOME_MASTER_SPECIFICATION.md](HOME_MASTER_SPECIFICATION.md)
or [HOME_ARTISTIC_DIRECTION.md](HOME_ARTISTIC_DIRECTION.md), that's a
deliberate decision to make and record (in the PR description and, if
it's a lasting change of direction, in the doc itself) — not something
to drift into silently. Everything under `docs/` is a condensed,
current-state view derived from those two; when they disagree, the
docs are what's stale, not the other way around.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) next, specifically the
three-tier layering rule. It's the one thing every other rule below
exists to protect: **a Tier 1 app (HomeCloud, HomeMedia, HomeSync,
HomeNotes, and any future one) owns its own database and process, never
reaches into another app's database, and never branches on whether
another app is installed.** Optional cross-app behavior belongs in
HomeBridge (not yet built — see [docs/ROADMAP.md](docs/ROADMAP.md)), not
bolted onto an existing app.

## Setting up

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for installing
dependencies, running services locally, and running the test suite.

## Making a change

1. **Every new service gets its own isolated test suite**, run against a
   real upstream dependency (a real HomeCore instance, say) rather than a
   mock — see any existing `test/helpers/app.js` for the pattern.
2. **Run the full test suite before opening a PR**: `npm test` from the
   repo root runs every workspace. All of it should pass; if a change
   touches a frontend, also run `npm run build` in that app to catch
   build-time errors tests won't. GitHub Actions (`.github/workflows/`)
   runs the same checks on every PR, plus a Docker boot of the whole
   stack, so a PR isn't ready to merge until those are green.
3. **No speculative dependencies.** Add a package only when a spec'd
   feature actually needs it, not because it might be useful later — see
   the [1.0.0] changelog entry for an example of three that had quietly
   stopped being used at all.
4. **Comment the "why," not the "what."** Code should be readable enough
   that a comment restating what a line does adds nothing; a comment
   explaining why a non-obvious choice was made (a tradeoff, a gotcha, a
   constraint from another service) is worth writing down.
5. **Update the docs in the same change**, not after. If your change
   makes something in `docs/` inaccurate, fix it in the same commit —
   that's how the docs stay trustworthy.

## Commit messages and branches

Prefix commits with what kind of change it is: `feat:`, `fix:`, `docs:`,
`chore:`, `refactor:`, `test:`. Branch names follow the same idea:
`feat/short-description`, `fix/short-description`.

## Security issues

Don't open a public issue for a security vulnerability. See
[docs/SECURITY.md](docs/SECURITY.md) for what's already a known,
documented gap (TLS, permission enforcement) versus something new worth
reporting privately to whoever maintains this repository.
