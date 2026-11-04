# Optional Vault speed test

Argon2id runs in the browser unlocking Vault, not on the storage server.
[Open the test](https://upsylon3.github.io/home/vault/benchmark.html), or use
`/vault/benchmark.html` on a build containing it. The 1.7.0 server bundle
predates this page; the online test needs no server or account.

## Use

Keep the page visible, close heavy background apps, label the device/browser
and power mode, then run the test. Reload between three runs. Export JSON only
if you want to keep/share results; do not put secrets in the device label.

It uses dummy input and production defaults (19 MiB, two iterations, one lane).
The first derivation is separate from seven following samples. It does not
read account/vault storage, call APIs, upload results or change encryption.
Theme preferences are read. Export includes browser hints and your label.

Stop takes effect after the current main-thread calculation. Hidden/cancelled
runs discard partial results. Timings exclude network, key unwrap, rendering
and full unlock time; a fresh page is not necessarily a cold browser start.

## Evidence

[Desktop observations](benchmarks/README.md) are not minimum-device certification.
Older Dell i3/i5-class PCs and S9/S10-class phones are provisional targets;
the owner's S20 FE is an available reference. Initial UX goals are a steady
median within one second and first call within two, not verified requirements.
Real target-device measurements remain open and are optional follow-up work.
Never lower KDF strength automatically to meet a timing goal. Independent
security review is a separate requirement.

## Developer commands

~~~bash
npm run build --workspace=apps/homevault
node apps/homevault/test-support/benchmark-browser.mjs
~~~

Pass a JSON output path to record three fresh-page local runs. The static fixture
uses the real gateway CSP and checks export, cancellation, mobile layout and
absence of session/API access. CI timing is not hardware evidence.
