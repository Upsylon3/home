import { meterTone } from "../format.js";

// A striped "LED" bar for a percentage, built on the shared .gauge-* styles.
// (The same look as HomeCloud's storage gauge.)
//
// Props:
//   label    what is measured ("CPU")
//   detail   the numbers in words ("36.0 GB of 50.0 GB")
//   percent  0-100, or null for "no reading yet"
export default function Meter({ label, detail, percent }) {
  if (percent === null || percent === undefined) {
    return (
      <div className="meter">
        <div className="gauge-label">
          <span>{label}</span>
          <span>No reading yet</span>
        </div>
        <div className="gauge-track" aria-hidden="true" />
      </div>
    );
  }

  const tone = meterTone(percent);
  const rounded = Math.round(percent);
  return (
    <div className="meter">
      <div className="gauge-label">
        <span>{label}</span>
        <span>
          {detail ? `${detail} · ` : ""}
          {rounded}%
          {tone !== "ok" && <strong className="gauge-note"> · {tone}</strong>}
        </span>
      </div>
      {/* role="meter" tells screen readers this is a measurement, not decoration */}
      <div
        className="gauge-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}%${tone !== "ok" ? `, ${tone}` : ""}`}
      >
        <div className={`gauge-fill${tone !== "ok" ? " warn" : ""}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}
