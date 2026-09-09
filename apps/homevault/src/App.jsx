import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api.js";
import { VaultProvider, useVault } from "./vaultContext.jsx";
import Login from "./pages/Login.jsx";
import Setup from "./pages/Setup.jsx";
import Unlock from "./pages/Unlock.jsx";
import Recover from "./pages/Recover.jsx";
import Vault from "./pages/Vault.jsx";
import ItemDetail from "./pages/ItemDetail.jsx";
import Settings from "./pages/Settings.jsx";
import Layout from "./components/Layout.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  // null = not checked yet, false = no vault, object = vault envelope
  const [vaultRecord, setVaultRecord] = useState(null);
  const [checkingVault, setCheckingVault] = useState(true);

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
    async function checkVault() {
      if (!user) {
        setCheckingVault(false);
        return;
      }
      try {
        const { data } = await api.vault.get();
        setVaultRecord(data.exists ? data.vault : false);
      } catch {
        setVaultRecord(false);
      } finally {
        setCheckingVault(false);
      }
    }
    checkingVault && user && checkVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when `user` itself changes
  }, [user]);

  useEffect(() => {
    function handleSessionExpired() {
      setUser(null);
    }
    window.addEventListener("homevault:session-expired", handleSessionExpired);
    return () => window.removeEventListener("homevault:session-expired", handleSessionExpired);
  }, []);

  if (checkingSession) return null;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onAuthed={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (checkingVault) return null;

  return (
    <VaultProvider>
      <AuthedRoutes user={user} setUser={setUser} vaultRecord={vaultRecord} setVaultRecord={setVaultRecord} />
    </VaultProvider>
  );
}

function AuthedRoutes({ user, setUser, vaultRecord, setVaultRecord }) {
  const { isUnlocked } = useVault();

  // No vault yet at all — the only place to be is Setup, regardless of
  // what URL was requested.
  if (!vaultRecord) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup onCreated={setVaultRecord} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Vault exists but isn't unlocked yet — Unlock (master password) or
  // Recover (recovery key + set a new master password) are the only
  // valid places to be.
  if (!isUnlocked) {
    return (
      <Routes>
        <Route path="/unlock" element={<Unlock vaultRecord={vaultRecord} />} />
        <Route path="/recover" element={<Recover vaultRecord={vaultRecord} onRecovered={setVaultRecord} />} />
        <Route path="*" element={<Navigate to="/unlock" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/unlock" element={<Navigate to="/" replace />} />
      <Route element={<Layout user={user} onLogout={() => setUser(null)} />}>
        <Route path="/" element={<Vault />} />
        <Route path="/items/:itemId" element={<ItemDetail />} />
        <Route path="/settings" element={<Settings vaultRecord={vaultRecord} onVaultUpdated={setVaultRecord} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
