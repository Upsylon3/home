# Releasing HOME

Use [SemVer](../VERSIONING.md). Routine changes remain under `[Unreleased]`.

## Prepare

1. Merge release-bound work through reviewed, checked PRs.
2. Update only the root package/lock version metadata and move completed
   changelog entries into the matching release section.
3. Open a release-preparation PR, wait for all applicable checks and merge it.
   Require Android APK/JVM checks when Android changes.
4. Start from the clean, exact validated main commit. Check that the new tag
   does not already exist, then create an annotated tag:

~~~bash
git switch main
git pull --ff-only origin main
git status --short
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
~~~

Replace X.Y.Z with the prepared version. Never force, move, reuse or delete a
valid tag, including when a build fails.

## Automated gate

The Release workflow validates annotation, main ancestry, root version and
changelog. It calls the full reusable CI workflow against that explicit tag:
workspace tests/builds, Windows, gateway, backups, audit and Docker/package checks.
A manual dispatch from another branch still checks the supplied tag.

After those pass, a draft Release is created. Native Linux x64/arm64 builders
produce the Windows x64, Linux x64/arm64 and macOS Intel/Apple silicon bundles.
Each bundle includes prebuilt images, launchers and START-HERE, not user data
or credentials. Each architecture boots the packaged topology and checks
account/file persistence before upload. Both must succeed before publication.
SHA256SUMS accompany the archives; source archives remain available.

Large downloads are staged on the draft Release, not metered Actions artifact
storage. Published assets are not overwritten by retries.

## Failure and verification

Inspect a failed job before retrying. A transient failure can be rerun with the
same immutable tag; manual dispatch accepts that existing tag. Fix source bugs
through a new checked commit/version/tag, not by moving the failed tag.

After publication, verify the public Release, tag target, expected OS archives
and checksums. Keep subsequent changes under `[Unreleased]`. A release does not
establish independent Vault review, physical OS/device validation or real
router reachability.

For an isolated native Linux build, `node server/build.mjs` writes a fresh
`server-dist/` or an explicitly chosen new output path. It does not publish or
configure a personal deployment. Historical reconciliation is a closed,
version-guarded process; see [versioning](../VERSIONING.md).
