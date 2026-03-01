/**
 * Main PageObject class that composes all component page objects.
 * This provides a single entry point for tests with direct access
 * to component page objects (e.g., po.chatActions.sendPrompt()).
 */

import { Page, expect } from "@playwright/test";
import { ElectronApplication } from "playwright";
import fs from "fs";

import { generateAppFilesSnapshotData } from "../generateAppFilesSnapshotData";
import {
  normalizeItemReferences,
  normalizeToolCallIds,
  normalizeVersionedFiles,
  normalizePath,
  prettifyDump,
} from "../utils";

// Import component page objects
import { GitHubConnector } from "./components/GitHubConnector";
import { ChatActions } from "./components/ChatActions";
import { PreviewPanel } from "./components/PreviewPanel";
import { CodeEditor } from "./components/CodeEditor";
import { SecurityReview } from "./components/SecurityReview";
import { ToastNotifications } from "./components/ToastNotifications";
import { AgentConsent } from "./components/AgentConsent";
import { Navigation } from "./components/Navigation";
import { ModelPicker } from "./components/ModelPicker";
import { Settings } from "./components/Settings";
import { AppManagement } from "./components/AppManagement";
import { PromptLibrary } from "./components/PromptLibrary";

// Import dialog page objects
import { ContextFilesPickerDialog } from "./dialogs/ContextFilesPickerDialog";
import { ProModesDialog } from "./dialogs/ProModesDialog";

export class PageObject {
  public userDataDir: string;
  public fakeLlmPort: number;

  // Component page objects (exposed for direct access)
  public githubConnector: GitHubConnector;
  public chatActions: ChatActions;
  public previewPanel: PreviewPanel;
  public codeEditor: CodeEditor;
  public securityReview: SecurityReview;
  public toastNotifications: ToastNotifications;
  public agentConsent: AgentConsent;
  public navigation: Navigation;
  public modelPicker: ModelPicker;
  public settings: Settings;
  public appManagement: AppManagement;
  public promptLibrary: PromptLibrary;

  constructor(
    public electronApp: ElectronApplication,
    public page: Page,
    { userDataDir, fakeLlmPort }: { userDataDir: string; fakeLlmPort: number },
  ) {
    this.userDataDir = userDataDir;
    this.fakeLlmPort = fakeLlmPort;

    // Initialize component page objects
    this.githubConnector = new GitHubConnector(this.page, fakeLlmPort);
    this.chatActions = new ChatActions(this.page);
    this.previewPanel = new PreviewPanel(this.page);
    this.codeEditor = new CodeEditor(this.page);
    this.securityReview = new SecurityReview(this.page);
    this.toastNotifications = new ToastNotifications(this.page);
    this.agentConsent = new AgentConsent(this.page);
    this.navigation = new Navigation(this.page);
    this.modelPicker = new ModelPicker(this.page);
    this.settings = new Settings(this.page, userDataDir, fakeLlmPort);
    this.appManagement = new AppManagement(this.page, electronApp, userDataDir);
    this.promptLibrary = new PromptLibrary(this.page);
  }

  // ================================
  // Setup Methods
  // ================================

  private async baseSetup() {
    await this.githubConnector.clearPushEvents();
  }

  async setUp({
    autoApprove = false,
    disableNativeGit = false,
    enableAutoFixProblems = false,
    enableBasicAgent = false,
  }: {
    autoApprove?: boolean;
    disableNativeGit?: boolean;
    enableAutoFixProblems?: boolean;
    enableBasicAgent?: boolean;
  } = {}) {
    await this.baseSetup();
    await this.navigation.goToSettingsTab();
    if (autoApprove) {
      await this.settings.toggleAutoApprove();
    }
    if (disableNativeGit) {
      await this.settings.toggleNativeGit();
    }
    if (enableAutoFixProblems) {
      await this.settings.toggleAutoFixProblems();
    }
    await this.settings.setUpTestProvider();
    await this.settings.setUpTestModel();
    await this.navigation.goToAppsTab();
    if (!enableBasicAgent) {
      await this.chatActions.selectChatMode("build");
    }
    await this.modelPicker.selectTestModel();
  }

  async setUpConeyPro({
    autoApprove = false,
    localAgent = false,
    localAgentUseAutoModel = false,
  }: {
    autoApprove?: boolean;
    localAgent?: boolean;
    localAgentUseAutoModel?: boolean;
  } = {}) {
    await this.baseSetup();
    await this.navigation.goToSettingsTab();
    if (autoApprove) {
      await this.settings.toggleAutoApprove();
    }
    await this.settings.setUpConeyProvider();
    await this.navigation.goToAppsTab();
    if (!localAgent) {
      await this.chatActions.selectChatMode("build");
    }
    // Select a non-openAI model for local agent mode,
    // since openAI models go to the responses API.
    if (localAgent && !localAgentUseAutoModel) {
      await this.modelPicker.selectModel({
        provider: "Anthropic",
        model: "Claude Opus 4.5",
      });
    }
  }

