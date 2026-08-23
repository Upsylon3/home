import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two proxy targets in dev, matching production's nginx routing exactly
// (see nginx.conf): /api/homemedia goes to HomeMedia's own backend,
// everything else under /api goes to the shared HomeCloud/HomeCore
// backend, since HomeMedia has no identity or storage of its own.
// The more specific /api/homemedia key must be registered first — an
// overlapping broader /api prefix would otherwise swallow it.
// Port 5175: 5173 is HomeCloud's frontend, 5174 is Home, so HomeMedia
// can run alongside both in dev.
export default defineConfig({
  base: "/media/",
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
