import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Service-specific proxies match production routing (see nginx.conf):
// Cloud quota, optional Bridge controls and the administrator Vault reset
// go directly to their owning service; other /api calls go to Core. Port 5174, not
// 5173, so Home and HomeCloud's frontend can both run in dev at the same
// time.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api/homevault": { target: "http://localhost:4600", changeOrigin: true },
      "/api/homebridge": { target: "http://localhost:4900", changeOrigin: true },
      "/api/homecloud": {
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
