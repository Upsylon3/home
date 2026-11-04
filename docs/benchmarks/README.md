# Recorded client KDF observations

These are synthetic performance observations, not supported-hardware or
security certifications. See [the protocol](../HOMEVAULT_BENCHMARK.md).

## 2026-11-04 — local Windows x64, headless Chromium

[Raw JSON](2026-11-04-windows-x64-chromium.json) records source revision
`7d9f944114960ce31a55cec1375c1fad4cc828f5`, with a clean source tree when
measured. Host-reported hardware: Intel Core i7-4790K, eight logical processors,
16 GiB RAM. Chromium 145.0.7632.6 ran headlessly without CPU throttling.
The synthetic page was visible; power mode, thermals and competing OS load
were not controlled or measured. These are not physical-phone observations.

| Fresh-page run | First measured derivation | Median of following seven | Following min–max |
|---|---:|---:|---:|
| 1 | 55.0 ms | 49.2 ms | 46.2–298.2 ms |
| 2 | 74.1 ms | 51.9 ms | 45.4–86.4 ms |
| 3 | 47.7 ms | 47.5 ms | 45.8–129.7 ms |

Each run uses the shipped `m=19456 KiB, t=2, p=1` and a fresh page. The same
browser process was reused, so compiled-code/OS caches may already be warm.
No first-call value is labelled a cold browser startup. Outliers are retained,
not discarded. Salt generation, network, key unwrapping, rendering and full
unlock latency are excluded. The test does not measure peak memory use.

Conclusion: the current defaults completed on this host under these conditions.
No minimum client class, phone performance or latency budget is certified.
Representative low-end browser tests and the independent security review
remain open. CI measurements must not be appended here as physical-device proof.
