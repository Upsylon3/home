import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two proxy targets in dev, matching production's nginx routing exactly
// (see nginx.conf): /api/homemedia goes to HomeMedia's own backend,
// everything else under /api goes to HomeCore (identity, auth) — HomeMedia
// has no identity or storage of its own.
// The more specific /api/homemedia key must be registered first — an
// overlapping broader /api prefix would otherwise swallow it.
// Port 5175: 5173 is HomeCloud's frontend, 5174 is Home, so HomeMedia
// can run alongside both in dev.
//
// base is only the gateway's /media/ prefix in production (see
// gateway/nginx.conf) — in dev this app's own Vite server IS the origin
// (http://localhost:5175), so base stays "/" or visiting that URL
// directly would 404.
export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/media/" : "/",
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/api/homemedia": {
        target: "http://localhost:4200",
        changeOrigin: true
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
