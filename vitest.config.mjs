import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Local output/audit files can depend on historical, machine-specific data.
    // Discover application tests explicitly instead of running those artifacts.
    include: [
      "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "shared/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "tests/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "dashboard/src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "workers/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
  },
});
