import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same dual-proxy pattern as homemedia/vite.config.js: HomeNotes' own API
// on one path, the shared HomeCloud/HomeCore backend on everything else,
// matching production's nginx routing exactly (see nginx.conf). The more
// specific /api/homenotes key must be registered first.
// Port 5176: 5173 HomeCloud, 5174 Home, 5175 HomeMedia, so HomeNotes can
// run alongside all three in dev.
export default defineConfig({
  base: "/notes/",
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
