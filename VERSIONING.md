# Versioning

The current ecosystem release is **1.7.0**. The root `package.json` is the
version authority; keep the root lockfile's version fields in sync. Workspace
versions are package metadata and are not bumped together.

## Release rules

- Routine work goes under `[Unreleased]` in the changelog.
- Use PATCH for compatible fixes, MINOR for compatible features and MAJOR for
  incompatible API/data changes. A commit or completed phase is not a release.
- The newest versioned changelog heading, root version and annotated
  `vX.Y.Z` tag must agree.
- A tag identifies the exact validated main commit. Never move, reuse, delete
  or backdate a valid release tag.
- Preserve existing accounts/data and document any compatibility or migration
  requirements before release.

Follow [RELEASING.md](docs/RELEASING.md) for the gate and publication process.
Conventional Commit conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Historical baseline

The corrected historical baseline is 1.6.2. Earlier phase numbering is not a
template for future releases. The one-time reconciliation script preserves
historical commits/valid tags and is limited to the audited legacy refs.
Do not recreate the inflated sequence or invent retrospective releases;
details remain in Git history and the changelog.
