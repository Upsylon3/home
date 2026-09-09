import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two proxy targets in dev, matching production's nginx routing exactly
// (see nginx.conf): /api/homevault goes to HomeVault's own backend,
// everything else under /api goes to HomeCore (identity, auth) —
// HomeVault has no identity of its own, and — unlike every sibling app
// — no dependency on apps/homecloud-backend either.
// The more specific /api/homevault key must be registered first — an
// overlapping broader /api prefix would otherwise swallow it.
// Port 5177: 5173 HomeCloud, 5174 Home, 5175 HomeMedia, 5176 HomeNotes,
// so HomeVault can run alongside all four in dev.
//
// base is only the gateway's /vault/ prefix in production — in dev this
// app's own Vite server IS the origin (http://localhost:5177), so base
// stays "/" or visiting that URL directly would 404.
export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/vault/" : "/",
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      "/api/homevault": {
        target: "http://localhost:4600",
        changeOrigin: true
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
