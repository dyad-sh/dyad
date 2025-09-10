import { test as base, Page, expect } from "@playwright/test";
import * as eph from "electron-playwright-helpers";
import { ElectronApplication, _electron as electron } from "playwright";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { generateAppFilesSnapshotData } from "./generateAppFilesSnapshotData";
import {
  BUILD_SYSTEM_POSTFIX,
  BUILD_SYSTEM_PREFIX,
} from "@/prompts/system_prompt";

const showDebugLogs = process.env.DEBUG_LOGS === "true";

export const Timeout = {
  // Things generally take longer on CI, so we make them longer.
  EXTRA_LONG: process.env.CI ? 120_000 : 60_000,
  LONG: process.env.CI ? 60_000 : 30_000,
  MEDIUM: process.env.CI ? 30_000 : 15_000,
};

export class ContextFilesPickerDialog {
  constructor(
    public page: Page,
    public close: () => Promise<void>,
  ) {}

  async addManualContextFile(path: string) {
    await this.page.getByTestId("manual-context-files-input").fill(path);
    await this.page.getByTestId("manual-context-files-add-button").click();
  }

  async addAutoIncludeContextFile(path: string) {
    await this.page.getByTestId("auto-include-context-files-input").fill(path);
    await this.page
      .getByTestId("auto-include-context-files-add-button")
      .click();
  }

  async removeManualContextFile() {
    await this.page
      .getByTestId("manual-context-files-remove-button")
      .first()
      .click();
  }

  async removeAutoIncludeContextFile() {
    await this.page
      .getByTestId("auto-include-context-files-remove-button")
      .first()
      .click();
  }

  async addExcludeContextFile(path: string) {
    await this.page.getByTestId("exclude-context-files-input").fill(path);
    await this.page.getByTestId("exclude-context-files-add-button").click();
  }

  async removeExcludeContextFile() {
    await this.page
      .getByTestId("exclude-context-files-remove-button")
      .first()
      .click();
  }
}

class ProModesDialog {
  constructor(
    public page: Page,
    public close: () => Promise<void>,
  ) {}

  async setSmartContextMode(mode: "balanced" | "off" | "conservative") {
    await this.page
      .getByRole("button", {
        name: mode.charAt(0).toUpperCase() + mode.slice(1),
      })
      .click();
  }

  async toggleTurboEdits() {
    await this.page.getByRole("switch", { name: "Turbo Edits" }).click();
  }
}

class GitHubConnector {
  constructor(public page: Page) {}

  async connect() {
    await this.page.getByRole("button", { name: "Connect to GitHub" }).click();
  }

  getSetupYourGitHubRepoButton() {
    return this.page.getByText("Set up your GitHub repo");
  }

  getCreateNewRepoModeButton() {
    return this.page.getByRole("button", { name: "Create new repo" });
  }

  getConnectToExistingRepoModeButton() {
    return this.page.getByRole("button", { name: "Connect to existing repo" });
  }

  async clickCreateRepoButton() {
    await this.page.getByRole("button", { name: "Create Repo" }).click();
  }

  async fillCreateRepoName(name: string) {
    await this.page.getByTestId("github-create-repo-name-input").fill(name);
  }

  async fillNewRepoBranchName(name: string) {
    await this.page.getByTestId("github-new-repo-branch-input").fill(name);
  }

  async selectRepo(repo: string) {
    await this.page.getByTestId("github-repo-select").click();
    await this.page.getByRole("option", { name: repo }).click();
  }

  async selectBranch(branch: string) {
    await this.page.getByTestId("github-branch-select").click();
    await this.page.getByRole("option", { name: branch }).click();
  }

  async selectCustomBranch(branch: string) {
    await this.page.getByTestId("github-branch-select").click();
    await this.page
      .getByRole("option", { name: "✏️ Type custom branch name" })
      .click();
    await this.page.getByTestId("github-custom-branch-input").click();
    await this.page.getByTestId("github-custom-branch-input").fill(branch);
  }

  async clickConnectToRepoButton() {
    await this.page.getByRole("button", { name: "Connect to repo" }).click();
  }

