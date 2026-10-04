import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api.js";
import AppCard from "../components/AppCard.jsx";
import { formatBytes, timeAgo, describeEvent } from "../utils.js";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Turns the raw health report from HomeCore into ONE short sentence plus a
// light color for the hero's status lamp. We always show the sentence as
// well as the colored dot, so nobody has to rely on color to understand it.
//
// `health` looks like { checks: { database: "healthy", storage: "degraded" } },
// or null while the request is still in flight or if HomeCore is unreachable.
function summarizeHealth(health) {
  if (!health) return { tone: "pending", text: "Checking systems…" };

  // Collect the names of every check that is NOT "healthy".
  const problems = Object.entries(health.checks)
    .filter(([, state]) => state !== "healthy")
    .map(([name]) => name);

  if (problems.length === 0) return { tone: "healthy", text: "All systems normal" };
  return { tone: "degraded", text: `Needs attention: ${problems.join(", ")}` };
}

export default function Dashboard() {
  const { user } = useOutletContext();
  const [apps, setApps] = useState(null);
  const [health, setHealth] = useState(null);
  const [system, setSystem] = useState(null);
  const [activity, setActivity] = useState(null);
  const [homecloudQuota, setHomecloudQuota] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.apps.list(),
      api.health(),
      api.system(),
      api.myActivity(8),
      api.homecloudQuota()
    ]).then(([appsRes, healthRes, systemRes, activityRes, quotaRes]) => {
      if (cancelled) return;

      if (appsRes.status === "fulfilled") setApps(appsRes.value.data.applications);
      else setLoadError("Couldn't reach HomeCore. Some of this page may be out of date.");

      if (healthRes.status === "fulfilled") setHealth(healthRes.value.data);
      if (systemRes.status === "fulfilled") setSystem(systemRes.value.data);
      if (activityRes.status === "fulfilled") setActivity(activityRes.value.data.events);
      if (quotaRes.status === "fulfilled") setHomecloudQuota(quotaRes.value.data);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const heroHealth = summarizeHealth(health);

  return (
    <div className="page">
      {/* The "hero": a woodgrain frame around a dark label plate, like the
          front panel of a 1970s console. The look is all CSS (.hero*, and
          .woodgrain / .stripe-band from design/tokens.css). This markup only
          supplies the words. */}
      <header className="hero woodgrain">
        <div className="hero-plate">
          <p className="page-eyebrow">Home</p>
          <h1 className="page-title hero-title">
            {greeting()}, {user.displayName || user.username}
          </h1>
          {/* role="status" makes screen readers announce this line when it changes */}
          <p className="hero-status" role="status">
            <span className={`status-dot ${heroHealth.tone}`} aria-hidden="true" />
            {heroHealth.text}
          </p>
          {/* The signature stripes, running edge to edge along the plate's bottom */}
          <div className="stripe-band hero-stripes" aria-hidden="true" />
        </div>
      </header>

      {loadError && <div className="error-banner">{loadError}</div>}

      <div className="section">
        <h2 className="section-heading">Applications</h2>
        {apps === null ? (
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</p>
        ) : apps.length === 0 ? (
          <div className="list-panel">
            <div className="empty-state">
              <span className="glyph">·</span>
              No applications registered yet.
            </div>
          </div>
        ) : (
          <div className="app-grid">
            {apps.map((app) => (
              <AppCard
                key={app.slug}
                app={app}
                stat={
                  app.slug === "homecloud" && homecloudQuota
                    ? `${formatBytes(homecloudQuota.usedBytes)} of ${formatBytes(homecloudQuota.quotaBytes)} used`
                    : null
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2 className="section-heading">System</h2>
        <div className="status-strip">
          <div className="status-pill">
            <span className={`status-dot ${health ? health.checks.database : "offline"}`} />
            <span className="status-label">Database</span>
          </div>
          <div className="status-pill">
            <span className={`status-dot ${health ? health.checks.storage : "offline"}`} />
            <span className="status-label">Storage</span>
          </div>
          {system && (
            <div className="status-pill">
              <span className="status-label">Version</span>
              <span className="status-value">{system.version}</span>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <h2 className="section-heading">Recent</h2>
        <div className="list-panel">
          {activity === null ? (
            <div className="empty-state">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="empty-state">
              <span className="glyph">·</span>
              Nothing yet. Actions across your applications will show up here.
            </div>
          ) : (
            activity.map((event) => (
              <div className="list-row" key={event.id}>
                <span className="list-row-main">
                  {event.applicationSlug && <span className="list-row-app">{event.applicationSlug}</span>}
                  {describeEvent(event)}
                </span>
                <span className="list-row-time">{timeAgo(event.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
