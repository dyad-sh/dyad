import { PlaywrightTestConfig } from "@playwright/test";
import os from "os";
import { FAKE_LLM_BASE_PORT } from "./e2e-tests/helpers/test-ports";

export { FAKE_LLM_BASE_PORT };

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const parallelism = parseInt(process.env.PLAYWRIGHT_PARALLELISM || "1", 10);

// Generate webServer configurations for each parallel worker
// Each worker needs its own fake LLM server to avoid test interference
function generateWebServerConfigs(): PlaywrightTestConfig["webServer"] {
  const configs: NonNullable<PlaywrightTestConfig["webServer"]> = [];

  for (let i = 0; i < parallelism; i++) {
    const port = FAKE_LLM_BASE_PORT + i;
    configs.push({
      // All servers run build to avoid race conditions since Playwright
      // starts all webServer entries concurrently
      command: `cd testing/fake-llm-server && pnpm run build && pnpm start -- --port=${port}`,
      url: `http://localhost:${port}/health`,
      // In CI, always start a fresh server; locally, reuse if one is already running
      reuseExistingServer: !process.env.CI,
    });
  }

  return configs;
}

const config: PlaywrightTestConfig = {
  testDir: "./e2e-tests",
  // Enable parallel test execution - E2E test builds skip the singleton lock
  // Read parallelism from env var, default to 1 if not set
  workers: parallelism,
  retries: parseInt(
    process.env.PLAYWRIGHT_RETRIES ?? (process.env.CI ? "2" : "0"),
    10,
  ),
  timeout: process.env.CI ? 180_000 : 75_000,
  // Use a custom snapshot path template because Playwright's default
  // is platform-specific which isn't necessary for Dyad e2e tests
  // which should be platform agnostic (we don't do screenshots; only textual diffs).
  snapshotPathTemplate:
    "{testDir}/{testFileDir}/snapshots/{testFileName}_{arg}{ext}",

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // Why not use GitHub reporter? Because we're using matrix and it's discouraged:
  // https://playwright.dev/docs/test-reporters#github-actions-annotations
  reporter: process.env.CI
    ? [
        [
          "blob",
          {
            // Speculatively fix https://github.com/actions/download-artifact/issues/298#issuecomment-2016075998
            // by using a timestamp in the filename
            outputFile: `./blob-report/report-${os.platform()}-${timestamp}.zip`,
          },
        ],
        ["@flakiness/playwright", { endpoint: "https://flakiness.io" }],
      ]
    : [["html"], ["line"]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* See https://playwright.dev/docs/trace-viewer */
    trace: "retain-on-failure",

    // These options do NOT work for electron playwright.
    // Instead, you need to do a workaround.
    // See https://github.com/microsoft/playwright/issues/8208
    //
    // screenshot: "on",
    // video: "retain-on-failure",
  },

  webServer: generateWebServerConfigs(),
};

export default config;
