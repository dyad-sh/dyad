import { test as base, Page, expect } from "@playwright/test";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";
import { ElectronApplication, _electron as electron } from "playwright";
import fs from "fs";

const showDebugLogs = process.env.DEBUG_LOGS === "true";

class PageObject {
  constructor(private page: Page) {}

  async setUp({ autoApprove = false }: { autoApprove?: boolean } = {}) {
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    await this.setUpTestProvider();
    await this.setUpTestModel();

    await this.goToAppsTab();
    await this.selectTestModel();
  }

  async snapshotMessages({
    replaceDumpPath = false,
  }: { replaceDumpPath?: boolean } = {}) {
    if (replaceDumpPath) {
      // Update page so that "[[dyad-dump-path=*]]" is replaced with a placeholder path
      // which is stable across runs.
      await this.page.evaluate(() => {
        const messagesList = document.querySelector(
          "[data-testid=messages-list]",
        );
        if (!messagesList) {
          throw new Error("Messages list not found");
        }
        messagesList.innerHTML = messagesList.innerHTML.replace(
          /\[\[dyad-dump-path=([^\]]+)\]\]/,
          "[[dyad-dump-path=*]]",
        );
      });
    }
    await expect(this.page.getByTestId("messages-list")).toMatchAriaSnapshot();
  }

  async approveProposal() {
    await this.page.getByTestId("approve-proposal-button").click();
  }

  async rejectProposal() {
    await this.page.getByTestId("reject-proposal-button").click();
  }

  getPreviewIframeElement() {
    return this.page.getByTestId("preview-iframe-element");
  }

  async snapshotPreview() {
    const iframe = this.getPreviewIframeElement();
    await expect(iframe.contentFrame().locator("body")).toMatchAriaSnapshot();
  }

  async snapshotServerDump({
    onlyLastMessage = false,
  }: { onlyLastMessage?: boolean } = {}) {
    // Get the text content of the messages list
    const messagesListText = await this.page
      .getByTestId("messages-list")
      .textContent();

    // Find the dump path using regex
    const dumpPathMatch = messagesListText?.match(
      /\[\[dyad-dump-path=([^\]]+)\]\]/,
    );

    if (!dumpPathMatch) {
      throw new Error("No dump path found in messages list");
    }

    const dumpFilePath = dumpPathMatch[1];

    // Read the JSON file
    const dumpContent = fs.readFileSync(dumpFilePath, "utf-8");

    // Perform snapshot comparison
    expect(prettifyDump(dumpContent, { onlyLastMessage })).toMatchSnapshot(
      "server-dump.txt",
    );
  }

  async waitForChatCompletion() {
    await expect(this.getRetryButton()).toBeVisible();
  }

  async clickRetry() {
    await this.getRetryButton().click();
  }

  async clickUndo() {
    await this.getUndoButton().click();
  }

  private getRetryButton() {
    return this.page.getByRole("button", { name: "Retry" });
  }

  private getUndoButton() {
    return this.page.getByRole("button", { name: "Undo" });
  }

  getHomeChatInputContainer() {
    return this.page.getByTestId("home-chat-input-container");
  }

  getChatInputContainer() {
    return this.page.getByTestId("chat-input-container");
  }

  getChatInput() {
    return this.page.getByRole("textbox", { name: "Ask Dyad to build..." });
  }

  async sendPrompt(prompt: string) {
    await this.getChatInput().click();
    await this.getChatInput().fill(prompt);
    await this.page.getByRole("button", { name: "Send message" }).click();
    await this.waitForChatCompletion();
  }

  async selectTestModel() {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText("test-provider").click();
    await this.page.getByText("test-model").click();
  }

  async selectTestOllamaModel() {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText("Local models").click();
    await this.page.getByText("Ollama", { exact: true }).click();
    await this.page.getByText("Testollama", { exact: true }).click();
  }

  async selectTestLMStudioModel() {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText("Local models").click();
    await this.page.getByText("LM Studio", { exact: true }).click();
    // Both of the elements that match "lmstudio-model-1" are the same button, so we just pick the first.
    await this.page
      .getByText("lmstudio-model-1", { exact: true })
      .first()
      .click();
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

  ////////////////////////////////
  // Settings related
  ////////////////////////////////

  async toggleAutoApprove() {
    await this.page.getByRole("switch", { name: "Auto-approve" }).click();
  }

  async goToAppsTab() {
    await this.page.getByRole("link", { name: "Apps" }).click();
  }

  ////////////////////////////////
  // Toast assertions
  ////////////////////////////////

  async expectNoToast() {
    await expect(this.page.locator("[data-sonner-toast]")).toHaveCount(0);
  }

  async waitForToast(
    type?: "success" | "error" | "warning" | "info",
    timeout = 5000,
  ) {
    const selector = type
      ? `[data-sonner-toast][data-type="${type}"]`
      : "[data-sonner-toast]";

    await this.page.waitForSelector(selector, { timeout });
  }

  async waitForToastWithText(text: string, timeout = 5000) {
    await this.page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, {
      timeout,
    });
  }

  async assertToastVisible(type?: "success" | "error" | "warning" | "info") {
    const selector = type
      ? `[data-sonner-toast][data-type="${type}"]`
      : "[data-sonner-toast]";

    await expect(this.page.locator(selector)).toBeVisible();
  }

  async assertToastWithText(text: string) {
    await expect(
      this.page.locator(`[data-sonner-toast]:has-text("${text}")`),
    ).toBeVisible();
  }

  async dismissAllToasts() {
    // Click all close buttons if they exist
    const closeButtons = this.page.locator(
      "[data-sonner-toast] button[data-close-button]",
    );
    const count = await closeButtons.count();
    for (let i = 0; i < count; i++) {
      await closeButtons.nth(i).click();
    }
  }

  async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
    async ({ electronApp }, use, testInfo) => {
      await use();

      // After the test we can check whether the test passed or failed.
      if (testInfo.status !== testInfo.expectedStatus) {
        const page = await electronApp.firstWindow();
        const screenshot = await page.screenshot();
        await testInfo.attach("screenshot", {
          body: screenshot,
          contentType: "image/png",
        });
      }
    },
    { auto: true },
  ],
  electronApp: [
    async ({}, use) => {
      // find the latest build in the out directory
      const latestBuild = findLatestBuild();
      // parse the directory and find paths and other info
      const appInfo = parseElectronApp(latestBuild);
      process.env.OLLAMA_HOST = "http://localhost:3500/ollama";
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING =
        "http://localhost:3500/lmstudio";
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
        recordVideo: {
          dir: "test-results",
        },
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
    { auto: true },
  ],
});

function prettifyDump(
  dumpContent: string,
  { onlyLastMessage = false }: { onlyLastMessage?: boolean } = {},
) {
  const parsedDump = JSON.parse(dumpContent) as Array<{
    role: string;
    content: string;
  }>;

  const messages = onlyLastMessage ? parsedDump.slice(-1) : parsedDump;

  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? JSON.stringify(message.content)
        : message.content
            // We remove package.json because it's flaky.
            // Depending on whether pnpm install is run, it will be modified,
            // and the contents and timestamp (thus affecting order) will be affected.
            .replace(
              /\n<dyad-file path="package\.json">[\s\S]*?<\/dyad-file>\n/g,
              "",
            );
      return `===\nrole: ${message.role}\nmessage: ${content}`;
    })
    .join("\n\n");
}
