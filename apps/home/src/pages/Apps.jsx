import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api.js";
import AppCard from "../components/AppCard.jsx";

const EMPTY_FORM = { slug: "", name: "", description: "" };

export default function Apps() {
  const { user } = useOutletContext();
  const [apps, setApps] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.apps
      .list()
      .then(({ data }) => setApps(data.applications))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.apps.register({ slug: form.slug.trim(), name: form.name.trim(), description: form.description.trim() });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(app) {
    setError("");
    try {
      await api.apps.update(app.slug, { enabled: !app.enabled });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(app) {
    if (!window.confirm(`Remove ${app.name} from the application registry?`)) return;
    setError("");
    try {
      await api.apps.remove(app.slug);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const isAdmin = user.role === "admin";

  return (
    <div className="page">
      <div className="page-header">
        <p className="page-eyebrow">Applications</p>
        <h1 className="page-title">Everything installed</h1>
        <p className="page-subtitle">
          Home is a launcher, not a replacement — each card opens that application's own interface.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section">
        {apps === null ? (
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</p>
        ) : (
          <div className="app-grid">
            {apps.map((app) => (
              <AppCard
                key={app.slug}
                app={app}
                adminControls={
                  isAdmin && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(app)}>
                        {app.enabled ? "Disable" : "Enable"}
                      </button>
                      {app.slug !== "homecloud" && (
                        <button className="btn btn-danger-ghost" onClick={() => handleRemove(app)}>
                          Remove
                        </button>
                      )}
                    </div>
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="section">
          <h2 className="section-heading">Register an application</h2>
          <div className="panel">
            <p className="panel-desc">
              Manually register an application in HomeCore's registry. Full self-registration via an application
              manifest (§8) is future work — for now this is how a new application shows up in Home.
            </p>
            <form onSubmit={handleRegister}>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="slug">Slug</label>
                  <input
                    id="slug"
                    placeholder="homemedia"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    placeholder="HomeMedia"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="description">Description</label>
                  <input
                    id="description"
                    placeholder="Photo and video library"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "Registering…" : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