  async snapshotConnectedRepo() {
    await expect(
      this.page.getByTestId("github-connected-repo"),
    ).toMatchAriaSnapshot();
  }

  async snapshotSetupRepo() {
    await expect(
      this.page.getByTestId("github-setup-repo"),
    ).toMatchAriaSnapshot();
  }

  async snapshotUnconnectedRepo() {
    await expect(
      this.page.getByTestId("github-unconnected-repo"),
    ).toMatchAriaSnapshot();
  }

  async clickSyncToGithubButton() {
    await this.page.getByRole("button", { name: "Sync to GitHub" }).click();
  }

  async clickDisconnectRepoButton() {
    await this.page
      .getByRole("button", { name: "Disconnect from repo" })
      .click();
  }

  async clearPushEvents() {
    const response = await this.page.request.post(
      "http://localhost:3500/github/api/test/clear-push-events",
    );
    return await response.json();
  }

  async getPushEvents(repo?: string) {
    const url = repo
      ? `http://localhost:3500/github/api/test/push-events?repo=${repo}`
      : "http://localhost:3500/github/api/test/push-events";
    const response = await this.page.request.get(url);
    return await response.json();
  }

  async verifyPushEvent(expectedEvent: {
    repo: string;
    branch: string;
    operation?: "push" | "create" | "delete";
  }) {
    const pushEvents = await this.getPushEvents(expectedEvent.repo);
    const matchingEvent = pushEvents.find(
      (event: any) =>
        event.repo === expectedEvent.repo &&
        event.branch === expectedEvent.branch &&
        (!expectedEvent.operation ||
          event.operation === expectedEvent.operation),
    );

    if (!matchingEvent) {
      throw new Error(
        `Expected push event not found. Expected: ${JSON.stringify(expectedEvent)}. ` +
          `Actual events: ${JSON.stringify(pushEvents)}`,
      );
    }

    return matchingEvent;
  }
}

export class PageObject {
  public userDataDir: string;
  public githubConnector: GitHubConnector;
  constructor(
    public electronApp: ElectronApplication,
    public page: Page,
    { userDataDir }: { userDataDir: string },
  ) {
    this.userDataDir = userDataDir;
    this.githubConnector = new GitHubConnector(this.page);
  }

  private async baseSetup() {
    await this.githubConnector.clearPushEvents();
  }

  async setUp({
    autoApprove = false,
    nativeGit = false,
    enableAutoFixProblems = false,
  }: {
    autoApprove?: boolean;
    nativeGit?: boolean;
    enableAutoFixProblems?: boolean;
  } = {}) {
    await this.baseSetup();
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    if (nativeGit) {
      await this.toggleNativeGit();
    }
    if (enableAutoFixProblems) {
      await this.toggleAutoFixProblems();
    }
    await this.setUpTestProvider();
    await this.setUpTestModel();

    await this.goToAppsTab();
    await this.selectTestModel();
  }

  async setUpDyadPro({ autoApprove = false }: { autoApprove?: boolean } = {}) {
    await this.baseSetup();
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    await this.setUpDyadProvider();
    await this.goToAppsTab();
  }

