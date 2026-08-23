export default function AppCard({ app, stat, adminControls }) {
  const initial = app.name ? app.name.charAt(0).toUpperCase() : "?";

  return (
    <div className="app-card">
      <div className="app-card-top">
        <div className="app-card-icon" aria-hidden="true">
          {initial}
        </div>
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
