import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Login from "./pages/Login.jsx";
import Overview from "./pages/Overview.jsx";
import Settings from "./pages/Settings.jsx";
import Layout from "./components/Layout.jsx";

// The top of the app decides one thing: are we signed in?
//   no  -> only the sign-in screen exists
//   yes -> the full app (sidebar + pages)
// Whether you are an ADMIN is decided by the server on every request; the
// Overview page shows a friendly message if it answers "403".
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
        setUser(data);
      } catch {
        // Invalid or expired token: stay signed out.
      } finally {
        setCheckingSession(false);
      }
    }
    checkSession();
  }, []);

  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener("homemonitor:session-expired", handleExpired);
    return () => window.removeEventListener("homemonitor:session-expired", handleExpired);
  }, []);

  if (checkingSession) return null; // avoid flashing the sign-in screen

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
        <Route path="/" element={<Overview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
