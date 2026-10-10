// Every network call HomeMonitor makes goes through this file.
//   /api/auth/...         -> HomeCore (login, who am I)
//   /api/homemonitor/...  -> homemonitor-backend (admin only)
// The login token is shared by every Home app (session.js, a synced copy of
// design/session.js).
import { getToken, setToken } from "./session.js";
export { getToken, setToken };

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, { ...options, headers });

  // 401 = not signed in (any more): forget the token and tell App.jsx.
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("homemonitor:session-expired"));
  }

  let data = null;
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    data = await res.json().catch(() => null);
  }
  if (!res.ok) {
    // Keep the HTTP status on the error, so a page can tell "not an admin"
    // (403) apart from "the server is down".
    const err = new Error((data && data.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return { data, res };
}

export const api = {
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  verify2fa: (pendingToken, code) => request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),
  me: () => request("/auth/me"),

  status: () => request("/homemonitor/status"),
  history: (hours = 24) => request(`/homemonitor/history?hours=${hours}`),
  diskGrowth: (days = 90) => request(`/homemonitor/disk-growth?days=${days}`)
};
