import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api.js";
import AppCard from "../components/AppCard.jsx";

export default function Apps() {
  const { user } = useOutletContext();
  const isAdmin = user.role === "admin";
  const [apps, setApps] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [installed, available] = await Promise.all([api.apps.list(), isAdmin ? api.apps.catalog() : Promise.resolve(null)]);
      setApps(installed.data.applications);
      setCatalog(available?.data.applications || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [isAdmin]);

  async function change(action, success) {
    setBusy(true); setError(""); setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
      window.dispatchEvent(new Event("home:apps-changed"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function uninstall(app) {
    if (!window.confirm(`Uninstall ${app.name} from Home? Its files and settings will be kept. Background automation permissions for this app will be revoked.`)) return;
    change(() => api.apps.remove(app.slug), `${app.name} uninstalled. Its data was kept.`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <p className="page-eyebrow">Applications</p>
        <h1 className="page-title">Your applications</h1>
        <p className="page-subtitle">Choose the rooms in your Home. Installed applications keep their own files and settings.</p>
      </div>
      {error && <div className="error-banner" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => { setError(""); load(); }} disabled={busy}>Retry</button></div>}
      {message && <p role="status">{message}</p>}
      <div className="section" aria-busy={loading || busy}>
        <h2 className="section-heading">Installed</h2>
        {loading ? <p>Loading applications…</p> : apps === null ? <p>Application list unavailable.</p> : apps.length === 0 ? <p>No applications installed.{isAdmin ? " Choose one below to get started." : " Ask your administrator to install an application."}</p> : (
          <div className="app-grid">
            {apps.map(app => <AppCard key={app.slug} app={app} adminControls={isAdmin && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => change(
                  () => api.apps.update(app.slug, { enabled: !app.enabled }), `${app.name} ${app.enabled ? "disabled" : "enabled"}.`
                )}>{app.enabled ? "Disable" : "Enable"}</button>
                {app.slug !== "homecloud" && <button className="btn btn-danger-ghost" disabled={busy} onClick={() => uninstall(app)}>Uninstall</button>}
              </div>
            )} />)}
          </div>
        )}
      </div>
      {isAdmin && !loading && catalog !== null && <div className="section">
        <h2 className="section-heading">Available applications</h2>
        <p className="panel-desc">These apps are included with this server. Install an app, then enable it when you are ready. Uninstall keeps its data and removes it from Home. Saved app links can still work after uninstall.</p>
        <div className="app-grid">
          {catalog.filter(app => !app.installed).map(app => {
            const missing = (app.dependencies || []).filter(slug => !apps.some(installed => installed.slug === slug));
            const dependencies = (app.dependencies || []).map(slug => catalog.find(item => item.slug === slug)?.name || slug);
            return <div className="app-card" key={app.slug}>
              <h3 className="app-card-name">{app.name}</h3>
              <p className="app-card-desc">{app.description}</p>
              {dependencies.length > 0 && <p className="app-card-desc">Requires {dependencies.join(", ")}.</p>}
              {missing.length > 0 && <p>Install required applications first.</p>}
              <button className="btn btn-primary btn-sm" disabled={busy || missing.length > 0} onClick={() => change(
                () => api.apps.install(app.slug), `${app.name} installed. Enable it to launch it from Home.`
              )}>Install</button>
            </div>;
          })}
        </div>
        {catalog.length > 0 && catalog.every(app => app.installed) && <p>All included applications are installed.</p>}
      </div>}
    </div>
  );
}
