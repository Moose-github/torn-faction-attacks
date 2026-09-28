import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
    for (const key of ["VITE_API_BASE_URL", "VITE_MONITOR_WORKER_URL"]) {
      if (!env[key]) continue;
      const hostname = new URL(env[key]).hostname.toLowerCase();
      if (hostname === "localhost" || hostname.endsWith(".localhost") ||
          hostname.startsWith("127.") || hostname === "[::1]" || hostname === "0.0.0.0") {
        throw new Error(`${key} points to a local development address. Set a public service URL before building the dashboard.`);
      }
    }
  }
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8787",
      },
    },
  };
});
