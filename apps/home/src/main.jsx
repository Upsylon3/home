import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
// Fonts are bundled from npm packages (@fontsource) instead of loaded from
// Google's servers: Home must work with no internet, and this way the
// person's browser never phones a third party just to draw a page.
// tokens.css is a COPY of design/tokens.css (see design/sync-assets.sh).
// It must be imported BEFORE index.css so the variables exist by the time
// index.css uses them.
import "./styles/tokens.css";
import "./styles/index.css";

// Unlike apps/homecloud, apps/homemedia, and apps/homenotes, Home is
// served at the domain root ("/", both in gateway/nginx.conf and this
// app's own vite.config.js `base: "/"`), so it needs no `basename` here —
// the browser URL and the app's own routes already agree on where "/" is.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
