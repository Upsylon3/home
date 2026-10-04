import AppIcon from "./AppIcon.jsx";

// Only slugs the icon set actually has a glyph for — anything else (a
// future app not yet designed) falls back to the initial-letter tile
// rather than rendering a broken/blank icon. See design/AppIcon.jsx.
const ICONED_SLUGS = new Set([
  "home",
  "homecloud",
  "homemedia",
  "homenotes",
  "hometasks",
  "homesync",
  "homemonitor",
  "homevault",
  "homeai"
]);

export default function AppCard({ app, stat, adminControls }) {
  const initial = app.name ? app.name.charAt(0).toUpperCase() : "?";
  const hasIcon = app.slug && ICONED_SLUGS.has(app.slug);

  return (
    <div className={`app-card${app.enabled ? "" : " is-off"}`}>
      <div className="app-card-top">
        <div className="app-card-icon" aria-hidden="true">
          {hasIcon ? <AppIcon name={app.slug} size={28} /> : initial}
        </div>
        {/* A little rocker switch, purely decoration: its knob slides right
            (and lights up) when the app is enabled. aria-hidden because the
            footer below already says "Launch" or "Disabled" in words. */}
        <span className={`rocker${app.enabled ? " on" : ""}`} aria-hidden="true" />
      </div>
      <div>
        <h3 className="app-card-name">{app.name}</h3>
        {app.description && <p className="app-card-desc">{app.description}</p>}
      </div>
      {stat && <div className="app-card-stat">{stat}</div>}
      <div className="app-card-footer">
        {app.enabled ? (
          <a
            className="btn btn-primary btn-sm"
            href={app.baseUrl || "#"}
            target={app.baseUrl ? "_blank" : undefined}
            rel="noreferrer"
          >
            Launch
          </a>
        ) : (
          <span className="app-card-disabled-note">Disabled</span>
        )}
        {adminControls}
      </div>
    </div>
  );
}
