// "At this rate the disk is full in about N days."
//
// We fit a straight line through the daily "bytes used" points (least squares:
// the line that sits closest to all of them) and see when it reaches the
// disk's size. A straight line is crude, which is the point: it is easy to
// explain, and honest about being a rough guess. It says nothing unless there
// are at least 3 days of history and the disk is actually growing.

function dayNumber(day) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000; // days since 1970
}

// points = [{ day: "YYYY-MM-DD", usedBytes, totalBytes }], oldest first.
// Returns { daysUntilFull, bytesPerDay } or null.
function forecastFull(points) {
  if (points.length < 3) return null;

  const xs = points.map((p) => dayNumber(p.day));
  const ys = points.map((p) => p.usedBytes);
  if (xs[xs.length - 1] - xs[0] < 2) return null; // need at least 2 days of spread

  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const bytesPerDay = numerator / denominator; // the slope of the line
  if (!(bytesPerDay > 0)) return null; // flat or shrinking: it won't fill up

  const latest = points[n - 1];
  const remaining = latest.totalBytes - latest.usedBytes;
  if (remaining <= 0) return { daysUntilFull: 0, bytesPerDay };

  const daysUntilFull = remaining / bytesPerDay;
  if (daysUntilFull > 3650) return null; // "not in ten years" isn't a useful forecast
  return { daysUntilFull: Math.round(daysUntilFull), bytesPerDay };
}

module.exports = { forecastFull };
