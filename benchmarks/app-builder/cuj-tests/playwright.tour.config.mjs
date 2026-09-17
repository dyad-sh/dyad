// Demo-recording config for the tour specs ONLY. Separate from the scoring and
// CUJ-video configs so neither changes: tours record their own context (zoom +
// video size from tour-kit), and this config adds browser-level slowMo so
// every click and keystroke is visible at human pace.
//
//   TOUR_SLOWMO   ms of delay per Playwright action (default 250 for demos)
import { defineConfig } from "@playwright/test";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const OUT_DIR = process.env.TOUR_OUT || "tour-out";
const SLOWMO = Number(process.env.TOUR_SLOWMO || "250");

export default defineConfig({
  testDir: "./tours",
  testMatch: ["**/checkpoint-tour-*.spec.ts"],
  workers: 1,
  retries: 0,
  fullyParallel: false,
  // Slow pacing + title cards + 12-13 steps: give it plenty of room.
  timeout: 900_000,
  // Short timeouts: a step that fails should show briefly on camera, not
  // freeze the demo for 20s while a locator times out.
  expect: { timeout: 8_000 },
  outputDir: OUT_DIR,
  reporter: [["line"]],
  use: {
    baseURL: APP_URL,
    headless: true,
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    video: "off",
    launchOptions: { slowMo: SLOWMO },
  },
});
