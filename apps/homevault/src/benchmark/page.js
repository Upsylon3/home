import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/fredoka/latin-600.css";
import "../styles/tokens.css";
import "../styles/index.css";
import "../styles/components.css";
import "./page.css";
import { DEFAULT_KDF_PARAMS } from "../crypto.js";
import { measureKdf } from "./measure.js";
import { version } from "../../../../package.json";

const form = document.querySelector("#benchmark-form");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const download = document.querySelector("#download");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
let controller = null;
let report = null;
let runInPage = 0;

document.querySelector("#parameters").textContent = `${DEFAULT_KDF_PARAMS.m / 1024} MiB · ${DEFAULT_KDF_PARAMS.t} iterations · parallelism ${DEFAULT_KDF_PARAMS.p}`;
const available = window.isSecureContext && !!globalThis.crypto?.subtle && typeof WebAssembly === "object";
start.disabled = !available;
status.textContent = "Ready. The test runs only when you choose Run speed test.";
if (!available) {
  start.disabled = true;
  status.textContent = "Open this page over HTTPS or localhost in a browser with WebAssembly and Web Crypto support.";
}

stop.addEventListener("click", () => {
  controller?.abort();
  status.textContent = "Stopping after the current derivation…";
});
document.addEventListener("visibilitychange", () => {
  if (controller && document.hidden) controller.abort(new Error("The page was hidden. Keep it visible and run the test again."));
});
window.addEventListener("pagehide", () => controller?.abort());

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (controller || !available) return;
  controller = new AbortController();
  report = null;
  download.disabled = true;
  start.disabled = true;
  stop.disabled = false;
  results.hidden = true;
  const deviceLabel = document.querySelector("#device").value.trim();
  document.querySelector("#device").disabled = true;
  runInPage++;
  // Give the browser a paint before the main-thread work starts.
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const measured = await measureKdf({
      signal: controller.signal,
      isVisible: () => document.visibilityState === "visible",
      onProgress: ({ completed, total }) => { status.textContent = `Measured ${completed} of ${total} derivations…`; }
    });
    report = {
      ...measured,
      packageVersion: version,
      deviceLabel,
      runInPage,
      browser: {
        userAgent: navigator.userAgent,
        reportedLogicalProcessors: navigator.hardwareConcurrency ?? null,
        reportedDeviceMemoryGiB: navigator.deviceMemory ?? null
      },
      scope: "Synthetic KDF timing only. Not total unlock time, a minimum-device certification, or a security review."
    };
    document.querySelector("#first").textContent = measured.firstDerivationMs.toFixed(1) + " ms";
    document.querySelector("#median").textContent = measured.summary.medianMs.toFixed(1) + " ms";
    document.querySelector("#range").textContent = measured.summary.minMs.toFixed(1) + "–" + measured.summary.maxMs.toFixed(1) + " ms";
    document.querySelector("#samples").textContent = measured.steadyMs.map(ms => ms.toFixed(1)).join(", ") + " ms";
    results.hidden = false;
    download.disabled = false;
    status.textContent = "Measurement complete. No vault was opened or changed. Results remain on this page unless you download them.";
  } catch (error) {
    status.textContent = error.name === "AbortError" ? "Test stopped. No partial report was kept." : "Test did not complete: " + error.message;
  } finally {
    controller = null;
    start.disabled = false;
    stop.disabled = true;
    document.querySelector("#device").disabled = false;
  }
});

download.addEventListener("click", () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "homevault-kdf-benchmark.json";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
