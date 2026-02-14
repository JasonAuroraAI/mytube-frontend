import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
    "/auth": "http://localhost:3001",
    "/api": "http://localhost:3001",
    "/videos": "http://localhost:3001",
    "/categories": "http://localhost:3001",
    "/thumbs": "http://localhost:3001",
    },
  },
});
