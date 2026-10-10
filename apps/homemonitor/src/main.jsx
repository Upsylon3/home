import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
// Fonts are bundled from npm (@fontsource), not loaded from Google: Home must
// work with no internet, and a page should never phone a third party just to
// draw itself.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
// Load order matters:
//   1. tokens.css     defines the colors/fonts (a synced copy of design/tokens.css)
//   2. index.css      this app's own styles, which use those tokens
//   3. components.css shared buttons/checkboxes; last, so it wins ties
import "./styles/tokens.css";
import "./styles/index.css";
import "./styles/components.css";

// The app lives under /monitor/ behind the gateway. `basename` tells React
// Router to treat "/monitor" as its root, so a route written as "/settings"
// matches the browser address "/monitor/settings". BASE_URL comes from the
// same `base` setting in vite.config.js, so the two can never disagree.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
