import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: {
    host: "0.0.0.0",
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
      },
      "/health": {
        target: "http://127.0.0.1:8787",
      },
      "/ready": {
        target: "http://127.0.0.1:8787",
      },
    },
  },
});
