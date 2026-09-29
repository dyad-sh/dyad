import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./harness",
  workers: 1,
  retries: 0,
  timeout: 15000,
  use: { headless: true, actionTimeout: 1500 },
  reporter: "list",
});
