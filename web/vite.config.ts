import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies `/api` to the Hono read API (default port 8787).
// Override the target with API_PORT when the API runs elsewhere.
const apiTarget = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
