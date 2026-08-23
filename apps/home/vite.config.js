import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same shape as ../frontend/vite.config.js: proxy /api to the shared
// backend in local dev so there's no CORS friction. Port 5174, not 5173,
// so Home and HomeCloud's frontend can both run in dev at the same time.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
