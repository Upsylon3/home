# HomeVault client performance measurements

Roadmap item 3 concerns the browser that unlocks a vault. Argon2id is executed
client-side in `apps/homevault/src/crypto.js`; a Raspberry Pi serving HOME does
not run this derivation unless someone also opens the browser on that Pi.

The benchmark is implemented. Validation on representative minimum client
hardware remains **open**. No performance result is an independent security
review, and no encryption settings are changed by this tool.

## Run the device test

- Current development/Pages build: https://upsylon3.github.io/home/vault/benchmark.html
- A server containing this change: `/vault/benchmark.html`, or HomeVault
  Settings → **Open device speed test**. The 1.7.0 server downloads predate
  this tool; the online page can test a client without upgrading that server.
- Local development: `npm run dev --workspace=apps/homevault`, then open
  `http://localhost:5177/benchmark.html`. No backends or account are required.

Use HTTPS or localhost, a current WebAssembly/Web Crypto-capable browser, and
the actual device that will unlock the vault. Close heavy background apps,
keep the page visible, record the device model, OS/browser, power-saving mode
and any known thermal/load constraints in the optional device label. Do not
put personal information or secrets in the label.

Choose **Run speed test**. It measures one first derivation separately, then
seven subsequent derivations. Download the JSON if you want to retain it;
results are otherwise only in page memory. Reload and repeat three times for
fresh-page measurements. A reload is not a cold OS/browser-cache start, and
the first call of a second run without reloading can already be warm.

The page uses a public dummy password and fresh random 16-byte salts. It calls
the production `deriveMasterKeyBits` with the shipped defaults directly:
`m=19456 KiB (19 MiB), t=2, p=1`, deriving 32 bytes. These match the currently
documented [OWASP minimum configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
(checked 2026-11-04). This observation does not replace review of Vault's full
cryptographic design.

The call runs on the main thread, matching today's Setup/Unlock execution
path. Timing covers the Argon2id call, including its first-call WASM work if
applicable; it excludes salt generation, network, envelope fetch, key unwrap,
rendering and total unlock time. The page yields between calls. **Stop** takes
effect after the current call, not halfway through synchronous WASM. Hiding
the page or cancelling discards partial results. A browser error is shown
instead of a successful report. No custom work factors or automatic tuning
are exposed.

No login/session or vault storage is read, no API is called, no result is
uploaded and no automatic result storage is used. The usual theme/retro
preferences are read for presentation. Exported JSON contains public KDF
settings, timings, a client timestamp, page-run number, the optional label,
package version and browser-reported environment hints. CPU count/device-memory
hints can be rounded or concealed by browsers. Review a report before sharing;
it is not a hardware inventory or an anonymous fingerprint guarantee. Raw
salts and derived bytes are never exported. Clearing JS output buffers is
best effort, not proof of complete WASM/GC memory erasure.

## Maintainer proof and repeatable local recording

```powershell
npm run build --workspace=apps/homevault
node apps/homevault/test-support/benchmark-browser.mjs
```

The static-only fixture serves the production bundle with the gateway's real
Vault CSP. It exercises real derivations, JSON export, cancellation, narrow
screens, and refusal to read session storage or make API/third-party requests.
The browser demo separately exercises the Pages-prefixed build. CI checks
correctness, not a latency pass/fail threshold or target-device support.

To record three fresh-page runs on a local host:

```powershell
node apps/homevault/test-support/benchmark-browser.mjs path/to/local-results.json
```

This explicit command writes a report with the source revision/dirty flag,
headless-browser version and host CPU/RAM/OS hints, in addition to the three
UI-exported runs. It never records a hostname, username, IP, account or vault.
Use a clean source tree and build that revision first. It is not a substitute
for normal-browser measurements on physical low-end clients. `DEMO_BROWSER_CHANNEL=chrome`
can select installed Chrome; otherwise Playwright's headless Chromium must
be installed. No CPU throttling is applied, and throttling would not emulate
a specific phone or Raspberry Pi faithfully.

## Evidence and remaining acceptance

The local report under [benchmarks](benchmarks/) is a desktop headless-browser
observation, not the minimum-device prerequisite. Its source revision and
execution conditions are embedded. Browser/CPU load and power state can
change results; the tool does not establish peak process memory or full
unlock responsiveness.

Before closing item 3:

1. Agree on the minimum browser/device class actually intended for Vault.
2. Run three fresh-page tests in normal browsers on representative physical
   low-end clients (including a phone), recording model, browser, power/load
   conditions, failures and observed responsiveness. Only include a Pi in
   this matrix if it will run the client browser.
3. Assess measured first-call and steady latency against an explicitly chosen
   UX budget. No budget or hardware floor has been certified by this change.
4. If changes are justified, review the security tradeoff and stored per-vault
   compatibility separately. Never silently lower Argon2id cost for a slower
   server or automatically rewrite existing vaults.

The independent cryptography review remains a separate, open release gate.
