import { Link } from "react-router-dom";
import { homeAccountUrl } from "../accountNavigation.js";
import StorageActivity from "../components/StorageActivity.jsx";

// Preserve the administrator-only storage audit and /cloud/admin bookmark.
export default function Admin({ user }) {
  return <div className="dashboard">
    <aside className="sidebar">
      <div className="sidebar-brand"><span>●</span> homecloud</div>
      <div className="sidebar-user">Signed in as<strong>{user?.username}</strong></div>
      <div className="sidebar-spacer" />
      <Link className="btn btn-ghost" to="/" style={{ textAlign: "center", textDecoration: "none" }}>← Back to files</Link>
    </aside>
    <main className="main">
      <div className="main-header"><h1>Storage activity</h1></div>
      <section className="auth-card" style={{ maxWidth: 420, marginBottom: 24 }} aria-labelledby="cloud-admin-heading">
        <h2 id="cloud-admin-heading" className="auth-title" style={{ fontSize: 16 }}>Account administration moved to HOME</h2>
        <p className="auth-subtitle">Manage accounts, passwords, roles, two-factor recovery and storage quota policy in HOME. Storage activity remains here.</p>
        <a className="btn btn-primary" href={homeAccountUrl}>Open HOME account administration</a>
      </section>
      <StorageActivity admin />
    </main>
  </div>;
}
