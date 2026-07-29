// Playwright config for the app-builder CUJ suites.
// One directory per app (relay-crm/, deskhero/, portalis/); point --grep or a
// file arg at the checkpoint spec you want. Scoring is data, not CI: retries 0,
// workers 1 (suites are serial by design), JSON reporter for the scorer.
import { defineConfig } from "@playwright/test";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const CUJ_RESULTS = process.env.CUJ_RESULTS || `results/cuj-${Date.now()}.json`;

export default defineConfig({
  testDir: ".",
  testMatch: ["**/checkpoint-*.spec.ts"],
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: CUJ_RESULTS }]],
  use: {
    baseURL: APP_URL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
});
