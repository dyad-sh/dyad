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
import treeKill from "tree-kill";

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
  postLaunchHook?: () => Promise<void>;
  showSetupScreen?: boolean;
  showPnpmMinimumReleaseAgeWarning?: boolean;
}

// Some Electron states emit the Playwright close event but leave
// electronApp.close() pending until the worker timeout. Terminating the process
// tree keeps teardown bounded and also cleans up preview dev-server children.
async function terminateElectronApp(electronApp: ElectronApplication) {
  const childProcess = electronApp.process();
  const pid = childProcess.pid;
  console.log(
    `[cleanup:start] Terminating Electron app${pid ? ` ${pid}` : ""}`,
  );

  if (!pid || childProcess.exitCode !== null || childProcess.signalCode) {
    console.log("[cleanup:end] Electron app already exited");
    return;
  }

  let closed = false;
  const waitForClose = new Promise<void>((resolve) => {
    const done = () => {
      closed = true;
      resolve();
    };
    electronApp.once("close", done);
    childProcess.once("exit", done);
  });

  await new Promise<void>((resolve) => {
    treeKill(pid, "SIGTERM", (error) => {
      if (error) {
        console.warn(`tree-kill SIGTERM error for Electron PID ${pid}:`, error);
      }
      resolve();
    });
  });

  await Promise.race([
    waitForClose,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5_000);
    }),
  ]);

  if (!closed) {
    console.warn(
      `[cleanup:timeout] Electron app did not exit after SIGTERM; killing process tree ${pid}`,
    );
    await new Promise<void>((resolve) => {
      treeKill(pid, "SIGKILL", (error) => {
        if (error) {
          console.warn(
            `tree-kill SIGKILL error for Electron PID ${pid}:`,
            error,
          );
        }
        resolve();
      });
    });

    await Promise.race([
      waitForClose,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]);
  }

  console.log("[cleanup:end] Electron app terminated");
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
    async ({ electronApp, electronConfig }, use, testInfo) => {
      const page = await electronApp.firstWindow();

      const po = new PageObject(electronApp, page, {
        userDataDir: (electronApp as any).$dyadUserDataDir,
        fakeLlmPort: (electronApp as any).$fakeLlmPort,
        testInfo,
      });
      if (electronConfig.showPnpmMinimumReleaseAgeWarning) {
        await page.evaluate(async () => {
          await (window as any).electron.ipcRenderer.invoke(
            "set-user-settings",
            {
              enablePnpmMinimumReleaseAgeWarning: true,
              hidePnpmMinimumReleaseAgeWarning: false,
            },
          );
        });
      } else {
        await page.evaluate(async () => {
          await (window as any).electron.ipcRenderer.invoke(
            "set-user-settings",
            {
              enablePnpmMinimumReleaseAgeWarning: false,
              hidePnpmMinimumReleaseAgeWarning: true,
            },
          );
        });
      }
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
      process.env.DYAD_ENGINE_URL = `http://localhost:${fakeLlmPort}/engine/v1`;
      process.env.DYAD_GATEWAY_URL = `http://localhost:${fakeLlmPort}/gateway/v1`;
      process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL = `http://localhost:${fakeLlmPort}/api/default-approve-builds.txt`;
      process.env.DYAD_TEST_PNPM_VERSION = "11.1.2";
      process.env.E2E_TEST_BUILD = "true";
      if (!electronConfig.showSetupScreen) {
        // This is just a hack to avoid the AI setup screen.
        process.env.OPENAI_API_KEY = "sk-test";
      } else {
        delete process.env.OPENAI_API_KEY;
      }
      const baseTmpDir = os.tmpdir();
      const userDataDir = path.join(baseTmpDir, `dyad-e2e-tests-${Date.now()}`);
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
      (electronApp as any).$dyadUserDataDir = userDataDir;
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
      if (electronConfig.postLaunchHook) {
        await electronConfig.postLaunchHook();
      }
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
            "Failed to kill dyad.exe: (continuing with test cleanup)",
            error,
          );
        }
      } else {
        await terminateElectronApp(electronApp);
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
