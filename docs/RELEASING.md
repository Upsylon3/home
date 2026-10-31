# Releasing HOME

This is the operational checklist for producing a HOME ecosystem
release. The version authority and increment rules are in
[VERSIONING.md](../VERSIONING.md).

## 1. Prepare the release

1. Merge release-bound pull requests into `main`. Do not release from
   an unreviewed feature branch.
2. Wait for the `CI` workflow to pass on the exact commit you intend
   to tag. If `apps/homesync-android/` changed, also wait for the
   corresponding `Android` workflow to pass.
3. Update the version in the **root** `package.json` only.
4. Move the completed entries from `[Unreleased]` in `CHANGELOG.md`
   into a new version heading matching the root version:
   `## [X.Y.Z] — Short release summary`.
5. Commit the release preparation with a Conventional Commit subject,
   for example `chore(release): prepare v1.15.0`.
6. Run the checks locally, or confirm the equivalent CI checks on the
   resulting `main` commit:

   ```bash
   npm ci
   npm test
   npm run build --workspaces --if-present
   bash gateway/test/gateway-smoke.sh
   ```

The release workflow repeats the install, test, frontend-build and
gateway-smoke checks against the tagged source. The normal `CI`
workflow remains responsible for the full Docker build/stack smoke test.

## 2. Create the annotated tag

Start from a clean checkout of the exact validated `main` commit:

```bash
git switch main
git pull --ff-only origin main
git status --short
git tag -a v1.15.0 -m "Release v1.15.0"
git push origin v1.15.0
```

Replace `1.15.0` with the version being released. Do not continue if
`git status --short` shows uncommitted changes. Do not force-push,
delete or move a published release tag.

The tag workflow rejects lightweight tags, tags not reachable from
`main`, version mismatches and missing changelog sections.

## 3. GitHub Release

Pushing an annotated `vX.Y.Z` tag starts the `Release` workflow. It
validates the tag against the root package version and the newest
versioned changelog entry, reruns the release checks, and creates a
GitHub Release using that changelog section as its release notes.

If the workflow failed before creating the release, use Actions →
Release → Run workflow on `main`, and provide the existing annotated
tag (for example `v1.15.0`). This reruns validation and checks without
moving the tag. If a release already exists, review it rather than
creating a duplicate.

## 4. After release

- Confirm the tag and GitHub Release appear on the repository's Releases
  page.
- Confirm the release points to the intended commit.
- Do not create a second tag for the same version.
- Start subsequent unreleased work under `[Unreleased]` in
  `CHANGELOG.md`.

## Historical releases

The existing history and tags are preserved as they were created.
Do not invent backdated tags or GitHub Releases when the exact release
commit cannot be established from the source history. Any historical
backfill must be mapped to its original release commit and checked
against the root version and changelog before publication.
