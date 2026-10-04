import { formatBytes } from "../utils.js";

// A striped, segmented "LED" bar showing how much of a person's storage
// quota is used. All of the looks (stripes, segments) live in CSS — see
// .gauge-* in design/components.css. This component only does two jobs:
//   1. work out the percentage, and
//   2. tell screen readers and color-blind users what the bar means.
export default function StorageGauge({ usedBytes, quotaBytes }) {
  // Guard against dividing by zero, and never let the bar overflow past
  // 100% even if someone is over quota.
  const pct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  const rounded = Math.round(pct);
  const warn = pct >= 90; // "almost full" threshold

  return (
    <div>
      <div className="gauge-label">
        <span>
          storage
          {/* Words as well as color: a red bar alone would be invisible to
              someone who can't tell red from orange. */}
          {warn && <strong className="gauge-note"> · almost full</strong>}
        </span>
        <span>
          {formatBytes(usedBytes)} / {formatBytes(quotaBytes)} · {rounded}%
        </span>
      </div>
      {/* role="meter" tells assistive tech "this is a measurement between
          a min and a max", and aria-valuenow is the current reading. */}
      <div
        className="gauge-track"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <div className={`gauge-fill ${warn ? "warn" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