  async ensurePnpmInstall() {
    const appPath = await this.getCurrentAppPath();
    if (!appPath) {
      throw new Error("No app selected");
    }

    const maxDurationMs = 180_000; // 3 minutes
    const retryIntervalMs = 15_000;
    const startTime = Date.now();
    let lastOutput = "";

    const checkCommand = `node -e 'const pkg=require("./package.json");const{execSync}=require("child_process");try{const prodResult=JSON.parse(execSync("pnpm list --json --depth=0",{encoding:"utf8"}));const devResult=JSON.parse(execSync("pnpm list --json --depth=0 --dev",{encoding:"utf8"}));const installed={...(prodResult[0]||{}).dependencies||{},...(devResult[0]||{}).devDependencies||{}};const expected=Object.keys({...pkg.dependencies||{},...pkg.devDependencies||{}});const missing=expected.filter(dep=>!installed[dep]);console.log(missing.length?"MISSING: "+missing.join(", "):"All dependencies installed")}catch(e){console.log("Error:",e.message)}'`;

    while (Date.now() - startTime < maxDurationMs) {
      try {
        console.log(`Checking installed dependencies in ${appPath}...`);
        const stdout = execSync(checkCommand, {
          cwd: appPath,
          stdio: "pipe",
          encoding: "utf8",
        });
        lastOutput = (stdout || "").toString().trim();
        console.log(`Dependency check output: ${lastOutput}`);
        if (lastOutput.includes("All dependencies installed")) {
          return;
        }
      } catch (error: any) {
        // Capture any error output to include in the final error if we time out
        const stdOut = error?.stdout ? error.stdout.toString() : "";
        const stdErr = error?.stderr ? error.stderr.toString() : "";
        lastOutput = [stdOut, stdErr, error?.message]
          .filter(Boolean)
          .join("\n");
        console.error("Dependency check command failed:", lastOutput);
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, maxDurationMs - elapsed);
      const waitMs = Math.min(retryIntervalMs, remaining);
      if (waitMs <= 0) break;
      console.log(`Waiting ${waitMs}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    throw new Error(
      `Dependencies not fully installed in ${appPath} after 3 minutes. Last output: ${lastOutput}`,
    );
  }

  async setUpDyadProvider() {
    await this.page
      .locator("div")
      .filter({ hasText: /^DyadNeeds Setup$/ })
      .nth(1)
      .click();
    await this.page.getByRole("textbox", { name: "Set Dyad API Key" }).click();
    await this.page
      .getByRole("textbox", { name: "Set Dyad API Key" })
      .fill("testdyadkey");
    await this.page.getByRole("button", { name: "Save Key" }).click();
  }

  async importApp(appDir: string) {
    await this.page.getByRole("button", { name: "Import App" }).click();
    await eph.stubDialog(this.electronApp, "showOpenDialog", {
      filePaths: [path.join(__dirname, "..", "fixtures", "import-app", appDir)],
    });
    await this.page.getByRole("button", { name: "Select Folder" }).click();
    await this.page.getByRole("button", { name: "Import" }).click();
  }

  async selectChatMode(mode: "build" | "ask") {
    await this.page.getByTestId("chat-mode-selector").click();
    await this.page.getByRole("option", { name: mode }).click();
  }

  async openContextFilesPicker() {
    const contextButton = this.page.getByTestId("codebase-context-button");
    await contextButton.click();
    return new ContextFilesPickerDialog(this.page, async () => {
      await contextButton.click();
    });
  }

  async openProModesDialog({
    location = "chat-input-container",
  }: {
    location?: "chat-input-container" | "home-chat-input-container";
  } = {}): Promise<ProModesDialog> {
    const proButton = this.page
      // Assumes you're on the chat page.
      .getByTestId(location)
      .getByRole("button", { name: "Pro", exact: true });
    await proButton.click();
    return new ProModesDialog(this.page, async () => {
      await proButton.click();
    });
  }

  async snapshotDialog() {
    await expect(this.page.getByRole("dialog")).toMatchAriaSnapshot();
  }

  async snapshotAppFiles({ name }: { name: string }) {
    const currentAppName = await this.getCurrentAppName();
    if (!currentAppName) {
      throw new Error("No app selected");
    }
    const normalizedAppName = currentAppName.toLowerCase().replace(/-/g, "");
    const appPath = await this.getCurrentAppPath();
    if (!appPath || !fs.existsSync(appPath)) {
      throw new Error(`App path does not exist: ${appPath}`);
    }

    await expect(() => {
      const filesData = generateAppFilesSnapshotData(appPath, appPath);

      // Sort by relative path to ensure deterministic output
      filesData.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      const snapshotContent = filesData
        .map(
          (file) =>
            `=== ${file.relativePath.replace(normalizedAppName, "[[normalizedAppName]]")} ===\n${file.content
              .split(normalizedAppName)
              .join("[[normalizedAppName]]")
              .split(currentAppName)
              .join("[[appName]]")}`,
        )
        .join("\n\n");

      if (name) {
        expect(snapshotContent).toMatchSnapshot(name + ".txt");
      } else {
        expect(snapshotContent).toMatchSnapshot();
      }
    }).toPass();
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
          /\[\[dyad-dump-path=([^\]]+)\]\]/g,
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

  async clickRestart() {
    await this.page.getByRole("button", { name: "Restart" }).click();
  }

  ////////////////////////////////
  // Preview panel
  ////////////////////////////////

  async selectPreviewMode(mode: "code" | "problems" | "preview" | "configure") {
    await this.page.getByTestId(`${mode}-mode-button`).click();
  }

  async clickRecheckProblems() {
    await this.page.getByTestId("recheck-button").click();
  }

  async clickFixAllProblems() {
    await this.page.getByTestId("fix-all-button").click();
    await this.waitForChatCompletion();
  }

  async snapshotProblemsPane() {
    await expect(this.page.getByTestId("problems-pane")).toMatchAriaSnapshot({
      timeout: Timeout.MEDIUM,
    });
  }

  async clickRebuild() {
    await this.clickPreviewMoreOptions();
    await this.page.getByText("Rebuild").click();
  }

  async clickTogglePreviewPanel() {
    await this.page.getByTestId("toggle-preview-panel-button").click();
  }

  async clickPreviewPickElement() {
    await this.page
      .getByTestId("preview-pick-element-button")
      .click({ timeout: Timeout.EXTRA_LONG });
  }

  async clickDeselectComponent() {
    await this.page.getByRole("button", { name: "Deselect component" }).click();
  }

  async clickPreviewMoreOptions() {
    await this.page.getByTestId("preview-more-options-button").click();
  }

  async clickPreviewRefresh() {
    await this.page.getByTestId("preview-refresh-button").click();
  }

  async clickPreviewNavigateBack() {
    await this.page.getByTestId("preview-navigate-back-button").click();
  }

  async clickPreviewNavigateForward() {
    await this.page.getByTestId("preview-navigate-forward-button").click();
  }

  async clickPreviewOpenBrowser() {
    await this.page.getByTestId("preview-open-browser-button").click();
  }

  locateLoadingAppPreview() {
    return this.page.getByText("Preparing app preview...");
  }

  locateStartingAppPreview() {
    return this.page.getByText("Starting your app server...");
  }

  getPreviewIframeElement() {
    return this.page.getByTestId("preview-iframe-element");
  }

  expectPreviewIframeIsVisible() {
    return expect(this.getPreviewIframeElement()).toBeVisible({
      timeout: Timeout.LONG,
    });
  }

  async clickFixErrorWithAI() {
    await this.page.getByRole("button", { name: "Fix error with AI" }).click();
  }

  async snapshotPreviewErrorBanner() {
    await expect(this.locatePreviewErrorBanner()).toMatchAriaSnapshot({
      timeout: Timeout.LONG,
    });
  }

  locatePreviewErrorBanner() {
    return this.page.getByTestId("preview-error-banner");
  }

  async snapshotChatInputContainer() {
    await expect(this.getChatInputContainer()).toMatchAriaSnapshot();
  }

  getSelectedComponentDisplay() {
    return this.page.getByTestId("selected-component-display");
  }

  async snapshotSelectedComponentDisplay() {
    await expect(this.getSelectedComponentDisplay()).toMatchAriaSnapshot();
  }

  async snapshotPreview({ name }: { name?: string } = {}) {
    const iframe = this.getPreviewIframeElement();
    await expect(iframe.contentFrame().locator("body")).toMatchAriaSnapshot({
      name,
      timeout: Timeout.LONG,
    });
  }

  async snapshotServerDump(
    type: "all-messages" | "last-message" | "request" = "all-messages",
    { name = "", dumpIndex = -1 }: { name?: string; dumpIndex?: number } = {},
  ) {
    // Get the text content of the messages list
    const messagesListText = await this.page
      .getByTestId("messages-list")
      .textContent();

    // Find ALL dump paths using global regex
    const dumpPathMatches = messagesListText?.match(
      /\[\[dyad-dump-path=([^\]]+)\]\]/g,
    );

    if (!dumpPathMatches || dumpPathMatches.length === 0) {
      throw new Error("No dump path found in messages list");
    }

    // Extract the actual paths from the matches
    const dumpPaths = dumpPathMatches
      .map((match) => {
        const pathMatch = match.match(/\[\[dyad-dump-path=([^\]]+)\]\]/);
        return pathMatch ? pathMatch[1] : null;
      })
      .filter(Boolean);

    // Select the dump path based on index
    // -1 means last, -2 means second to last, etc.
    // 0 means first, 1 means second, etc.
    const selectedIndex =
      dumpIndex < 0 ? dumpPaths.length + dumpIndex : dumpIndex;

    if (selectedIndex < 0 || selectedIndex >= dumpPaths.length) {
      throw new Error(
        `Dump index ${dumpIndex} is out of range. Found ${dumpPaths.length} dump paths.`,
      );
    }

    const dumpFilePath = dumpPaths[selectedIndex];
    if (!dumpFilePath) {
      throw new Error("No dump file path found");
    }

    // Read the JSON file
    const dumpContent: string = (
      fs.readFileSync(dumpFilePath, "utf-8") as any
    ).replaceAll(/\[\[dyad-dump-path=([^\]]+)\]\]/g, "[[dyad-dump-path=*]]");
    // Perform snapshot comparison
    const parsedDump = JSON.parse(dumpContent);
    if (type === "request") {
      parsedDump["body"]["messages"] = parsedDump["body"]["messages"].map(
        (message: any) => {
          if (message.role === "system") {
            message.content = "[[SYSTEM_MESSAGE]]";
          }
          return message;
        },
      );
      expect(
        JSON.stringify(parsedDump, null, 2).replace(/\\r\\n/g, "\\n"),
      ).toMatchSnapshot(name);
      return;
    }
    expect(
      prettifyDump(parsedDump["body"]["messages"], {
        onlyLastMessage: type === "last-message",
      }),
    ).toMatchSnapshot(name);
  }

  async waitForChatCompletion() {
    await expect(this.getRetryButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
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
    return this.page.locator(
      '[data-lexical-editor="true"][aria-placeholder="Ask Dyad to build..."]',
    );
  }

  clickNewChat({ index = 0 }: { index?: number } = {}) {
    // There is two new chat buttons...
    return this.page
      .getByRole("button", { name: "New Chat" })
      .nth(index)
      .click();
  }

  async clickBackButton() {
    await this.page.getByRole("button", { name: "Back" }).click();
  }

  async sendPrompt(prompt: string) {
    await this.getChatInput().click();
    await this.getChatInput().fill(prompt);
    await this.page.getByRole("button", { name: "Send message" }).click();
    await this.waitForChatCompletion();
  }

  async selectModel({ provider, model }: { provider: string; model: string }) {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText(provider, { exact: true }).click();
    await this.page.getByText(model, { exact: true }).click();
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

  async selectTestAzureModel() {
    await this.page.getByRole("button", { name: "Model: Auto" }).click();
    await this.page.getByText("Other AI providers").click();
    await this.page.getByText("Azure OpenAI", { exact: true }).click();
    await this.page.getByText("GPT-5", { exact: true }).click();
  }

  async setUpAzure({ autoApprove = false }: { autoApprove?: boolean } = {}) {
    await this.githubConnector.clearPushEvents();
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    // Azure should already be configured via environment variables
    // so we don't need additional setup steps like setUpDyadProvider
    await this.goToAppsTab();
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

  async goToLibraryTab() {
    await this.page.getByRole("link", { name: "Library" }).click();
  }

  async createPrompt({
    title,
    description,
    content,
  }: {
    title: string;
    description?: string;
    content: string;
  }) {
    await this.page.getByRole("button", { name: "New Prompt" }).click();
    await this.page.getByRole("textbox", { name: "Title" }).fill(title);
    if (description) {
      await this.page
        .getByRole("textbox", { name: "Description (optional)" })
        .fill(description);
    }
    await this.page.getByRole("textbox", { name: "Content" }).fill(content);
    await this.page.getByRole("button", { name: "Save" }).click();
  }

  getTitleBarAppNameButton() {
    return this.page.getByTestId("title-bar-app-name-button");
  }

  getAppListItem({ appName }: { appName: string }) {
    return this.page.getByTestId(`app-list-item-${appName}`);
  }

  async isCurrentAppNameNone() {
    await expect(async () => {
      await expect(this.getTitleBarAppNameButton()).toContainText(
        "no app selected",
      );
    }).toPass();
  }

  async getCurrentAppName() {
    // Make sure to wait for the app to be set to avoid a race condition.
    await expect(async () => {
      await expect(this.getTitleBarAppNameButton()).not.toContainText(
        "no app selected",
      );
    }).toPass();
    return (await this.getTitleBarAppNameButton().textContent())?.replace(
      "App: ",
      "",
    );
  }

  async getCurrentAppPath() {
    const currentAppName = await this.getCurrentAppName();
    if (!currentAppName) {
      throw new Error("No current app name found");
    }
    return this.getAppPath({ appName: currentAppName });
  }

  getAppPath({ appName }: { appName: string }) {
    return path.join(this.userDataDir, "dyad-apps", appName);
  }

  async clickAppListItem({ appName }: { appName: string }) {
    await this.page.getByTestId(`app-list-item-${appName}`).click();
  }

  async clickOpenInChatButton() {
    await this.page.getByRole("button", { name: "Open in Chat" }).click();
  }

  locateAppUpgradeButton({ upgradeId }: { upgradeId: string }) {
    return this.page.getByTestId(`app-upgrade-${upgradeId}`);
  }

  async clickAppUpgradeButton({ upgradeId }: { upgradeId: string }) {
    await this.locateAppUpgradeButton({ upgradeId }).click();
  }

  async expectAppUpgradeButtonIsNotVisible({
    upgradeId,
  }: {
    upgradeId: string;
  }) {
    await expect(this.locateAppUpgradeButton({ upgradeId })).toBeHidden({
      timeout: Timeout.MEDIUM,
    });
  }

  async expectNoAppUpgrades() {
    await expect(this.page.getByTestId("no-app-upgrades-needed")).toBeVisible({
      timeout: Timeout.LONG,
    });
  }

  async clickAppDetailsRenameAppButton() {
    await this.page.getByTestId("app-details-rename-app-button").click();
  }

  async clickAppDetailsMoreOptions() {
    await this.page.getByTestId("app-details-more-options-button").click();
  }

  async clickAppDetailsCopyAppButton() {
    await this.page.getByRole("button", { name: "Copy app" }).click();
  }

  async clickConnectSupabaseButton() {
    await this.page.getByTestId("connect-supabase-button").click();
  }

  ////////////////////////////////
  // Settings related
  ////////////////////////////////

  async toggleAutoApprove() {
    await this.page.getByRole("switch", { name: "Auto-approve" }).click();
  }

  async toggleNativeGit() {
    await this.page.getByRole("switch", { name: "Enable Native Git" }).click();
  }

  async toggleAutoFixProblems() {
    await this.page.getByRole("switch", { name: "Auto-fix problems" }).click();
  }

  async snapshotSettings() {
    const settings = path.join(this.userDataDir, "user-settings.json");
    const settingsContent = fs.readFileSync(settings, "utf-8");
    //  Sanitize the "telemetryUserId" since it's a UUID
    const sanitizedSettingsContent = settingsContent
      .replace(/"telemetryUserId": "[^"]*"/g, '"telemetryUserId": "[UUID]"')
      // Don't snapshot this otherwise it'll diff with every release.
      .replace(
        /"lastShownReleaseNotesVersion": "[^"]*"/g,
        '"lastShownReleaseNotesVersion": "[scrubbed]"',
      );

    expect(sanitizedSettingsContent).toMatchSnapshot();
  }

  async toggleAutoUpdate() {
    await this.page.getByRole("switch", { name: "Auto-update" }).click();
  }

  async changeReleaseChannel(channel: "stable" | "beta") {
    // await page.getByRole('combobox').filter({ hasText: 'Stable' }).click();
    // await page.getByRole('option', { name: 'Beta' }).dblclick();
    await this.page.getByRole("combobox", { name: "Release Channel" }).click();
    await this.page
      .getByRole("option", { name: channel === "stable" ? "Stable" : "Beta" })
      .click();
  }

  async clickTelemetryAccept() {
    await this.page.getByTestId("telemetry-accept-button").click();
  }

  async clickTelemetryReject() {
    await this.page.getByTestId("telemetry-reject-button").click();
  }

  async clickTelemetryLater() {
    await this.page.getByTestId("telemetry-later-button").click();
  }

  async goToAppsTab() {
    await this.page.getByRole("link", { name: "Apps" }).click();
    await expect(this.page.getByText("Build your dream app")).toBeVisible();
  }

  async goToChatTab() {
    await this.page.getByRole("link", { name: "Chat" }).click();
  }

  async goToHubTab() {
    await this.page.getByRole("link", { name: "Hub" }).click();
  }

  async selectTemplate(templateName: string) {
    await this.page.getByRole("img", { name: templateName }).click();
  }

  async goToHubAndSelectTemplate(templateName: "Next.js Template") {
    await this.goToHubTab();
    await this.selectTemplate(templateName);
    await this.goToAppsTab();
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

interface ElectronConfig {
  preLaunchHook?: ({ userDataDir }: { userDataDir: string }) => Promise<void>;
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
        userDataDir: (electronApp as any).$dyadUserDataDir,
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
    async ({ electronConfig }, use) => {
      // find the latest build in the out directory
      const latestBuild = eph.findLatestBuild();
      // parse the directory and find paths and other info
      const appInfo = eph.parseElectronApp(latestBuild);
      process.env.OLLAMA_HOST = "http://localhost:3500/ollama";
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING =
        "http://localhost:3500/lmstudio";
      process.env.DYAD_ENGINE_URL = "http://localhost:3500/engine/v1";
      process.env.DYAD_GATEWAY_URL = "http://localhost:3500/gateway/v1";
      process.env.E2E_TEST_BUILD = "true";
      if (!electronConfig.showSetupScreen) {
        // This is just a hack to avoid the AI setup screen.
        process.env.OPENAI_API_KEY = "sk-test";
      }
      const baseTmpDir = os.tmpdir();
      const userDataDir = path.join(baseTmpDir, `dyad-e2e-tests-${Date.now()}`);
      if (electronConfig.preLaunchHook) {
        await electronConfig.preLaunchHook({ userDataDir });
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
          console.log("[cleanup:start] Killing dyad.exe");
          console.time("taskkill");
          execSync("taskkill /f /t /im dyad.exe");
          console.timeEnd("taskkill");
          console.log("[cleanup:end] Killed dyad.exe");
        } catch (error) {
          console.warn(
            "Failed to kill dyad.exe: (continuing with test cleanup)",
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

export function testWithConfig(config: ElectronConfig) {
  return test.extend({
    electronConfig: async ({}, use) => {
      await use(config);
    },
  });
}

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

// Wrapper that skips tests on Windows platform
export const testSkipIfWindows = os.platform() === "win32" ? test.skip : test;

function prettifyDump(
  allMessages: {
    role: string;
    content: string | Array<{}>;
  }[],
  { onlyLastMessage = false }: { onlyLastMessage?: boolean } = {},
) {
  const messages = onlyLastMessage ? allMessages.slice(-1) : allMessages;

  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? JSON.stringify(message.content)
        : message.content
            .replace(BUILD_SYSTEM_PREFIX, "\n${BUILD_SYSTEM_PREFIX}")
            .replace(BUILD_SYSTEM_POSTFIX, "${BUILD_SYSTEM_POSTFIX}")
            // Normalize line endings to always use \n
            .replace(/\r\n/g, "\n")
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
