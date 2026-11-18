import { Link } from "react-router-dom";
import { homeAccountUrl } from "../accountNavigation.js";
import StorageActivity from "../components/StorageActivity.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import RetroControl from "../components/RetroControl.jsx";

// Keep /cloud/settings as a compatible preferences/activity route.
export default function Settings({ user }) {
  return <div className="dashboard">
    <aside className="sidebar">
      <div className="sidebar-brand"><span>●</span> homecloud</div>
      <div className="sidebar-user">Signed in as<strong>{user?.username}</strong></div>
      <div className="sidebar-spacer" />
      <ThemeToggle />
      <Link className="btn btn-ghost" to="/" style={{ textAlign: "center", textDecoration: "none", marginTop: 8 }}>← Back to files</Link>
    </aside>
    <main className="main">
      <div className="main-header"><h1>Cloud preferences</h1></div>
      <section className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }} aria-labelledby="cloud-account-heading">
        <h2 id="cloud-account-heading" className="auth-title" style={{ fontSize: 16 }}>Your HOME account</h2>
        <p className="auth-subtitle">Manage your profile, password, two-factor authentication and signed-in devices in HOME.</p>
        <a className="btn btn-primary" href={homeAccountUrl}>Open HOME account settings</a>
      </section>
      <section className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }} aria-labelledby="cloud-appearance-heading">
        <h2 id="cloud-appearance-heading" className="auth-title" style={{ fontSize: 16 }}>Appearance</h2>
        <p className="auth-subtitle">Retro intensity: how strongly the 1970s console styling shows.</p>
        <RetroControl />
      </section>
      <section className="auth-card" style={{ maxWidth: 420 }} aria-labelledby="cloud-activity-heading">
        <h2 id="cloud-activity-heading" className="auth-title" style={{ fontSize: 16 }}>Recent storage activity</h2>
        <StorageActivity />
      </section>
    </main>
  </div>;
}
