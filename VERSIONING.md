# HOME versioning policy

HOME uses **one Semantic Versioning number for the whole ecosystem**.
The root `package.json` version is the sole release authority. The
normalized current release baseline is **`1.6.2`**.

## The authoritative version

- Change only the root `package.json` version for an ecosystem release.
- Keep the root `package-lock.json` root version in sync. Do not bulk-change
  workspace versions under `homecore/`, `apps/` or `packages/`; those are
  independent npm/Docker tooling metadata, not ecosystem releases.
- The newest versioned `CHANGELOG.md` heading must match the root version.
- A stable release is an annotated Git tag named `vX.Y.Z` on its exact
  validated release commit, plus a GitHub Release whose notes come from the
  matching changelog section.

A release is invalid when the root version, newest changelog heading and
Git tag disagree.

## Semantic Versioning

Use `MAJOR.MINOR.PATCH`:

| Change | Version increment | Meaning |
|---|---|---|
| MAJOR | `X+1.0.0` | An incompatible user-facing, data-format, deployment or public API change. |
| MINOR | `X.(Y+1).0` | A backwards-compatible capability or meaningful product expansion. |
| PATCH | `X.Y.(Z+1)` | A backwards-compatible bug fix, security fix or corrective maintenance release. |

A `feat` normally calls for MINOR, a `fix` normally calls for PATCH,
and a documented breaking change calls for MAJOR. Documentation, tests,
refactors, CI changes, dependency refreshes and implementation phases
do not each earn a version bump by themselves. Group work according to
the user-visible milestone it actually completes.

## Corrected release history

The repository's 1.x changelog had treated implementation phases of one
design rework as separate MINOR releases. The following mapping corrects
that without rewriting commits or changing their attribution:

| Corrected version | Actual product milestone | Historical source commit |
|---|---|---|
| `1.2.0` | One Atari-inspired redesign across HOME (the former 1.2.0–1.8.0 phases) | `1032addd` |
| `1.3.0` | HomeMedia uploads, music, GIFs, streaming, shared login and optional HTTPS | `659bf2b` |
| `1.4.0` | Complete HomeTasks tasks/projects backend and web application | `bd0e2dca` |
| `1.5.0` | Repeating tasks | `453ca57` |
| `1.6.0` | HomeMonitor: server, service and backup monitoring | `6e7c192` |
| `1.6.1` | Gateway resilience when an app is offline | `ad4b29d` |
| `1.6.2` | Shared-origin Content-Security-Policy | `b0f9591` |

These hashes are **historical source anchors**, not retroactively
published release tags. The old phase commits embed the inflated version
labels in their own root package/changelog snapshots. Backfilling tags
such as `v1.2.0` directly onto those snapshots would create tags whose
embedded version metadata disagrees with the tag. Rewriting those public
commits would change the SHAs of all their descendants and invalidate
existing references. Neither is justified. The normalized current
snapshot is released as `v1.6.2`; future releases use the corrected line.

The pre-1.0 development/migration tags remain as historical alpha
milestones; the 0.x series is not retroactively re-numbered.

## Changelog

Keep `CHANGELOG.md` in reverse chronological order:

- Put pending, user-relevant changes under `[Unreleased]`.
- Use `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and
  `Security` headings as applicable.
- For a release, move the completed entries into
  `## [X.Y.Z] — Short release summary`.
- Record observable changes and real verification limitations. Do not
  claim checks or deployment scenarios that were not actually run.
- Do not create a new release merely because a phase or commit is finished.

## Git history and tags

Use Conventional Commits for new work; see
[`CONTRIBUTING.md`](CONTRIBUTING.md). Prefer one squash commit per
reviewed pull request, using its validated PR title as the main-branch
commit subject.

Future release tags are annotated and immutable. Never force-move or
reuse a valid published tag; correct a release with a subsequent version.

### One-time legacy tag reconciliation

The full history audit found 19 existing tags and no GitHub Releases:

- `v0.8.1` points to `ac6ab27`, a standalone release commit that is
  **not reachable from current `main`** and diverged immediately after
  `v0.8.0`. Its snapshot replaced most of the changelog. The
  reconciliation workflow removes this invalid orphan tag.
- `v1.1.5` points to the correct historical commit
  (`3bcbaaa`) but is lightweight. It is converted to an annotated tag
  on the **same commit**; the code history is not moved.
- The other existing valid tags are retained unchanged.
- No fake tags or backdated GitHub Releases are created for the
  corrected 1.2.0–1.6.1 milestones. The one-time workflow creates the
  normalized `v1.6.2` annotated tag on the exact current `main`
  snapshot after the full CI workflow succeeds, then publishes its
  GitHub Release from `CHANGELOG.md`.

The one-time workflow is idempotent: it checks exact known ref targets,
refuses unexpected changes and never moves an already-valid release tag.
