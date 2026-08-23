import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Settings from "./pages/Settings.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    async function checkSession() {
      if (!getToken()) {
        setCheckingSession(false);
        return;
      }
      try {
        const { data } = await api.me();
        setUser({ id: data.id, username: data.username, role: data.role });
      } catch {
        // token invalid/expired; user stays logged out
      } finally {
        setCheckingSession(false);
      }
    }
    checkSession();
  }, []);

  useEffect(() => {
    // Fires whenever any API call comes back 401 (natural expiry, "sign out
    // everywhere" from another device, or an admin disabling the account).
    // Clearing user here sends the app straight back to /login via the
    // route guards below, instead of leaving stale screens up with every
    // further request quietly failing.
    function handleSessionExpired() {
      setUser(null);
    }
    window.addEventListener("homecloud:session-expired", handleSessionExpired);
    return () => window.removeEventListener("homecloud:session-expired", handleSessionExpired);
  }, []);

  if (checkingSession) {
    return null; // avoid a flash of the login screen while verifying the token
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login onAuthed={setUser} />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <Register onAuthed={setUser} />}
      />
      <Route
        path="/"
        element={
          user ? (
            <Dashboard user={user} onLogout={() => setUser(null)} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/settings"
        element={
          user ? (
            <Settings user={user} onLogout={() => setUser(null)} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          user?.role === "admin" ? (
            <Admin user={user} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
