import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/evals/**/*.eval.ts"],
    globals: true,
    testTimeout: 360_000,
    maxConcurrency: 5,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
