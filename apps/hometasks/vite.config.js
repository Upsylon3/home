import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server settings for HomeTasks, same dual-proxy pattern as HomeNotes:
// this app's own API on one path, HomeCore (login) on everything else. The
// more specific /api/hometasks key must be listed first, or the catch-all
// /api rule would swallow it.
//
// Port 5178: 5173 HomeCloud, 5174 Home, 5175 HomeMedia, 5176 HomeNotes,
// 5177 HomeVault, so every app can run side by side in dev.
//
// "base" is the gateway's /tasks/ prefix, but only in production. In dev this
// app's own Vite server IS the whole origin (http://localhost:5178), so the
// base stays "/" there.
export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/tasks/" : "/",
  plugins: [react()],
  server: {
    port: 5178,
    proxy: {
      "/api/hometasks": { target: "http://localhost:4700", changeOrigin: true },
      "/api": { target: "http://localhost:4000", changeOrigin: true }
    }
  }
});
