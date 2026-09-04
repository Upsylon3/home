import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
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
