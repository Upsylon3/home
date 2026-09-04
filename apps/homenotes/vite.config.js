import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same dual-proxy pattern as homemedia/vite.config.js: HomeNotes' own API
// on one path, HomeCore on everything else (identity, auth) — matching
// production's nginx routing exactly (see nginx.conf). The more specific
// /api/homenotes key must be registered first.
// Port 5176: 5173 HomeCloud, 5174 Home, 5175 HomeMedia, so HomeNotes can
// run alongside all three in dev.
//
// base is only the gateway's /notes/ prefix in production — in dev this
// app's own Vite server IS the origin (http://localhost:5176), so base
// stays "/" or visiting that URL directly would 404.
export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/notes/" : "/",
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      "/api/homenotes": {
        target: "http://localhost:4400",
        changeOrigin: true
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
