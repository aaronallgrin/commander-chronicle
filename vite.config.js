import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
    allowedHosts: true
  },
  preview: {
    host: "0.0.0.0",
    port: 43123,
    allowedHosts: true
  }
});
