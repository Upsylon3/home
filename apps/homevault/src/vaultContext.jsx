// The unlocked vault key lives ONLY here: a React state variable, never
// localStorage/sessionStorage, never sent anywhere. Refreshing the page
// or closing the tab loses it — by design (docs/SECURITY.md's "Standing
// decrypted key in memory" row) — the next visit re-derives it from a
// master password or recovery key, exactly like every other password
// manager's "unlock" step.
//
// Auto-lock is deliberately a SEPARATE, shorter timer from HomeCore's
// own login session (see App.jsx) — staying signed into Home/HomeVault
// at the browser level says nothing about whether the vault itself
// should still be sitting unlocked in memory.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const VaultContext = createContext(null);

const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes idle — see docs/SECURITY.md's HomeVault threat model
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"];

export function VaultProvider({ children }) {
  const [vaultKey, setVaultKey] = useState(null);
  const [vaultMeta, setVaultMeta] = useState(null); // {kdfParams, wrappedKeyRecoveryPresent, ...} — never key material
  const timerRef = useRef(null);

  const lock = useCallback(() => {
    setVaultKey(null);
    setVaultMeta(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(lock, AUTO_LOCK_MS);
  }, [lock]);

  const unlock = useCallback(
    (key, meta) => {
      setVaultKey(key);
      setVaultMeta(meta || null);
      resetTimer();
    },
    [resetTimer]
  );

  useEffect(() => {
    if (!vaultKey) return undefined;
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, resetTimer, { passive: true });
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, resetTimer);
    };
  }, [vaultKey, resetTimer]);

  return (
    <VaultContext.Provider value={{ vaultKey, vaultMeta, unlock, lock, isUnlocked: Boolean(vaultKey) }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within a VaultProvider");
  return ctx;
}
