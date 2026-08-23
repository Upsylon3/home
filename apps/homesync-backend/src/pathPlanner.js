// Pure function, no I/O — kept separate from homecloudClient.js's actual
// folder resolution specifically so it's trivial to test on its own.
// Matches the spec's own example layout: HomeSync uploads land in
// /<Category>/<Year>/<Month> (e.g. "/Photos/2026/August"), which is also
// exactly what HomeMedia already scans for images/videos regardless of
// folder — the two were never coordinated on this, it just falls out of
// both following the same spec.
function buildPathSegments(category, capturedAtIso) {
  const parsed = capturedAtIso ? new Date(capturedAtIso) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  const year = String(date.getFullYear());
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return [category, year, month];
}

module.exports = { buildPathSegments };
