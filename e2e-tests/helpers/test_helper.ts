import { test as base, Page, expect } from "@playwright/test";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";
import { ElectronApplication, _electron as electron } from "playwright";

const showDebugLogs = process.env.DEBUG_LOGS === "true";

class PageObject {
  constructor(private page: Page) {}

  async setUp() {
    await this.goToSettingsTab();
    await this.setUpTestProvider();
    await this.setUpTestModel();
    await this.goToAppsTab();
    await this.selectTestModel();
  }

  async dumpMessages() {
    await expect(this.page.getByTestId("messages-list")).toMatchAriaSnapshot();
  }

  async waitForChatCompletion() {
    await expect(
      this.page.getByRole("button", { name: "Retry" }),
    ).toBeVisible();
  }

  async sendPrompt(prompt: string) {
    await this.page
      .getByRole("textbox", { name: "Ask Dyad to build..." })
      .click();
    await this.page
      .getByRole("textbox", { name: "Ask Dyad to build..." })
      .fill(prompt);
    await this.page.getByRole("button", { name: "Start new chat" }).click();
    await this.waitForChatCompletion();
  }

  async selectTestModel() {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText("test-provider").click();
    await this.page.getByText("test-model").click();
  }

  async setUpTestProvider() {
    await this.page.getByText("Add custom providerConnect to").click();
    // Fill out provider dialog
    await this.page
      .getByRole("textbox", { name: "Provider ID" })
      .fill("testing");
    await this.page.getByRole("textbox", { name: "Display Name" }).click();
    await this.page
      .getByRole("textbox", { name: "Display Name" })
      .fill("test-provider");
    await this.page.getByText("API Base URLThe base URL for").click();
    await this.page
      .getByRole("textbox", { name: "API Base URL" })
      .fill("http://localhost:3500/v1");
    await this.page.getByRole("button", { name: "Add Provider" }).click();
  }

  async setUpTestModel() {
    await this.page
      .getByRole("heading", { name: "test-provider Needs Setup" })
      .click();
    await this.page.getByRole("button", { name: "Add Custom Model" }).click();
    await this.page
      .getByRole("textbox", { name: "Model ID*" })
      .fill("test-model");
    await this.page.getByRole("textbox", { name: "Model ID*" }).press("Tab");
    await this.page.getByRole("textbox", { name: "Name*" }).fill("test-model");
    await this.page.getByRole("button", { name: "Add Model" }).click();
  }

  async goToSettingsTab() {
    await this.page.getByRole("link", { name: "Settings" }).click();
  }

  async goToAppsTab() {
    await this.page.getByRole("link", { name: "Apps" }).click();
  }
}

// From https://github.com/microsoft/playwright/issues/8208#issuecomment-1435475930
//
// Note how we mark the fixture as { auto: true }.
// This way it is always instantiated, even if the test does not use it explicitly.
export const test = base.extend<{
  attachScreenshotsToReport: void;
  electronApp: ElectronApplication;
  po: PageObject;
}>({
  po: [
    async ({ electronApp }, use) => {
      const page = await electronApp.firstWindow();

      const po = new PageObject(page);
      await use(po);
    },
    { auto: true },
  ],
  attachScreenshotsToReport: [
    async ({ page }, use, testInfo) => {
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
  electronApp: async ({}, use) => {
    // find the latest build in the out directory
    const latestBuild = findLatestBuild();
    // parse the directory and find paths and other info
    const appInfo = parseElectronApp(latestBuild);
    process.env.E2E_TEST_BUILD = "true";
    // This is just a hack to avoid the AI setup screen.
    process.env.OPENAI_API_KEY = "sk-test";
    const electronApp = await electron.launch({
      args: [
        appInfo.main,
        "--enable-logging",
        `--user-data-dir=/tmp/dyad-e2e-tests-${Date.now()}`,
      ],
      executablePath: appInfo.executable,
    });

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
    await electronApp.close();
  },
});
