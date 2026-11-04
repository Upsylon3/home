# Releasing HOME

This is the operational checklist for producing a HOME ecosystem
release. The version authority and increment rules are in
[VERSIONING.md](../VERSIONING.md).

## 1. Prepare the release

1. Merge release-bound pull requests into `main`. Do not release from
   an unreviewed feature branch.
2. Wait for all required PR checks on the exact release-preparation source to
   pass and merge it. The tag workflow independently calls the complete reusable
   CI gate against that tag before building or publishing downloads. If
   `apps/homesync-android/` changed, also require its APK/JVM checks.
3. Update the version in the **root** `package.json` and matching root
   `package-lock.json` metadata; do not bump individual workspaces.
4. Move the completed entries from `[Unreleased]` in `CHANGELOG.md`
   into a new version heading matching the root version:
   `## [X.Y.Z] — Short release summary`.
5. Commit the release preparation with a Conventional Commit subject,
   for example `chore(release): prepare v1.7.0`.
6. Run the checks locally, or confirm the equivalent CI checks on the
   resulting `main` commit:

   ```bash
   npm ci
   npm test
   npm run build --workspaces --if-present
   bash gateway/test/gateway-smoke.sh
   ```

The release workflow first validates tag annotation, main ancestry and version
metadata, then calls the complete reusable `CI` workflow with the explicit tag
ref. That input forces the full test/build, Windows, gateway, backup, audit and
Docker/package gate even for manual dispatch from a different branch. It does
not depend on a separately dispatched main run or repeat a weaker subset.
A failure prevents draft creation, package publication and final release.

## 2. Create the annotated tag

Start from a clean checkout of the exact validated `main` commit:

```bash
git switch main
git pull --ff-only origin main
git status --short
git tag -a v1.7.0 -m "Release v1.7.0"
git push origin v1.7.0
```

Replace `1.7.0` with the version being released. Do not continue if
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
tag (for example `v1.7.0`). This reruns validation and checks without
moving the tag. If a release already exists, review it rather than
creating a duplicate.

## 4. Legacy tag reconciliation

The first normalized baseline (`v1.6.2`) is handled by the
`Historical tag reconciliation` workflow after the full `CI` workflow
succeeds on `main`. It removes only the known unreachable `v0.8.1`
tag to the annotated `archive/orphaned-v0.8.1` ref (preserving the
commit), converts `v1.1.5` to an annotated tag without changing its target, creates the
annotated `v1.6.2` tag and publishes that GitHub Release.
It does not fabricate intermediate historical tags or rewrite commits.

## 5. After release

- Confirm the tag and GitHub Release appear on the repository's Releases
  page.
- Confirm the release points to the intended commit.
- Do not create a second tag for the same version.
- Start subsequent unreleased work under `[Unreleased]` in
  `CHANGELOG.md`.

## Historical release policy

The existing commit graph and all valid historical tag targets are
preserved. The one-time reconciliation archives the single unmerged
release ref rather than discarding its commit, and only corrects the
annotation of `v1.1.5`. Do not invent backdated release tags or GitHub
Releases when the exact release commit cannot be established from the
source history.

## Installable server downloads

After source validation, the release workflow builds native Linux x64 and
arm64 containers from the tagged Dockerfiles. It packages the runtime with
Windows x64, Linux x64/arm64 and macOS Intel/Apple silicon launchers, and
boots the packaged topology on each Linux builder before publishing.
Publication waits for both architectures. Each archive includes images,
configuration tooling and START-HERE.md; no user data or credentials are
packaged. SHA256SUMS files accompany the downloads. Source archives remain
available. Existing release tags are not moved or repackaged by this change.

`node server/build.mjs` runs on a disposable native Linux Docker builder and
writes a fresh `server-dist/` directory (or an explicit new output directory).
It builds images and archives; it does not publish, configure a real server,
or alter a user's existing deployment. Installer/public-gateway and physical
Windows/macOS operation remain separate validation from Linux container CI.
See [decision 008](decisions/008-installable-home-server.md).
