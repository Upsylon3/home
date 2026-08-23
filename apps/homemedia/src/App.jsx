import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import Login from "./pages/Login.jsx";
import Library from "./pages/Library.jsx";
import Favorites from "./pages/Favorites.jsx";
import Albums from "./pages/Albums.jsx";
import AlbumDetail from "./pages/AlbumDetail.jsx";
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
        setUser(data);
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
    window.addEventListener("homemedia:session-expired", handleSessionExpired);
    return () => window.removeEventListener("homemedia:session-expired", handleSessionExpired);
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
        <Route path="/" element={<Library />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/albums" element={<Albums />} />
        <Route path="/albums/:albumId" element={<AlbumDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
