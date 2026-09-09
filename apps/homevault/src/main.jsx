import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/index.css";

// This app is served under the /vault/ path prefix (see gateway/nginx.conf
// and this app's own vite.config.js `base: "/vault/"`), not at the domain
// root. `basename` tells React Router to treat "/vault" as the app's own
// root — see apps/homenotes/src/main.jsx's identical comment for the
// full explanation of why this matters.
//
// base is only the gateway's /vault/ prefix in production — in dev this
// app's own Vite server IS the origin, so base stays "/" there.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
