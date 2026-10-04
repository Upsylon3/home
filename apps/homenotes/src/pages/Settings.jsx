import { useOutletContext } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle.jsx";
import RetroControl from "../components/RetroControl.jsx";

// Deliberately thin: account management is HomeCloud/HomeCore's job, not
// HomeNotes' — same reasoning as HomeMedia's Settings page.
export default function Settings() {
  const { user } = useOutletContext();

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="panel">
        <h3 className="panel-title">Appearance</h3>
        <p className="panel-desc">Light, dark, or match your device's setting automatically.</p>
        <ThemeToggle className="btn btn-ghost btn-sm" />
        <p className="panel-desc" style={{ margin: "20px 0 8px" }}>
          Retro intensity: how strongly the 1970s console styling shows.
        </p>
        <RetroControl />
      </div>

      <div className="panel">
        <h3 className="panel-title">Account</h3>
        <p className="panel-desc">
          Signed in as <strong>{user.username}</strong>. Password, two-factor authentication, and other account
          settings are managed from HomeCloud, not here.
        </p>
      </div>
    </main>
  );
}
