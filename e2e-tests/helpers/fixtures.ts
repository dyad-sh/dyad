/**
 * Playwright test fixtures for e2e tests.
 * Provides Electron app launching and PageObject initialization.
 */

import { test as base } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import { ElectronApplication, _electron as electron } from "playwright";
import os from "os";
import path from "path";
import { execSync } from "child_process";

import { showDebugLogs } from "./constants";
import { PageObject } from "./page-objects";
import { FAKE_LLM_BASE_PORT } from "./test-ports";

export interface ElectronConfig {
  preLaunchHook?: ({
    userDataDir,
    fakeLlmPort,
  }: {
    userDataDir: string;
    fakeLlmPort: number;
  }) => Promise<void>;
  showSetupScreen?: boolean;
}

// From https://github.com/microsoft/playwright/issues/8208#issuecomment-1435475930
//
// Note how we mark the fixture as { auto: true }.
// This way it is always instantiated, even if the test does not use it explicitly.
export const test = base.extend<{
  electronConfig: ElectronConfig;
  attachScreenshotsToReport: void;
  electronApp: ElectronApplication;
  po: PageObject;
}>({
  electronConfig: [
    async ({}, use) => {
      // Default configuration - tests can override this fixture
      await use({});
    },
    { auto: true },
  ],
  po: [
    async ({ electronApp }, use) => {
      const page = await electronApp.firstWindow();

      const po = new PageObject(electronApp, page, {
        userDataDir: (electronApp as any).$coneyUserDataDir,
        fakeLlmPort: (electronApp as any).$fakeLlmPort,
      });
      await use(po);
    },
    { auto: true },
  ],
  attachScreenshotsToReport: [
    async ({ electronApp }, use, testInfo) => {
      await use();

      // After the test we can check whether the test passed or failed.
      if (testInfo.status !== testInfo.expectedStatus) {
        const page = await electronApp.firstWindow();
        try {
          const screenshot = await page.screenshot({ timeout: 5_000 });
          await testInfo.attach("screenshot", {
            body: screenshot,
            contentType: "image/png",
          });
        } catch (error) {
          console.error("Error taking screenshot on failure", error);
        }
      }
    },
    { auto: true },
  ],
  electronApp: [
    async ({ electronConfig }, use, testInfo) => {
      // find the latest build in the out directory
      const latestBuild = eph.findLatestBuild();
      // parse the directory and find paths and other info
      const appInfo = eph.parseElectronApp(latestBuild);

      // Calculate worker-specific port for fake LLM server
      // Each parallel worker gets its own server to avoid test interference
      const fakeLlmPort = FAKE_LLM_BASE_PORT + testInfo.parallelIndex;

      process.env.FAKE_LLM_PORT = String(fakeLlmPort);
      process.env.OLLAMA_HOST = `http://localhost:${fakeLlmPort}/ollama`;
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING = `http://localhost:${fakeLlmPort}/lmstudio`;
      process.env.CONEY_ENGINE_URL = `http://localhost:${fakeLlmPort}/engine/v1`;
      process.env.CONEY_GATEWAY_URL = `http://localhost:${fakeLlmPort}/gateway/v1`;
      process.env.E2E_TEST_BUILD = "true";
      if (!electronConfig.showSetupScreen) {
        // This is just a hack to avoid the AI setup screen.
        process.env.OPENAI_API_KEY = "sk-test";
      }
      const baseTmpDir = os.tmpdir();
      const userDataDir = path.join(baseTmpDir, `coney-e2e-tests-${Date.now()}`);
      if (electronConfig.preLaunchHook) {
        await electronConfig.preLaunchHook({ userDataDir, fakeLlmPort });
      }
      const electronApp = await electron.launch({
        args: [
          appInfo.main,
          "--enable-logging",
          `--user-data-dir=${userDataDir}`,
        ],
        executablePath: appInfo.executable,
        // Strong suspicion this is causing issues on Windows with tests hanging due to error:
        // ffmpeg failed to write: Error [ERR_STREAM_WRITE_AFTER_END]: write after end
        // recordVideo: {
        //   dir: "test-results",
        // },
      });
      (electronApp as any).$coneyUserDataDir = userDataDir;
      (electronApp as any).$fakeLlmPort = fakeLlmPort;

      console.log("electronApp launched!");
      if (showDebugLogs) {
        // Listen to main process output immediately
        electronApp.process().stdout?.on("data", (data) => {
          console.log(`MAIN_PROCESS_STDOUT: ${data.toString()}`);
        });
        electronApp.process().stderr?.on("data", (data) => {
          console.error(`MAIN_PROCESS_STDERR: ${data.toString()}`);
        });
      }
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

      await use(electronApp);
      // Why are we doing a force kill on Windows?
      //
      // Otherwise, Playwright will just hang on the test cleanup
      // because the electron app does NOT ever fully quit due to
      // Windows' strict resource locking (e.g. file locking).
      if (os.platform() === "win32") {
        try {
          const executableName = path.basename(appInfo.executable);
          console.log(`[cleanup:start] Killing ${executableName}`);
          console.time("taskkill");
          execSync(`taskkill /f /t /im ${executableName}`);
          console.timeEnd("taskkill");
          console.log(`[cleanup:end] Killed ${executableName}`);
        } catch (error) {
          console.warn(
            "Failed to kill coney.exe: (continuing with test cleanup)",
            error,
          );
        }
      } else {
        await electronApp.close();
      }
    },
    { auto: true },
  ],
});

/**
 * Creates a test with custom Electron configuration.
 */
export function testWithConfig(config: ElectronConfig) {
  return test.extend({
    electronConfig: async ({}, use) => {
      await use(config);
    },
  });
}

/**
 * Creates a test with custom Electron configuration, but skips on Windows.
 */
export function testWithConfigSkipIfWindows(config: ElectronConfig) {
  if (os.platform() === "win32") {
    return test.skip;
  }
  return test.extend({
    electronConfig: async ({}, use) => {
      await use(config);
    },
  });
}

/**
 * Wrapper that skips tests on Windows platform.
 */
export const testSkipIfWindows = os.platform() === "win32" ? test.skip : test;
