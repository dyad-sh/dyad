// Video-recording variant of the CUJ config: same suites, same serial
// execution, but every test records a clip so the runs can be watched.
// Used by record-cujs.sh, which stitches the clips into one file per
// (app, model) cell. Slower and larger than the scoring config — never used
// for scoring.
import { defineConfig } from "@playwright/test";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const VIDEO_DIR = process.env.VIDEO_DIR || "videos-out";

export default defineConfig({
  testDir: ".",
  testMatch: ["**/checkpoint-*.spec.ts"],
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: VIDEO_DIR,
  reporter: [["line"]],
  use: {
    baseURL: APP_URL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    video: { mode: "on", size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  },
});