  async setUpAzure({ autoApprove = false }: { autoApprove?: boolean } = {}) {
    await this.githubConnector.clearPushEvents();
    await this.navigation.goToSettingsTab();
    if (autoApprove) {
      await this.settings.toggleAutoApprove();
    }
    // Azure should already be configured via environment variables
    // so we don't need additional setup steps like setUpConeyProvider
    await this.navigation.goToAppsTab();
  }

  // ================================
  // Dialog Openers
  // ================================

  async openContextFilesPicker() {
    // Programmatically dismiss toasts using the sonner API by clicking any visible close buttons
    const toastCloseButtons = this.page.locator(
      "[data-sonner-toast] button[data-close-button]",
    );
    const maxAttempts = 20;
    let attempts = 0;
    while ((await toastCloseButtons.count()) > 0 && attempts < maxAttempts) {
      await toastCloseButtons
        .first()
        .click()
        .catch(() => {});
      attempts++;
    }

    // If close buttons don't work, click outside to dismiss
    if ((await this.page.locator("[data-sonner-toast]").count()) > 0) {
      // Click somewhere safe to dismiss toasts
      await this.page.mouse.click(10, 10);
      await this.page.waitForTimeout(300);
    }

    // Open the auxiliary actions menu
    await this.chatActions
      .getChatInputContainer()
      .getByTestId("auxiliary-actions-menu")
      .click();

    // Click on "Codebase context" to open the popover
    await this.page.getByTestId("codebase-context-trigger").click();

    // Wait for the popover content to be visible
    await this.page
      .getByTestId("manual-context-files-input")
      .waitFor({ state: "visible" });

    return new ContextFilesPickerDialog(this.page, async () => {
      // Close the popover first
      await this.page.keyboard.press("Escape");
      // Wait a bit for the popover to close, then close the dropdown menu
      await this.page
        .getByTestId("manual-context-files-input")
        .waitFor({ state: "hidden" });
      await this.page.keyboard.press("Escape");
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

  // ================================
  // Proposal Actions
  // ================================

  async approveProposal() {
    await this.page.getByTestId("approve-proposal-button").click();
  }

  async rejectProposal() {
    await this.page.getByTestId("reject-proposal-button").click();
  }

  async clickRestart() {
    await this.page.getByRole("button", { name: "Restart" }).click();
  }

  // ================================
  // Token Bar
  // ================================

  async toggleTokenBar() {
    // Need to make sure it's NOT visible yet to avoid a race when we opened
    // the auxiliary actions menu earlier.
    await expect(this.page.getByTestId("token-bar-toggle")).not.toBeVisible();
    await this.chatActions
      .getChatInputContainer()
      .getByTestId("auxiliary-actions-menu")
      .click();
    await this.page.getByTestId("token-bar-toggle").click();
  }

  // ================================
  // Clipboard
  // ================================

  async getClipboardText(): Promise<string> {
    return await this.page.evaluate(() => navigator.clipboard.readText());
  }

  // ================================
  // Utility Methods
  // ================================

  async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ================================
  // Snapshot Methods
  // ================================

  async snapshotDialog() {
    await expect(this.page.getByRole("dialog")).toMatchAriaSnapshot();
  }

  async snapshotAppFiles({ name, files }: { name: string; files?: string[] }) {
    const currentAppName = await this.appManagement.getCurrentAppName();
    if (!currentAppName) {
      throw new Error("No app selected");
    }
    const normalizedAppName = currentAppName.toLowerCase().replace(/-/g, "");
    const appPath = await this.appManagement.getCurrentAppPath();
    if (!appPath || !fs.existsSync(appPath)) {
      throw new Error(`App path does not exist: ${appPath}`);
    }

    await expect(() => {
      let filesData = generateAppFilesSnapshotData(appPath, appPath);

      // Sort by relative path to ensure deterministic output
      filesData.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      if (files) {
        filesData = filesData.filter((file) =>
          files.some(
            (f) => normalizePath(f) === normalizePath(file.relativePath),
          ),
        );
      }

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
    timeout,
  }: { replaceDumpPath?: boolean; timeout?: number } = {}) {
    // NOTE: once you have called this, you can NOT manipulate the UI anymore or React will break.
    if (replaceDumpPath) {
      await this.page.evaluate(() => {
        const messagesList = document.querySelector(
          "[data-testid=messages-list]",
        );
        if (!messagesList) {
          throw new Error("Messages list not found");
        }
        // Scrub compaction backup paths embedded in message text
        // e.g. .coney/chats/1/compaction-2026-02-05T21-25-24-285Z.md
        messagesList.innerHTML = messagesList.innerHTML.replace(
          /\.coney\/chats\/\d+\/compaction-[^\s<"]+\.md/g,
          "[[compaction-backup-path]]",
        );

        messagesList.innerHTML = messagesList.innerHTML.replace(
          /\[\[coney-dump-path=([^\]]+)\]\]/g,
          "[[coney-dump-path=*]]",
        );
      });
    }
    await expect(this.page.getByTestId("messages-list")).toMatchAriaSnapshot({
      timeout,
    });
  }

  async snapshotServerDump(
    type: "all-messages" | "last-message" | "request" = "all-messages",
    { name = "", dumpIndex = -1 }: { name?: string; dumpIndex?: number } = {},
  ) {
    await this.chatActions.waitForChatCompletion();
    // Get the text content of the messages list
    const messagesListText = await this.page
      .getByTestId("messages-list")
      .textContent();

    // Find ALL dump paths using global regex
    const dumpPathMatches = messagesListText?.match(
      /\[\[coney-dump-path=([^\]]+)\]\]/g,
    );

    if (!dumpPathMatches || dumpPathMatches.length === 0) {
      throw new Error("No dump path found in messages list");
    }

    // Extract the actual paths from the matches
    const dumpPaths = dumpPathMatches
      .map((match) => {
        const pathMatch = match.match(/\[\[coney-dump-path=([^\]]+)\]\]/);
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
    const dumpContent: string = (fs.readFileSync(dumpFilePath, "utf-8") as any)
      .replaceAll(/\[\[coney-dump-path=([^\]]+)\]\]/g, "[[coney-dump-path=*]]")
      // Stabilize compaction backup file paths embedded in message text
      // e.g. .coney/chats/1/compaction-2026-02-05T21-25-24-285Z.md
      .replaceAll(
        /\.coney\/chats\/\d+\/compaction-[^\s"\\]+\.md/g,
        "[[compaction-backup-path]]",
      );

    // Perform snapshot comparison
    const parsedDump = JSON.parse(dumpContent);
    if (parsedDump["body"]["input"]) {
      parsedDump["body"]["input"] = parsedDump["body"]["input"].map(
        (input: any) => {
          if (input.role === "system") {
            input.content = "[[SYSTEM_MESSAGE]]";
          }
          return input;
        },
      );
    }
    if (parsedDump["body"]["messages"]) {
      parsedDump["body"]["messages"] = parsedDump["body"]["messages"].map(
        (message: any) => {
          if (message.role === "system") {
            message.content = "[[SYSTEM_MESSAGE]]";
          }
          return message;
        },
      );
    }
    if (type === "request") {
      // Normalize fileIds to be deterministic based on content
      normalizeVersionedFiles(parsedDump);
      // Normalize item_reference IDs (e.g., msg_1234567890) to be deterministic
      normalizeItemReferences(parsedDump);
      // Normalize tool_call IDs (e.g., call_1234567890_0) to be deterministic
      normalizeToolCallIds(parsedDump);
      expect(
        JSON.stringify(parsedDump, null, 2).replace(/\\r\\n/g, "\\n"),
      ).toMatchSnapshot(name);
      return;
    }
    expect(
      prettifyDump(
        // responses API
        parsedDump["body"]["input"] ??
          // chat completion API
          parsedDump["body"]["messages"],
        {
          onlyLastMessage: type === "last-message",
        },
      ),
    ).toMatchSnapshot(name);
  }

  // ================================
  // Delegated Methods (for shorter calls)
  // ================================

  async sendPrompt(
    prompt: string,
    options?: { skipWaitForCompletion?: boolean },
  ) {
    return this.chatActions.sendPrompt(prompt, options);
  }

  async importApp(appDir: string) {
    return this.appManagement.importApp(appDir);
  }

  // ================================
  // Test-only: Node.js Mock Control
  // ================================

  /**
   * Set the mock state for Node.js installation status.
   * @param installed - true = mock as installed, false = mock as not installed, null = use real check
   */
  async setNodeMock(installed: boolean | null) {
    await this.page.evaluate(async (installed) => {
      await (window as any).electron.ipcRenderer.invoke("test:set-node-mock", {
        installed,
      });
    }, installed);
  }
}
