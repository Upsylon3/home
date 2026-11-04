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

### Provisional client targets — owner clarification, 2026-11-04

The owner wants an old Dell office computer and a phone a couple of
generations older than their Galaxy S20 FE. Use these concrete reference
classes for the first physical-device matrix; they are performance targets,
not a statement that all older devices are unsupported or that these pass:

| Reference client | Initial configuration to test | Evidence status |
|---|---|---|
| Old Dell office PC | OptiPlex 3020-class machine; fourth-generation Core i3/i5, 4 GiB RAM; normal desktop Chrome or Firefox | Not measured on a representative office configuration |
| Older phone | Galaxy S9-class as the lower reference, with S10-class also useful; normal mobile Chrome | Not measured; record exact model/processor variant and Android/browser versions |
| Available phone | Owner's Galaxy S20 FE, normal mobile browser | Available reference device; no results received yet; cannot stand in for an older phone |

These example classes are grounded in [Dell's OptiPlex 3020 specifications](https://i.dell.com/sites/doccontent/business/smb/merchandizing/en/Documents/Dell_OptiPlex_3020_with_Micro_Technical_Spec_Sheet.pdf)
and [Samsung's Galaxy S9 specifications](https://www.samsungmobilepress.com/media-assets/galaxy_s9?tab=specs).
The RAM configuration and latency targets are project choices, not manufacturer
certifications. The measured i7-4790K/16 GiB desktop is a stronger reference
configuration, not proof for the i3/i5 office-PC target. No phone results may
be inferred from desktop measurements or synthetic CPU throttling.

Use an initial UX target of **at most one second for each run's steady median
and two seconds for its first measured derivation**, across three fresh-page
runs. Also record every sample/outlier, errors and observed responsiveness.
These are provisional usability goals, not security thresholds or certified
results. A slower result requires investigation and an explicit decision;
never automatically reduce the shipped work factors to achieve the target.

Record the actual OS and browser version. Google's current Android Chrome
requirements are [Android 10 or later](https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DAndroid&hl=en).
Check those requirements again when testing rather than treating the version
here as permanent. Hardware-speed validation does not establish OS security
support or approval to store real secrets on an unmaintained installation.

For the available S20 FE, open the public speed test, leave battery saver off,
keep the page visible and reload between three runs. Retain each exported JSON
or record the first and median timings together with Android/browser and
power/load conditions. This measures only synthetic input, so no real vault
or password is needed. Additional tests with battery saver on can be retained
separately, never mixed into the baseline without identifying the conditions.

The local report under [benchmarks](benchmarks/) is a desktop headless-browser
observation, not the minimum-device prerequisite. Its source revision and
execution conditions are embedded. Browser/CPU load and power state can
change results; the tool does not establish peak process memory or full
unlock responsiveness.

Before closing item 3:

1. Use the provisional owner-selected client classes and UX goals above;
   confirm the exact physical models and browser versions when results arrive.
2. Run three fresh-page tests in normal browsers on representative physical
   low-end clients (including a phone), recording model, browser, power/load
   conditions, failures and observed responsiveness. Only include a Pi in
   this matrix if it will run the client browser.
3. Assess measured first-call and steady latency against an explicitly chosen
   UX goals above. Neither the hardware targets nor the latency goals have
   been validated by the existing desktop observation.
4. If changes are justified, review the security tradeoff and stored per-vault
   compatibility separately. Never silently lower Argon2id cost for a slower
   server or automatically rewrite existing vaults.

The independent cryptography review remains a separate, open release gate.
