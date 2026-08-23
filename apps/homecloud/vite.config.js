import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In local dev (npm run dev, no Docker), proxy API calls to the backend
// so you don't need CORS headaches. In the Docker Compose setup, nginx
// handles this proxying instead (see frontend/nginx.conf).
export default defineConfig({
  base: "/cloud/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
