import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    onConsoleLog(log, _type) {
      // Suppress known noisy logs while allowing useful debugging output
      const noisyPatterns = [
        // Retry/flakiness logs from test utilities
        /retry.*attempt/i,
        /retrying/i,
        // Settings-related noise during test setup
        /failed to.*settings/i,
        /settings.*error/i,
        // Processor warnings that don't indicate real issues
        /processor.*warning/i,
        // Known test fixture console outputs (not real errors)
        /\[test\]/i,
      ];

      for (const pattern of noisyPatterns) {
        if (pattern.test(log)) {
          return false;
        }
      }
      // Allow all other console output (including errors) for debugging
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
