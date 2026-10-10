// The maths behind the little line charts (Sparkline.jsx draws what this
// calculates). Pure, so it is tested without a browser.
//
// Input:  points = [{ x: number, y: number | null }]  (x is usually a time)
// Output: an array of "segments". Each segment is a run of consecutive points
//         that all have a value, as [pixelX, pixelY] pairs. A missing reading
//         (y = null) ENDS a segment, so a gap in the data shows as a gap in the
//         line instead of a misleading straight line across it.
//
// options:
//   width, height   the drawing area in pixels
//   padding         empty margin around it
//   domain          [min, max] for y, or omitted to fit the data
export function buildSegments(points, { width, height, padding = 3, domain } = {}) {
  const xs = points.map((p) => p.x);
  const ys = points.filter((p) => p.y !== null && p.y !== undefined).map((p) => p.y);
  if (ys.length === 0) return [];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let [minY, maxY] = domain || [Math.min(...ys), Math.max(...ys)];
  // A flat line (every value the same) would divide by zero below, so give it
  // some height to sit in the middle of.
  if (maxY === minY) {
    minY -= 1;
    maxY += 1;
  }

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const toPixels = (p) => {
    // With one x value there is nothing to spread across, so centre it.
    const px = maxX === minX ? width / 2 : padding + ((p.x - minX) / (maxX - minX)) * innerWidth;
    // Pixel y grows DOWNWARD but a bigger value should be HIGHER, so flip it.
    const clamped = Math.min(maxY, Math.max(minY, p.y));
    const py = padding + (1 - (clamped - minY) / (maxY - minY)) * innerHeight;
    return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
  };

  const segments = [];
  let current = [];
  for (const point of points) {
    if (point.y === null || point.y === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(toPixels(point));
    }
  }
  if (current.length) segments.push(current);
  return segments;
}
