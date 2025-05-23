import { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "./e2e-tests",
  maxFailures: 1,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
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
};

export default config;
