import { DEFAULT_KDF_PARAMS, deriveMasterKeyBits, generateSalt } from "../crypto.js";

export const STEADY_SAMPLES = 7;
const TEST_PASSWORD = "HOME benchmark: public synthetic input, never a real password";

export function summarize(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error("Timing samples must be positive finite numbers.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    minMs: sorted[0],
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    maxMs: sorted.at(-1)
  };
}

// The same main-thread call as Setup/Unlock, with fixed production defaults.
// Yield between calls so Stop and visibility changes can be processed. A
// currently executing WASM call cannot be interrupted on this thread.
export async function measureKdf({ signal, isVisible = () => true, onProgress = () => {} } = {}) {
  const check = () => {
    signal?.throwIfAborted();
    if (!isVisible()) throw new Error("The page was hidden. Keep it visible and run the test again.");
  };
  const timings = [];
  for (let index = 0; index <= STEADY_SAMPLES; index++) {
    check();
    const salt = generateSalt();
    let bits;
    try {
      const start = performance.now();
      bits = await deriveMasterKeyBits(TEST_PASSWORD, salt, DEFAULT_KDF_PARAMS);
      const elapsed = performance.now() - start;
      if (!(bits instanceof Uint8Array) || bits.length !== 32) throw new Error("Derivation returned an unexpected result.");
      timings.push(elapsed);
    } finally {
      // Best-effort cleanup of our output buffers; not a WASM-memory erasure guarantee.
      bits?.fill(0);
      salt.fill(0);
    }
    onProgress({ completed: index + 1, total: STEADY_SAMPLES + 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    check();
  }
  const [firstDerivationMs, ...steadyMs] = timings;
  return {
    schema: 1,
    algorithm: "Argon2id",
    implementation: "hash-wasm / production deriveMasterKeyBits",
    execution: "browser-main-thread",
    kdfParams: { ...DEFAULT_KDF_PARAMS },
    saltBytes: 16,
    derivedKeyBytes: 32,
    measuredAt: new Date().toISOString(),
    firstDerivationMs,
    steadyMs,
    summary: summarize(steadyMs)
  };
}
