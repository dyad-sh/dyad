/**
 * Example Playwright script for Electron
 * showing/testing various API features
 * in both renderer and main processes
 */

import { expect, test as base } from "@playwright/test";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";
import { ElectronApplication, Page, _electron as electron } from "playwright";

let electronApp: ElectronApplication;

// From https://github.com/microsoft/playwright/issues/8208#issuecomment-1435475930
//
// Note how we mark the fixture as { auto: true }.
// This way it is always instantiated, even if the test does not use it explicitly.
export const test = base.extend<{ attachScreenshotsToReport: void }>({
  attachScreenshotsToReport: [
    async ({}, use, testInfo) => {
      await use();

      // After the test we can check whether the test passed or failed.
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot();
        await testInfo.attach("screenshot", {
          body: screenshot,
          contentType: "image/png",
        });
      }
    },
    { auto: true },
  ],
});

test.beforeAll(async () => {
  // find the latest build in the out directory
  const latestBuild = findLatestBuild();
  // parse the directory and find paths and other info
  const appInfo = parseElectronApp(latestBuild);
  process.env.E2E_TEST_BUILD = "true";
  // This is just a hack to avoid the AI setup screen.
  process.env.OPENAI_API_KEY = "sk-test";
  electronApp = await electron.launch({
    args: [
      appInfo.main,
      "--enable-logging",
      "--user-data-dir=/tmp/dyad-e2e-tests",
    ],
    executablePath: appInfo.executable,
  });

  console.log("electronApp launched!");

  // Listen to main process output immediately
  electronApp.process().stdout?.on("data", (data) => {
    console.log(`MAIN_PROCESS_STDOUT: ${data.toString()}`);
  });
  electronApp.process().stderr?.on("data", (data) => {
    console.error(`MAIN_PROCESS_STDERR: ${data.toString()}`);
  });
  electronApp.on("close", () => {
    console.log(`Electron app closed listener:`);
  });

  electronApp.on("window", async (page) => {
    const filename = page.url()?.split("/").pop();
    console.log(`Window opened: ${filename}`);

    // capture errors
    page.on("pageerror", (error) => {
      console.error(error);
    });
    // capture console messages
    page.on("console", (msg) => {
      console.log(msg.text());
    });
  });
});

test.afterAll(async () => {
  await electronApp.close();
});

let page: Page;

test("renders the first page", async () => {
  page = await electronApp.firstWindow();
  await page.waitForSelector("h1");
  const text = await page.$eval("h1", (el) => el.textContent);
  expect(text).toBe("Build your dream app");
});
