# Contributing

Development, checks and release instructions live here. Coding agents must
also follow [AGENTS.md](AGENTS.md).

## Changes

- Inspect the source and relevant product, architecture and security rules.
  Explain deliberate changes to those rules.
- Keep PRs focused. Preserve ownership, data and API compatibility; use additive
  migrations and disposable test databases.
- Add dependencies only for a concrete need. Use real upstream services in
  integration tests where the architecture requires them.
- Update relevant docs and `[Unreleased]`. Follow the shared design system.
- Run [applicable checks](#ci-policy), review the diff and fix failures.
  Never claim tests or device validation that did not happen.

## Branches and commits

Use `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`, `ci/`, `build/`
or `perf/` followed by a short kebab-case name. Dependabot branches are exempt.
Use Conventional Commit subjects and PR titles:

~~~text
feat(homecloud): add expiring share links
fix(homecore): reject revoked sessions
docs: simplify deployment instructions
~~~

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `build`,
`perf`, `chore`, `revert`. Use lowercase type/scope, an imperative summary,
no trailing period, and `!`/`BREAKING CHANGE:` for incompatible changes.

Enable the local hook: `git config core.hooksPath .githooks`. Open PRs to
`main`; do not push routine work directly. Wait for applicable checks, then
squash-merge using the validated PR title. Respect protection rules.
See [versioning](#versioning) and [releasing](#releasing).

## Security reports

Contact the maintainer privately through an available private GitHub channel.
Do not post credentials, personal data or exploit details in a public issue.
Known limitations are in [SECURITY.md](docs/SECURITY.md).

## Development

For running a downloaded server, use [START-HERE](server/START-HERE.md).
This guide is for source changes.

### Prerequisites and install

Use Node 26 LTS and npm. Docker is optional for individual services but required
for stack tests/runtime packaging. Android work also needs Android Studio/JDK 17.

~~~bash
npm ci
git config core.hooksPath .githooks
~~~

The root workspace installs all Node packages. npm 11 permits only the reviewed,
exact-version `better-sqlite3@12.11.1` install script. Never approve all lifecycle
scripts or accept an unnoticed native source-build fallback on Windows.

### Run locally

On Windows, `npm run dev:home` opens the existing service picker. It starts
selected processes in development terminals; optional Bridge is started separately.

For manual development, copy the affected service's `.env.example` where one
exists. Configure matching internal secrets and localhost upstreams; never
overwrite an existing environment file or use production data. Start Core first,
then an app's hard dependencies, backend and frontend:

~~~bash
npm run dev --workspace=homecore
npm run dev --workspace=apps/homecloud-backend
npm run dev --workspace=apps/homecloud
~~~

Run each process in its own terminal. A workspace command uses that workspace's
working directory, so its own dotenv file is used.

| Service | Port | Local upstream configuration |
|---|---:|---|
| Core | 4000 | `JWT_SECRET` and `HOMECORE_INTERNAL_SECRET` |
| Cloud backend | 4500 | Core at `http://localhost:4000`; matching internal secret |
| Media backend | 4200 | Core and Cloud at `http://localhost:4500` |
| Sync backend | 4300 | Core and Cloud |
| Notes backend | 4400 | Core and Cloud |
| Vault backend | 4600 | Core only |
| Tasks backend | 4700 | Core only |
| Monitor backend | 4800 | Core, matching internal secret, local health URLs |
| Bridge | 4900 | Core, Notes at 4400, Tasks at 4700 |

The upstream variables are `HOMECORE_INTERNAL_URL` and
`HOMECLOUD_BACKEND_INTERNAL_URL`. Bridge uses `HOMENOTES_INTERNAL_URL` and
`HOMETASKS_INTERNAL_URL`. For Monitor, set `SERVICE_URLS` to local app health
URLs and `ALERTS_ENABLED=false` if testing only a subset of services.
Consult each workspace's example/config and the Windows launcher for full values.

Each frontend's Vite configuration defines its development port and API proxies.
Start only the frontend you need with `npm run dev --workspace=apps/APP`.
Use the gateway for production-style shared-origin testing.

### Source-based Docker

Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md) for configuration, then:

~~~bash
docker compose up --build -d
docker compose logs -f
docker compose stop
~~~

Source Compose and downloaded bundles use different storage layouts. Move a
supported source installation with the bundle's documented `import` command;
do not mix their data directories or volumes manually.

### Tests and builds

Run affected workspaces first:

~~~bash
npm test --workspace=homecore
npm test --workspace=apps/homevault
npm run build --workspace=apps/homevault
~~~

Backend tests create isolated databases/listeners and use real upstream services.
Do not point them at a personal installation. For a full regression when required:

~~~bash
npm test
npm run build --workspaces --if-present
bash gateway/test/gateway-smoke.sh
npm run test:backup
~~~

Gateway tests need nginx, Python 3 and curl. Backup tests need the shell/Python
tools documented by their fixtures; Docker CI covers real read-only mounts.
Windows CI verifies the native SQLite prebuild and storage/media file teardown.

Use [CI policy](#ci-policy) for scope selection. PRs run applicable checks;
full manual/weekly and release gates remain available. Skipped unrelated jobs
are intentional. Browser demo changes use the static [demo checks](#browser-demo).
Do not boot an unrelated backend stack or emulator for frontend/docs work.

### Android

Open `apps/homesync-android/` in Android Studio. Use the committed Gradle
wrapper-properties version (the checkout has no wrapper script/jar), JDK 17
and the SDK/toolchain declared by the build and [Android CI](.github/workflows/android.yml).
Keep Kotlin's compiler and Compose plugin versions aligned when updating.
CI must install the exact Gradle version declared in wrapper properties; missing,
duplicate or unsupported declarations fail closed. Assess AGP/Gradle minor and
major upgrades together; do not infer compatibility from CI using another version.
Keep target/minimum SDK behavior separate from compile-SDK/toolchain changes.

From the Android project directory:

~~~bash
gradle --no-daemon --console=plain :app:assembleDebug :app:testDebugUnitTest
~~~

Enter the gateway address in the app, not a private backend port. CI checks
APK/JVM behavior only; instrumentation fixtures remain available for explicit
local runs. [Device validation](docs/VALIDATION.md#homesync) records what
has and has not been exercised.

### Optional features and diagnostics

- Bridge search: run `services/homebridge` with the localhost upstreams above;
  open Home's search page. It needs no automation key or persistent state.
- Automation and task reminders: use the separate operator configuration in
  [DEPLOYMENT.md](docs/DEPLOYMENT.md); do not enable them implicitly.
- Reminder browser QA: build Home/Tasks and run
  `node apps/hometasks-backend/test-support/browser-fixture.cjs`. It creates
  disposable services only; its review controls do not exist in production.
- Vault performance: [optional client speed test](docs/VALIDATION.md#vault-performance).
- Vault security review: [isolated reproduction and scope](docs/VALIDATION.md#vault-review).

## CI policy

Local commits run only the existing fast commit-message check. GitHub checks pull requests as they change; merges do not repeat the same Node/Docker/Android suites. A weekly Sunday full run and each workflow's **Run workflow** button retain broad regression and dependency coverage. Release candidates still require the full manual gate documented under [releasing](#releasing).

`ci-scope.py` selects work by ownership and dependency impact. Its tests run before CI/Android selection, and unknown paths or selector/CI-policy edits fall back to full coverage. A failed/missing selector also cannot silently skip checks. Stable job names remain present as intentionally skipped when irrelevant.

| Change | Normal PR proof |
|---|---|
| Markdown | Conventions and lightweight selection only |
| Demo code/workflow | Demo contract tests, seven static app builds and real browser journeys using installed Chrome |
| One web frontend | That frontend's tests/build, plus the browser demo; no Docker, Windows native build or Android |
| Shared design assets | Frontend tests/builds and browser demo |
| One backend | Its suite plus real dependent-service suites, Docker integration; Cloud/Media additionally exercise Windows file lifecycle |
| Gateway/Compose/backup | Relevant gateway, Docker and backup proof |
| Root dev tooling/scripts | Frontend/demo checks as relevant and dependency audit; no Android fixture/emulator just for Playwright |
| Runtime dependency/native/runtime-policy changes | Expanded Node/stack proof; Android only if its actual fixture dependencies/runtime policy changed |
| Android presentation resources | APK build and JVM tests; no emulator |
| Android runtime, permissions, WorkManager, upstream Core/Cloud/Sync/client | APK build and JVM tests |
| Unknown path, selection policy, manual/weekly run | Full regression |

Test-only edits run their owner suite without starting a server stack or emulator. Android changes receive build/JVM validation.

The selector resolves the Android fixtures' production, optional and peer dependency closure through the committed npm lockfile, including nested packages and workspace links. A transitive native/auth dependency update therefore still selects Android build/JVM checks. Changes to a frontend-only/dev package do not.

Frontend-only jobs install with `--ignore-scripts`; native-backend tests keep the real approved installation. Audit reads the committed dependency graph without another native installation. Existing security, ownership, migration, cryptography, gateway and backup tests are retained; their relevant paths still select them. Recurrence of hardware/independent-review limits is unchanged.

Android CI never installs, boots or runs an emulator, including manual and weekly runs. Instrumentation test sources and disposable fixtures remain available for explicit local device testing. APK/JVM success does not prove Android UI, permission or WorkManager behavior. This is an explicit coverage reduction requested by the project owner to reduce CI duration.

### Pages: reuse the verified build

The Browser demo PR workflow builds and tests once, then retains static files and source-tree/run metadata for 14 days. Deploy browser demo runs on a merged PR affecting the site (or explicitly on main) and downloads that exact immutable artifact. It verifies successful run/head/attempt, expiration, merged source-tree equality, repository path, index presence and absence of links/special files. GitHub's download action fails on a digest mismatch. Only then is the static site uploaded to Pages. Deployment runs no npm install, build, browser or Android tests.

The privileged closed-PR workflow uses the trusted base-branch definition and checks out only the merged main commit. It never executes PR-head code or downloaded files. Old deployments cannot replace a newer main commit. If main advanced after verification, or artifacts expired, run Browser demo on current main and then Deploy browser demo; a mismatched build is never silently published.

To run the new policy proof locally:

```sh
python -m unittest discover -s scripts/test -p 'test_ci_*.py'
node --test scripts/test/demo-artifact.test.mjs
python scripts/ci-scope.py --base origin/main --head HEAD --event pull_request
```

Scope selection is not a security/authorization boundary: the existing repository rules and PR review/merge policy still govern changes. No branch protection, permissions, repository secrets or billing settings are changed.

### Release source verification

`CI` also accepts a reusable-workflow `source_ref` input. The release workflow
supplies its validated tag, every checkout uses that explicit ref, and selection
is forced to the full regression gate. Release staging depends on all of those
checks passing. Normal PR selection and manual/weekly runs retain their policy.

## Browser demo

[Open HOME](https://upsylon3.github.io/home/) without a server. This is a static
build of the existing web apps with a browser-local API adapter.

### Use it

A current browser with service workers, IndexedDB and Web Crypto is required;
use HTTPS or localhost. First use creates local sample data. Demo sign-in is
simulated: any name/password enters the same sandbox, not a separate account.

Files, notes, tasks and test Vault ciphertext persist in that browser/profile.
Clearing storage, eviction or private browsing can erase them. Master passwords,
plaintext vault keys and decrypted entries are not intended to persist.
**Use test data only.** Browser storage is not backup or a security review.

Reset erases this sandbox and restores samples. The demo does not prove backend
authorization, real server storage, phone backup or real monitoring.

### Build and verify

~~~bash
npm run build:demo
npm run preview:demo
npm run test:demo
npm run test:demo:browser
~~~

The default base is `/home/`; set `DEMO_BASE` consistently for another path.
The build rewrites only the demo's API/session/bootstrap paths, leaving server
apps unchanged. Pages deploys the checked artifact only when its source tree
matches the merge; it does not rebuild after merge.

The [address portal](https://upsylon3.github.io/home/connect/) stores shortcuts
only. The [Vault speed test](docs/VALIDATION.md#vault-performance) is a separate anonymous
entry without the demo sign-in, IndexedDB adapter or backend calls.

## Versioning

The current ecosystem release is **1.7.0**. The root `package.json` is the
version authority; keep the root lockfile's version fields in sync. Workspace
versions are package metadata and are not bumped together.

### Release rules

- Routine work goes under `[Unreleased]` in the changelog.
- Use PATCH for compatible fixes, MINOR for compatible features and MAJOR for
  incompatible API/data changes. A commit or completed phase is not a release.
- The newest versioned changelog heading, root version and annotated
  `vX.Y.Z` tag must agree.
- A tag identifies the exact validated main commit. Never move, reuse, delete
  or backdate a valid release tag.
- Preserve existing accounts/data and document any compatibility or migration
  requirements before release.

Follow [release process](#releasing) for the gate and publication process.
Use the [branch and commit conventions](#branches-and-commits) above.

### Historical baseline

The corrected historical baseline is 1.6.2. Earlier phase numbering is not a
template for future releases. The one-time reconciliation script preserves
historical commits/valid tags and is limited to the audited legacy refs.
Do not recreate the inflated sequence or invent retrospective releases;
details remain in Git history and the changelog.

## Releasing

Use [SemVer](#versioning). Routine changes remain under `[Unreleased]`.

### Prepare

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

### Automated gate

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

### Failure and verification

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
version-guarded process; see [versioning](#versioning).
