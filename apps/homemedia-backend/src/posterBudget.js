const POSTER_TTL_MS = 15_000;
const POSTER_BYTES = 16 * 1024 * 1024;
const READ_BYTES = 2 * 1024 * 1024;

function createPosterBudget(now = Date.now()) {
  return { expiresAt: now + POSTER_TTL_MS, bytes: POSTER_BYTES, requests: 8 };
}

// Reserve before awaiting Cloud so parallel range requests share one hard cap.
function reservePosterRead(budget, header, now = Date.now()) {
  if (now >= budget.expiresAt || budget.requests <= 0 || budget.bytes <= 0) {
    const error = new Error('Video preview budget expired.'); error.status = 410; throw error;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header || 'bytes=0-');
  const start = match ? Number(match[1]) : NaN;
  const end = match?.[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    const error = new Error('Unsupported video preview range.'); error.status = 416; throw error;
  }
  const bytes = Math.min(READ_BYTES, budget.bytes, end - start + 1);
  budget.requests--; budget.bytes -= bytes;
  return { range: `bytes=${start}-${start + bytes - 1}`, bytes };
}

module.exports = { createPosterBudget, reservePosterRead, POSTER_TTL_MS, POSTER_BYTES };
