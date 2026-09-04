import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In local dev (npm run dev, no Docker), proxy API calls to the right
// backend so you don't need CORS headaches. In the Docker Compose setup,
// nginx handles this proxying instead (see this app's own nginx.conf).
// Two targets, matching production's nginx routing exactly: this app's
// own file/folder/share routes go to apps/homecloud-backend (4500),
// everything else (auth, admin, activity) goes to HomeCore (4000). The
// more specific keys must be registered first — a broader /api prefix
// would otherwise swallow them.
export default defineConfig({
  base: "/cloud/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/homecloud": {
        target: "http://localhost:4500",
        changeOrigin: true
      },
      "/api/share": {
        target: "http://localhost:4500",
        changeOrigin: true
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
