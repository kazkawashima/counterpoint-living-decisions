import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.E2E_API_PORT ?? "8787";
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  preview: {
    host: "0.0.0.0",
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiTarget,
      },
      "/health": {
        target: apiTarget,
      },
      "/ready": {
        target: apiTarget,
      },
    },
  },
});
