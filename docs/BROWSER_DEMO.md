# Browser-only HOME demo

The demo is a separate static build of the **existing seven React apps**, not a second UI. It needs no HOME server, Docker, domain purchase, account service or Supabase. Once Pages is enabled, the public entry point is https://upsylon3.github.io/home/.

## Use it

Open the website in a current browser with service workers, IndexedDB and Web Crypto enabled (Chrome, Edge, Firefox or Safari). HTTPS is required except on localhost. The first visit signs you into a local simulated administrator called Explorer and creates sample files, a note and a task. No real account is created. Later demo sign-in accepts any name/password; credentials are not saved or checked. All sign-ins use the same local sandbox, not isolated user accounts.

Files, notes, tasks, projects, albums, favorites and encrypted Vault records persist in IndexedDB across refreshes and app rebuilds. Vault uses the existing Argon2id, AES-GCM, recovery-kit and master-password flows. The master password, decrypted entries and plaintext vault key are not persisted by the demo layer. Use **test secrets only**; the existing independent security review remains open, and browser storage is not a backup.

Each browser/profile/device has its own independent data. Clearing site data, private browsing or browser storage eviction can erase it. The demo asks for persistent storage but the browser may refuse. Use **Reset demo** to confirm clearing only this demo's state and restore sample data, including removal of the test vault. A fresh computer can open the same website immediately, but does not receive another computer's data.

Uploads are limited to 100 MB per file and the browser's available storage. Cloud downloads and Media playback read local bytes, with range support. Media uses the original image as its preview; EXIF extraction and server thumbnail generation are not performed. Download files individually; batch ZIP downloads are unavailable.

Server monitoring is visibly simulated. Actual public sharing, HomeSync phone backups, multi-user administration, password/2FA security, background automation, notifications when the browser is closed, and server backups require a real server. Unsupported operations return a readable error rather than claiming success. HomeAI is not implemented in HOME and is not invented for the demo. Notes and Tasks search is local; Vault is excluded.

## Run or update the demo

```sh
npm ci --ignore-scripts
npm run test:demo
npm run build:demo
npm run preview:demo
```

Open http://127.0.0.1:4173/home/. No backend or environment secrets are used. Node 26 is the repository baseline. `DEMO_BASE` can override `/home/` at build and preview time. Internal routes use hashes so refresh and deep links work on GitHub Pages.

To run browser checks:

```sh
npx playwright install chromium
npm run test:demo:browser
```

On Windows, an installed Edge can be used by setting `DEMO_BROWSER_CHANNEL=msedge`. The check starts a disposable static server on port 4174 and uses fresh isolated browser contexts. It exercises all apps, real XHR uploads, concurrent writes, exact downloaded bytes, Notes autosave and refresh, Tasks refresh, Vault setup/save/refresh/wrong-password/unlock and plaintext absence in IndexedDB, mobile width, a fresh browser, and reset.

## GitHub Pages

The Browser demo workflow uses Chrome already installed on the GitHub Ubuntu runner; it does not download a browser or install OS dependencies on each run. It verifies pull requests and automatically builds/deploys main. One-time repository setup: **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then run **Actions → Browser demo → Run workflow** if the first deployment has not already run. No custom domain is needed. The workflow deploys only `demo-dist`, never backend code, test uploads or local environment files. Updates replace static assets and keep the IndexedDB database name stable.

## Implementation boundary

`demo/build.mjs` makes demo-only build transformations: HashRouter, repository base path, scoped API paths, a separate session key with no legacy production-token migration, and browser initialization before React mounts. Production source entry points, APIs and backend authorization remain unchanged. Cloud's production caching service worker is disabled for the demo so it cannot replace the demo worker.

`demo/worker.js` handles only this build's scoped `demo-api` requests and stores structured-clone state (including file Blobs) in `home-browser-demo-v1`. Requests are serialized across tabs to avoid lost read-modify-write updates. Failed mutations and quota errors are not committed. Unrelated network requests are never redirected to a server or Supabase. UI assets are served by Pages; demo content stays in the browser. CSP preserves the theme script hash and allows Vault WebAssembly compilation without allowing arbitrary inline scripts.

This build is a testing adapter, not an alternative production architecture or evidence of backend authorization. Future frontend API changes should extend the demo contract and its browser checks together.
