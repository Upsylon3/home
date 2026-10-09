// Every network call HomeTasks makes goes through this file.
//
// Two services answer behind one address (the gateway routes by path):
//   /api/auth/...      -> HomeCore      (login, who am I)
//   /api/hometasks/... -> hometasks-backend (our tasks and projects)
// The browser never needs to know that; it just calls relative URLs.
//
// The login token is shared by every Home app (see session.js, a synced copy
// of design/session.js). Re-exported so other files can import it from here.
import { getToken, setToken } from "./session.js";
export { getToken, setToken };

// Sends one request and returns { data, res }. Throws an Error with a
// readable message when the server says no (so pages can show it).
async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, { ...options, headers });

  // 401 = "not logged in (any more)". Forget the token and tell App.jsx,
  // which then shows the sign-in screen.
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("hometasks:session-expired"));
  }

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status}).`);
  }
  return { data, res };
}

// { a: 1, b: "", c: undefined } -> "?a=1": builds a query string and leaves
// out empty values.
function qs(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const text = new URLSearchParams(clean).toString();
  return text ? `?${text}` : "";
}

const json = (body) => JSON.stringify(body);

export const api = {
  login: (username, password) => request("/auth/login", { method: "POST", body: json({ username, password }) }),
  verify2fa: (pendingToken, code) => request("/auth/2fa/verify", { method: "POST", body: json({ pendingToken, code }) }),
  me: () => request("/auth/me"),

  summary: (today) => request(`/hometasks/summary${qs({ today })}`),

  projects: {
    list: () => request("/hometasks/projects"),
    create: (name) => request("/hometasks/projects", { method: "POST", body: json({ name }) }),
    rename: (id, name) => request(`/hometasks/projects/${id}`, { method: "PATCH", body: json({ name }) }),
    remove: (id) => request(`/hometasks/projects/${id}`, { method: "DELETE" })
  },

  tasks: {
    // params: { status, projectId, due, today, search }
    list: (params) => request(`/hometasks/tasks${qs(params)}`),
    create: (body) => request("/hometasks/tasks", { method: "POST", body: json(body) }),
    update: (id, body) => request(`/hometasks/tasks/${id}`, { method: "PATCH", body: json(body) }),
    // `today` lets the server put a repeating task's NEXT copy after the
    // person's own today (it never guesses a time zone).
    complete: (id, today) => request(`/hometasks/tasks/${id}/complete${qs({ today })}`, { method: "POST" }),
    reopen: (id) => request(`/hometasks/tasks/${id}/reopen`, { method: "POST" }),
    remove: (id) => request(`/hometasks/tasks/${id}`, { method: "DELETE" })
  }
};
