import { formatBytes } from "../utils.js";

export default function StorageGauge({ usedBytes, quotaBytes }) {
  const pct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  const warn = pct >= 90;

  return (
    <div>
      <div className="gauge-label">
        <span>storage</span>
        <span>
          {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
        </span>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill ${warn ? "warn" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
