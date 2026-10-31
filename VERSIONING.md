# HOME versioning policy

HOME uses **one Semantic Versioning number for the whole ecosystem**.
The version in the repository-root `package.json` is the sole release
authority. The current repository baseline is `1.14.0`.

## The authoritative version

- Update only the root `package.json` version for an ecosystem release.
- Individual `package.json` files under `homecore/`, `apps/` and
  `packages/` may have their own versions for npm or Docker tooling.
  They are not independent HOME releases and must not be bulk-synchronised.
- The newest versioned entry in `CHANGELOG.md` must match the root
  `package.json` version.
- The corresponding Git tag is `vX.Y.Z`, points to the release commit
  and is an **annotated tag**.
- A GitHub Release is created for each new stable tag from that version's
  changelog section.

These values must agree. A release is invalid when the package version,
changelog entry and tag disagree.

## Semantic Versioning

Use `MAJOR.MINOR.PATCH`:

| Change | Version increment | Meaning |
|---|---|---|
| MAJOR | `X+1.0.0` | An incompatible user-facing, data-format, deployment or public API change. |
| MINOR | `X.(Y+1).0` | A backwards-compatible capability or meaningful product expansion. |
| PATCH | `X.Y.(Z+1)` | A backwards-compatible bug fix, security fix or corrective maintenance release. |

The table describes the decision, not a mechanical mapping from every
commit. A `feat` normally calls for MINOR, a `fix` normally calls for
PATCH, and a documented breaking change calls for MAJOR. Documentation,
tests, refactors, CI changes and routine maintenance do **not** by
themselves require a release or version bump. Bundle them into the next
meaningful release unless there is a concrete reason to ship sooner.

When uncertain, prefer the smallest increment that accurately describes
the impact. Do not bump a component's package version to simulate an
ecosystem release.

## Changelog

Keep `CHANGELOG.md` in reverse chronological order:

- Put pending, user-relevant changes under `[Unreleased]`.
- Use the established headings: `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed` and `Security`, as applicable.
- For a release, move the relevant entries into a new heading:
  `## [X.Y.Z] — Short release summary`.
- Describe observable changes and important limitations; do not claim
  checks or deployment scenarios that were not actually run.
- Do not silently rewrite old entries to make them fit a newer release.

## Git history and tags

Use Conventional Commits for new work; see
[`CONTRIBUTING.md`](CONTRIBUTING.md). Prefer one squash commit per
reviewed pull request, using the validated PR title as its commit title.

Tags are immutable release records. Create them as annotated tags on the
exact release commit. Never force-move or reuse a published tag; correct
a release with a subsequent version instead.

The existing history predates these checks. Preserve its commit IDs,
author attribution and existing tag targets. Do not rewrite public
history merely to make old subjects look uniform: doing so invalidates
clones and tag relationships. Apply this policy to all new work.


## Historical baseline (31 October 2026)

The repository audit found 19 Git tags, ending at `v1.1.5`, while the
root package and changelog are at `1.14.0`. No GitHub Releases exist.
The existing `v1.1.5` ref is lightweight rather than annotated. These
are historical gaps, not a reason to fabricate or move refs: preserve
them as-is and apply the annotated-tag / GitHub Release process to new
releases. A historical backfill requires a verified original release
commit for each version.
