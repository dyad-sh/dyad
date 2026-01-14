import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Include test files from src/__tests__
    include: ["src/**/*.test.ts"],
    // Exclude node_modules and dist
    exclude: ["node_modules", "dist"],
    // Use globals for describe, it, expect, etc.
    globals: true,
    // Environment for tests
    environment: "node",
    // Timeout for tests (longer for model loading tests)
    testTimeout: 30000,
    // Coverage configuration (optional)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
