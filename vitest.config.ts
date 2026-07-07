import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const noisyConsolePatterns = [
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

const hybridIntegrationTests = [
  "src/ipc/handlers/__tests__/*.integration.test.ts",
  "src/testing/hybrid_chat_harness.*.integration.test.tsx",
];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    onConsoleLog(log, _type) {
      // Suppress known noisy logs while allowing useful debugging output
      for (const pattern of noisyConsolePatterns) {
        if (pattern.test(log)) {
          return false;
        }
      }
      // Allow all other console output (including errors) for debugging
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...hybridIntegrationTests],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "happy-dom",
          environmentOptions: {
            happyDOM: {
              settings: {
                fetch: {
                  disableSameOriginPolicy: true,
                },
              },
            },
          },
          include: hybridIntegrationTests,
          setupFiles: ["src/testing/hybrid.setup.ts"],
          pool: "forks",
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "pg-schema-classifier": resolve(
        __dirname,
        "./packages/pg-schema-classifier/src/index.ts",
      ),
      "ts-pg-schema-diff": resolve(
        __dirname,
        "./packages/ts-pg-schema-diff/src/index.ts",
      ),
    },
  },
});
