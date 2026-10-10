import { buildSegments } from "../chart.js";

const WIDTH = 240;
const HEIGHT = 56;

// A small line chart with no axes: a "sparkline". The calculating is done by
// chart.js; this component only draws.
//
// Props:
//   points   [{ x, y }]; y may be null for a gap
//   domain   [min, max] to fix the vertical scale (e.g. [0, 100] for percentages)
//   label    a plain-words description for screen readers, since an SVG
//            drawing says nothing to someone who can't see it
//   empty    what to say when there is nothing to draw
export default function Sparkline({ points, domain, label, empty = "Collecting data…" }) {
  const segments = buildSegments(points, { width: WIDTH, height: HEIGHT, domain });

  if (segments.length === 0) return <p className="spark-empty">{empty}</p>;

  return (
    <svg className="spark" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="spark-base" x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} />
      {segments.map((segment, i) =>
        segment.length > 1 ? (
          <polyline key={i} className="spark-line" points={segment.map(([x, y]) => `${x},${y}`).join(" ")} />
        ) : (
          <circle key={i} className="spark-dot" cx={segment[0][0]} cy={segment[0][1]} r="2" />
        )
      )}
    </svg>
  );
}
