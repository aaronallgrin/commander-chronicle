import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths so GitHub Pages can serve the app from /commander-chronicle/.
  base: "./",
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
