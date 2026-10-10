import { useEffect, useState } from "react";
import { api } from "../api.js";
import Meter from "../components/Meter.jsx";
import Sparkline from "../components/Sparkline.jsx";
import {
  formatBytes,
  formatRate,
  formatDuration,
  formatAgo,
  SERVICE_STATUS,
  BACKUP_STATUS
} from "../format.js";

// The one dashboard: server numbers, services, backups, disk growth, alerts.
// It refreshes itself, so it can sit open on a spare screen.

const STATUS_EVERY_MS = 15_000; // live numbers
const TRENDS_EVERY_MS = 60_000; // charts change slowly

export default function Overview() {
  const [status, setStatus] = useState(null); // the latest snapshot, or null while loading
  const [history, setHistory] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false); // signed in, but not an admin
  const [now, setNow] = useState(Date.now());

  // Live numbers: load now, then every 15 seconds. (Once the server has said
  // "administrators only" there is no point asking again, so we stop.)
  useEffect(() => {
    if (forbidden) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const { data } = await api.status();
        if (!cancelled) {
          setStatus(data);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        if (err.status === 403) setForbidden(true);
        else setError(err.message); // keep showing the last good numbers underneath
      }
    }
    load();
    const timer = setInterval(load, STATUS_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [forbidden]);

  // Charts: load now, then every minute. A failure here just leaves the old
  // chart in place; the live numbers above are what matter.
  useEffect(() => {
    if (forbidden) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const [h, g] = await Promise.all([api.history(24), api.diskGrowth(90)]);
        if (!cancelled) {
          setHistory(h.data);
          setGrowth(g.data);
        }
      } catch {
        // see above
      }
    }
    load();
    const timer = setInterval(load, TRENDS_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [forbidden]);

  // Keeps "updated 12 s ago" ticking between refreshes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  if (forbidden) {
    return (
      <main className="page">
        <div className="page-header">
          <p className="page-eyebrow">HomeMonitor</p>
          <h1 className="page-title">Administrators only</h1>
        </div>
        <div className="panel">
          <p className="panel-desc" style={{ margin: 0 }}>
            HomeMonitor shows the server's inner workings, so it is limited to administrator accounts. Ask the person who runs your Home
            to sign in with theirs.
          </p>
        </div>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="page">
        <div className="page-header">
          <p className="page-eyebrow">HomeMonitor</p>
          <h1 className="page-title">Server status</h1>
        </div>
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : (
          <p className="loading-state">Taking the first reading…</p>
        )}
      </main>
    );
  }

  const { system, disks, services, backups, alerts } = status;
  const alertCount = alerts.length;
  const samples = history ? history.samples : [];
  const trend = (key) => samples.map((s) => ({ x: s.t, y: s[key] }));
  const latestOf = (key) => {
    const last = [...samples].reverse().find((s) => s[key] !== null && s[key] !== undefined);
    return last ? `${Math.round(last[key])}%` : "no data";
  };

  return (
    <main className="page">
      <div className="page-header">
        <p className="page-eyebrow">HomeMonitor</p>
        <h1 className="page-title">Server status</h1>
        {/* role="status": screen readers announce changes politely */}
        <p className="summary-line" role="status">
          <span className={`status-dot ${alertCount > 0 ? "unhealthy" : "healthy"}`} aria-hidden="true" />
          {alertCount > 0 ? `${alertCount} active alert${alertCount === 1 ? "" : "s"}` : "All normal"}
          <span className="summary-dim"> · updated {formatAgo(status.at, now)}</span>
        </p>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          Couldn't refresh: {error}. Showing the last reading.
        </div>
      )}
      {status.notifyError && (
        <div className="notice is-warning" role="status">
          An alert couldn't be sent to HomeCore ({status.notifyError}). It will be retried automatically.
        </div>
      )}
      {!status.alertsEnabled && (
        <div className="notice" role="status">
          Notifications are switched off (ALERTS_ENABLED=false). Alerts appear on this screen only.
        </div>
      )}

      {alertCount > 0 && (
        <section className="panel" aria-labelledby="alerts-title">
          <h2 className="panel-title" id="alerts-title">
            Active alerts
          </h2>
          <ul className="alert-list">
            {alerts.map((alert) => (
              <li key={alert.key} className="alert-row">
                <span className={`tag is-${alert.severity}`}>{alert.severity}</span>
                <div>
                  <strong>{alert.title}</strong>
                  {alert.body && <div className="alert-body">{alert.body}</div>}
                  <div className="alert-since">since {formatAgo(alert.since, now)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="monitor-grid">
        <section className="panel" aria-labelledby="server-title">
          <h2 className="panel-title" id="server-title">
            Server
          </h2>
          <div className="meter-stack">
            <Meter label="CPU" percent={system.cpuPercent} />
            <Meter
              label="Memory"
              percent={system.memory.percent}
              detail={`${formatBytes(system.memory.usedBytes)} of ${formatBytes(system.memory.totalBytes)}`}
            />
            {disks.map((disk) =>
              disk.error ? (
                <div key={disk.label} className="meter">
                  <div className="gauge-label">
                    <span>Disk "{disk.label}"</span>
                    <span>
                      <strong className="gauge-note">can't read ({disk.error})</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <Meter
                  key={disk.label}
                  label={`Disk "${disk.label}"`}
                  percent={disk.usedPercent}
                  detail={`${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)}`}
                />
              )
            )}
          </div>
          <dl className="stat-list">
            <div>
              <dt>Load average</dt>
              <dd>{system.loadAverage.map((n) => n.toFixed(2)).join(" · ")}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{formatDuration(system.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {system.network ? `in ${formatRate(system.network.rxBytesPerSec)} · out ${formatRate(system.network.txBytesPerSec)}` : "not available"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="trend-title">
          <h2 className="panel-title" id="trend-title">
            Last 24 hours
          </h2>
          <div className="trend">
            <div className="trend-head">
              <span>CPU</span>
              <span>now {latestOf("cpu")}</span>
            </div>
            <Sparkline points={trend("cpu")} domain={[0, 100]} label={`CPU use over the last 24 hours, now ${latestOf("cpu")}`} />
          </div>
          <div className="trend">
            <div className="trend-head">
              <span>Memory</span>
              <span>now {latestOf("memory")}</span>
            </div>
            <Sparkline points={trend("memory")} domain={[0, 100]} label={`Memory use over the last 24 hours, now ${latestOf("memory")}`} />
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="services-title">
        <h2 className="panel-title" id="services-title">
          Services
        </h2>
        {status.registryError && <p className="panel-desc">{status.registryError}</p>}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Response</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const info = SERVICE_STATUS[service.status] || SERVICE_STATUS.unknown;
                return (
                  <tr key={service.slug}>
                    <td>{service.name}</td>
                    <td>
                      <span className={`status-dot ${info.lamp}`} aria-hidden="true" /> {info.label}
                    </td>
                    <td>{service.latencyMs === null ? "—" : `${service.latencyMs} ms`}</td>
                    <td className="cell-dim">{service.detail || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="monitor-grid">
        <section className="panel" aria-labelledby="backups-title">
          <h2 className="panel-title" id="backups-title">
            Backups
          </h2>
          <p className="backup-status">
            <span className={`status-dot ${backups.status === "ok" ? "healthy" : backups.status === "unknown" ? "unknown" : "unhealthy"}`} aria-hidden="true" />{" "}
            {BACKUP_STATUS[backups.status]}
          </p>
          {backups.detail && <p className="panel-desc">{backups.detail}</p>}
          {backups.sources.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Latest</th>
                    <th>Size</th>
                    <th>Copies</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.sources.map((source) => (
                    <tr key={source.source}>
                      <td>{source.source}</td>
                      <td>
                        {source.ageHours} h ago{source.status === "stale" && <strong className="gauge-note"> · out of date</strong>}
                      </td>
                      <td>{formatBytes(source.latestSize)}</td>
                      <td>{source.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {backups.status !== "unknown" && (
            <p className="panel-desc">Judged out of date after {backups.maxAgeHours} hours without a new backup.</p>
          )}
        </section>

        <section className="panel" aria-labelledby="growth-title">
          <h2 className="panel-title" id="growth-title">
            Disk growth
          </h2>
          {growth && growth.disks.length > 0 ? (
            growth.disks.map((disk) => {
              const last = disk.points[disk.points.length - 1];
              const forecast = disk.forecast;
              let forecastText = "Not enough history yet for a forecast (needs about 3 days).";
              if (forecast) {
                forecastText =
                  forecast.daysUntilFull === 0
                    ? "Already full."
                    : `At this rate: full in about ${forecast.daysUntilFull} day${forecast.daysUntilFull === 1 ? "" : "s"} (growing ${formatBytes(forecast.bytesPerDay)} a day).`;
              } else if (disk.points.length >= 3) {
                forecastText = "Not growing, so no forecast.";
              }
              return (
                <div className="trend" key={disk.label}>
                  <div className="trend-head">
                    <span>Disk "{disk.label}"</span>
                    <span>
                      {formatBytes(last.usedBytes)} of {formatBytes(last.totalBytes)}
                    </span>
                  </div>
                  <Sparkline
                    points={disk.points.map((p, i) => ({ x: i, y: p.usedBytes }))}
                    label={`Daily disk use for "${disk.label}" over ${disk.points.length} days, now ${formatBytes(last.usedBytes)}`}
                    empty="Not enough history yet."
                  />
                  <p className="trend-note">{forecastText}</p>
                </div>
              );
            })
          ) : (
            <p className="panel-desc" style={{ margin: 0 }}>
              History builds up once a day. Check back tomorrow.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
