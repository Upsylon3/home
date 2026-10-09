import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Login from "./pages/Login.jsx";
import Tasks from "./pages/Tasks.jsx";
import Settings from "./pages/Settings.jsx";
import Layout from "./components/Layout.jsx";

// The top of the app decides one thing: are we signed in?
//   no  -> only the sign-in screen exists
//   yes -> the full app (sidebar + pages)
export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // On first load, if a token is saved, ask HomeCore whether it is still valid.
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

  // api.js announces a 401 with this event; we drop back to sign-in.
  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener("hometasks:session-expired", handleExpired);
    return () => window.removeEventListener("hometasks:session-expired", handleExpired);
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
        {/* One page component, five "views" of the same task list. The
            `key` makes React throw away the page and start a fresh one when
            you switch views, so a half-typed search or open rename box
            can't leak from one view into the next. */}
        <Route path="/" element={<Tasks key="today" view="today" />} />
        <Route path="/upcoming" element={<Tasks key="upcoming" view="upcoming" />} />
        <Route path="/all" element={<Tasks key="all" view="all" />} />
        <Route path="/done" element={<Tasks key="done" view="done" />} />
        <Route path="/projects/:projectId" element={<Tasks key="project" view="project" />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
