import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/index.css";

// This app is served under the /notes/ path prefix (see gateway/nginx.conf
// and this app's own vite.config.js `base: "/notes/"`), not at the domain
// root. `basename` tells React Router to treat "/notes" as the app's own
// root, so a route defined as path="/trash" correctly matches the browser
// URL "/notes/trash" instead of matching nothing and falling through to
// the catch-all redirect. Without this, refreshing the page, opening a
// bookmark, or following a direct link to anything other than exactly
// "/notes/" bounces the user out to Home.
//
// `import.meta.env.BASE_URL` is set by Vite from that same `base` config
// value, so the two can never drift out of sync with each other.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
