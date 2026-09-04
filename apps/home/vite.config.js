import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two proxy targets in dev, matching production's nginx routing exactly
// (see this app's own nginx.conf): /api/homecloud goes to
// apps/homecloud-backend (Home's dashboard quota widget calls it
// directly), everything else under /api goes to HomeCore. Port 5174, not
// 5173, so Home and HomeCloud's frontend can both run in dev at the same
// time.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
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
