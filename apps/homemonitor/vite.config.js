import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server settings for HomeMonitor, the same dual-proxy pattern as HomeTasks:
// this app's own API on one path, HomeCore (login) on everything else. The more
// specific /api/homemonitor key must come first.
//
// Port 5179 (5173 HomeCloud, 5174 Home, 5175 HomeMedia, 5176 HomeNotes,
// 5177 HomeVault, 5178 HomeTasks). "base" is the gateway prefix in production.
export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/monitor/" : "/",
  plugins: [react()],
  server: {
    port: 5179,
    proxy: {
      "/api/homemonitor": { target: "http://localhost:4800", changeOrigin: true },
      "/api": { target: "http://localhost:4000", changeOrigin: true }
    }
  }
});
