import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Apps from "./pages/Apps.jsx";
import Settings from "./pages/Settings.jsx";
import Layout from "./components/Layout.jsx";

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
        setUser(data.user);
      } catch {
        // token invalid/expired; user stays logged out
      } finally {
        setCheckingSession(false);
      }
    }
    checkSession();
  }, []);

  useEffect(() => {
    function handleSessionExpired() {
      setUser(null);
    }
    window.addEventListener("home:session-expired", handleSessionExpired);
    return () => window.removeEventListener("home:session-expired", handleSessionExpired);
  }, []);

  if (checkingSession) {
    return null;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onAuthed={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout user={user} onLogout={() => setUser(null)} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/apps" element={<Apps />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
