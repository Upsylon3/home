# Development

For running a downloaded server, use [START-HERE](../server/START-HERE.md).
This guide is for source changes.

## Prerequisites and install

Use Node 26 LTS and npm. Docker is optional for individual services but required
for stack tests/runtime packaging. Android work also needs Android Studio/JDK 17.

~~~bash
npm ci
git config core.hooksPath .githooks
~~~

The root workspace installs all Node packages. npm 11 permits only the reviewed,
exact-version `better-sqlite3@12.11.1` install script. Never approve all lifecycle
scripts or accept an unnoticed native source-build fallback on Windows.

## Run locally

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

## Source-based Docker

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for configuration, then:

~~~bash
docker compose up --build -d
docker compose logs -f
docker compose stop
~~~

Source Compose and downloaded bundles are separate installation paths. Do not
mix their data/volume layouts or assume an automatic migration.

## Tests and builds

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

Use [CI_POLICY.md](CI_POLICY.md) for scope selection. PRs run applicable checks;
full manual/weekly and release gates remain available. Skipped unrelated jobs
are intentional. Browser demo changes use the static [demo checks](BROWSER_DEMO.md).
Do not boot an unrelated backend stack or emulator for frontend/docs work.

## Android

Open `apps/homesync-android/` in Android Studio. Use the committed Gradle
wrapper-properties version (the checkout has no wrapper script/jar), JDK 17
and the SDK/toolchain declared by the build and [Android CI](../.github/workflows/android.yml).
Keep Kotlin's compiler and Compose plugin versions aligned when updating.

From the Android project directory:

~~~bash
gradle --no-daemon --console=plain :app:assembleDebug :app:testDebugUnitTest
~~~

Enter the gateway address in the app, not a private backend port. CI checks
APK/JVM behavior only; instrumentation fixtures remain available for explicit
local runs. [Device validation](HOMESYNC_DEVICE_VALIDATION.md) records what
has and has not been exercised.

## Optional features and diagnostics

- Bridge search: run `services/homebridge` with the localhost upstreams above;
  open Home's search page. It needs no automation key or persistent state.
- Automation and task reminders: use the separate operator configuration in
  [DEPLOYMENT.md](DEPLOYMENT.md); do not enable them implicitly.
- Reminder browser QA: build Home/Tasks and run
  `node apps/hometasks-backend/test-support/browser-fixture.cjs`. It creates
  disposable services only; its review controls do not exist in production.
- Vault performance: [optional client speed test](HOMEVAULT_BENCHMARK.md).
- Vault security review: [isolated reproduction and scope](HOMEVAULT_REVIEW.md).
