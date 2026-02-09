/**
 * Main PageObject class that composes all component page objects.
 * This provides a single entry point for tests while maintaining
 * backward compatibility with the existing API.
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

  // Component page objects (exposed for direct access if needed)
  public githubConnector: GitHubConnector;
  private chatActions: ChatActions;
  private previewPanel: PreviewPanel;
  private codeEditor: CodeEditor;
  private securityReview: SecurityReview;
  private toastNotifications: ToastNotifications;
  private agentConsent: AgentConsent;
  private navigation: Navigation;
  private modelPicker: ModelPicker;
  private settings: Settings;
  private appManagement: AppManagement;
  private promptLibrary: PromptLibrary;

  constructor(
    public electronApp: ElectronApplication,
    public page: Page,
    { userDataDir }: { userDataDir: string },
  ) {
    this.userDataDir = userDataDir;

    // Initialize component page objects
    this.githubConnector = new GitHubConnector(this.page);
    this.chatActions = new ChatActions(this.page);
    this.previewPanel = new PreviewPanel(this.page);
    this.codeEditor = new CodeEditor(this.page);
    this.securityReview = new SecurityReview(this.page);
    this.toastNotifications = new ToastNotifications(this.page);
    this.agentConsent = new AgentConsent(this.page);
    this.navigation = new Navigation(this.page);
    this.modelPicker = new ModelPicker(this.page);
    this.settings = new Settings(this.page, userDataDir);
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
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    if (disableNativeGit) {
      await this.toggleNativeGit();
    }
    if (enableAutoFixProblems) {
      await this.toggleAutoFixProblems();
    }
    await this.setUpTestProvider();
    await this.setUpTestModel();
    await this.goToAppsTab();
    if (!enableBasicAgent) {
      await this.selectChatMode("build");
    }
    await this.selectTestModel();
  }

  async setUpDyadPro({
    autoApprove = false,
    localAgent = false,
    localAgentUseAutoModel = false,
  }: {
    autoApprove?: boolean;
    localAgent?: boolean;
    localAgentUseAutoModel?: boolean;
  } = {}) {
    await this.baseSetup();
    await this.goToSettingsTab();
    if (autoApprove) {
      await this.toggleAutoApprove();
    }
    await this.setUpDyadProvider();
    await this.goToAppsTab();
    if (!localAgent) {
      await this.selectChatMode("build");
    }
    // Select a non-openAI model for local agent mode,
    // since openAI models go to the responses API.
    if (localAgent && !localAgentUseAutoModel) {
      await this.selectModel({
        provider: "Anthropic",
        model: "Claude Opus 4.5",
      });
    }
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

  // ================================
  // Chat Actions (delegated)
  // ================================

  getHomeChatInputContainer() {
    return this.chatActions.getHomeChatInputContainer();
  }

  getChatInputContainer() {
    return this.chatActions.getChatInputContainer();
  }

  getChatInput() {
    return this.chatActions.getChatInput();
  }

  async clearChatInput() {
    return this.chatActions.clearChatInput();
  }

  async openChatHistoryMenu() {
    return this.chatActions.openChatHistoryMenu();
  }

  clickNewChat(options?: { index?: number }) {
    return this.chatActions.clickNewChat(options);
  }

  async waitForChatCompletion() {
    return this.chatActions.waitForChatCompletion();
  }

  async clickRetry() {
    return this.chatActions.clickRetry();
  }

  async clickUndo() {
    return this.chatActions.clickUndo();
  }

  async sendPrompt(
    prompt: string,
    options?: { skipWaitForCompletion?: boolean },
  ) {
    return this.chatActions.sendPrompt(prompt, options);
  }

  async selectChatMode(
    mode: "build" | "ask" | "agent" | "local-agent" | "basic-agent" | "plan",
  ) {
    return this.chatActions.selectChatMode(mode);
  }

  async selectLocalAgentMode() {
    return this.chatActions.selectLocalAgentMode();
  }

  async clickChatActivityButton() {
    return this.chatActions.clickChatActivityButton();
  }

  async snapshotChatActivityList() {
    return this.chatActions.snapshotChatActivityList();
  }

  async snapshotChatInputContainer() {
    return this.chatActions.snapshotChatInputContainer();
  }

  // ================================
  // Preview Panel (delegated)
  // ================================

  async selectPreviewMode(
    mode:
      | "code"
      | "problems"
      | "preview"
      | "configure"
      | "security"
      | "publish",
  ) {
    return this.previewPanel.selectPreviewMode(mode);
  }

  async clickRecheckProblems() {
    return this.previewPanel.clickRecheckProblems();
  }

  async clickFixAllProblems() {
    await this.previewPanel.clickFixAllProblems();
    await this.waitForChatCompletion();
  }

  async snapshotProblemsPane() {
    return this.previewPanel.snapshotProblemsPane();
  }

  async clickRebuild() {
    return this.previewPanel.clickRebuild();
  }

  async clickTogglePreviewPanel() {
    return this.previewPanel.clickTogglePreviewPanel();
  }

  async clickPreviewPickElement() {
    return this.previewPanel.clickPreviewPickElement();
  }

  async clickDeselectComponent(options?: { index?: number }) {
    return this.previewPanel.clickDeselectComponent(options);
  }

  async clickPreviewMoreOptions() {
    return this.previewPanel.clickPreviewMoreOptions();
  }

  async clickPreviewRefresh() {
    return this.previewPanel.clickPreviewRefresh();
  }

  async clickPreviewNavigateBack() {
    return this.previewPanel.clickPreviewNavigateBack();
  }

  async clickPreviewNavigateForward() {
    return this.previewPanel.clickPreviewNavigateForward();
  }

  async clickPreviewOpenBrowser() {
    return this.previewPanel.clickPreviewOpenBrowser();
  }

  async clickPreviewAnnotatorButton() {
    return this.previewPanel.clickPreviewAnnotatorButton();
  }

  async waitForAnnotatorMode() {
    return this.previewPanel.waitForAnnotatorMode();
  }

  async clickAnnotatorSubmit() {
    return this.previewPanel.clickAnnotatorSubmit();
  }

  locateLoadingAppPreview() {
    return this.previewPanel.locateLoadingAppPreview();
  }

  locateStartingAppPreview() {
    return this.previewPanel.locateStartingAppPreview();
  }

  getPreviewIframeElement() {
    return this.previewPanel.getPreviewIframeElement();
  }

  expectPreviewIframeIsVisible() {
    return this.previewPanel.expectPreviewIframeIsVisible();
  }

  async clickFixErrorWithAI() {
    return this.previewPanel.clickFixErrorWithAI();
  }

  async clickCopyErrorMessage() {
    return this.previewPanel.clickCopyErrorMessage();
  }

  async clickFixAllErrors() {
    return this.previewPanel.clickFixAllErrors();
  }

  async snapshotPreviewErrorBanner() {
    return this.previewPanel.snapshotPreviewErrorBanner();
  }

  locatePreviewErrorBanner() {
    return this.previewPanel.locatePreviewErrorBanner();
  }

  getSelectedComponentsDisplay() {
    return this.previewPanel.getSelectedComponentsDisplay();
  }

  async snapshotSelectedComponentsDisplay() {
    return this.previewPanel.snapshotSelectedComponentsDisplay();
  }

  async snapshotPreview(options?: { name?: string }) {
    return this.previewPanel.snapshotPreview(options);
  }

  // ================================
  // Code Editor (delegated)
  // ================================

  async clickEditButton() {
    return this.codeEditor.clickEditButton();
  }

  async editFileContent(content: string) {
    return this.codeEditor.editFileContent(content);
  }

  async saveFile() {
    return this.codeEditor.saveFile();
  }

  async cancelEdit() {
    return this.codeEditor.cancelEdit();
  }

  // ================================
  // Security Review (delegated)
  // ================================

  async clickRunSecurityReview() {
    return this.securityReview.clickRunSecurityReview();
  }

  async snapshotSecurityFindingsTable() {
    return this.securityReview.snapshotSecurityFindingsTable();
  }

  // ================================
  // Toast Notifications (delegated)
  // ================================

  async expectNoToast() {
    return this.toastNotifications.expectNoToast();
  }

  async waitForToast(
    type?: "success" | "error" | "warning" | "info",
    timeout?: number,
  ) {
    return this.toastNotifications.waitForToast(type, timeout);
  }

  async waitForToastWithText(text: string, timeout?: number) {
    return this.toastNotifications.waitForToastWithText(text, timeout);
  }

  async assertToastVisible(type?: "success" | "error" | "warning" | "info") {
    return this.toastNotifications.assertToastVisible(type);
  }

  async assertToastWithText(text: string) {
    return this.toastNotifications.assertToastWithText(text);
  }

  async dismissAllToasts() {
    return this.toastNotifications.dismissAllToasts();
  }

  // ================================
  // Agent Consent (delegated)
  // ================================

  getAgentConsentBanner() {
    return this.agentConsent.getAgentConsentBanner();
  }

  async waitForAgentConsentBanner(timeout?: number) {
    return this.agentConsent.waitForAgentConsentBanner(timeout);
  }

  async clickAgentConsentAlwaysAllow() {
    return this.agentConsent.clickAgentConsentAlwaysAllow();
  }

  async clickAgentConsentAllowOnce() {
    return this.agentConsent.clickAgentConsentAllowOnce();
  }

  async clickAgentConsentDecline() {
    return this.agentConsent.clickAgentConsentDecline();
  }

  // ================================
  // Navigation (delegated)
  // ================================

  async goToSettingsTab() {
    return this.navigation.goToSettingsTab();
  }

  async goToLibraryTab() {
    return this.navigation.goToLibraryTab();
  }

  async goToAppsTab() {
    return this.navigation.goToAppsTab();
  }

  async goToChatTab() {
    return this.navigation.goToChatTab();
  }

  async goToHubTab() {
    return this.navigation.goToHubTab();
  }

  async clickBackButton() {
    return this.navigation.clickBackButton();
  }

  async selectTemplate(templateName: string) {
    return this.navigation.selectTemplate(templateName);
  }

  async goToHubAndSelectTemplate(templateName: "Next.js Template") {
    return this.navigation.goToHubAndSelectTemplate(templateName);
  }

  // ================================
  // Model Picker (delegated)
  // ================================

  async selectModel(options: { provider: string; model: string }) {
    return this.modelPicker.selectModel(options);
  }

  async selectTestModel() {
    return this.modelPicker.selectTestModel();
  }

  async selectTestOllamaModel() {
    return this.modelPicker.selectTestOllamaModel();
  }

  async selectTestLMStudioModel() {
    return this.modelPicker.selectTestLMStudioModel();
  }

  async selectTestAzureModel() {
    return this.modelPicker.selectTestAzureModel();
  }

  // ================================
  // Settings (delegated)
  // ================================

  async toggleAutoApprove() {
    return this.settings.toggleAutoApprove();
  }

  async toggleLocalAgentMode() {
    return this.settings.toggleLocalAgentMode();
  }

  async toggleNativeGit() {
    return this.settings.toggleNativeGit();
  }

  async toggleAutoFixProblems() {
    return this.settings.toggleAutoFixProblems();
  }

  async toggleAutoUpdate() {
    return this.settings.toggleAutoUpdate();
  }

  async changeReleaseChannel(channel: "stable" | "beta") {
    return this.settings.changeReleaseChannel(channel);
  }

  async clickTelemetryAccept() {
    return this.settings.clickTelemetryAccept();
  }

  async clickTelemetryReject() {
    return this.settings.clickTelemetryReject();
  }

  async clickTelemetryLater() {
    return this.settings.clickTelemetryLater();
  }

  recordSettings() {
    return this.settings.recordSettings();
  }

  snapshotSettingsDelta(beforeSettings: Record<string, unknown>) {
    return this.settings.snapshotSettingsDelta(beforeSettings);
  }

  async setUpTestProvider() {
    return this.settings.setUpTestProvider();
  }

  async setUpTestModel() {
    return this.settings.setUpTestModel();
  }

  async addCustomTestModel(options: { name: string; contextWindow?: number }) {
    return this.settings.addCustomTestModel(options);
  }

  async setUpTestProviderApiKey() {
    return this.settings.setUpTestProviderApiKey();
  }

  async setUpDyadProvider() {
    return this.settings.setUpDyadProvider();
  }

  // ================================
  // App Management (delegated)
  // ================================

  getTitleBarAppNameButton() {
    return this.appManagement.getTitleBarAppNameButton();
  }

  getAppListItem(options: { appName: string }) {
    return this.appManagement.getAppListItem(options);
  }

  async isCurrentAppNameNone() {
    return this.appManagement.isCurrentAppNameNone();
  }

  async getCurrentAppName() {
    return this.appManagement.getCurrentAppName();
  }

  async getCurrentAppPath() {
    return this.appManagement.getCurrentAppPath();
  }

  getAppPath(options: { appName: string }) {
    return this.appManagement.getAppPath(options);
  }

  async clickAppListItem(options: { appName: string }) {
    return this.appManagement.clickAppListItem(options);
  }

  async clickOpenInChatButton() {
    return this.appManagement.clickOpenInChatButton();
  }

  locateAppUpgradeButton(options: { upgradeId: string }) {
    return this.appManagement.locateAppUpgradeButton(options);
  }

  async clickAppUpgradeButton(options: { upgradeId: string }) {
    return this.appManagement.clickAppUpgradeButton(options);
  }

  async expectAppUpgradeButtonIsNotVisible(options: { upgradeId: string }) {
    return this.appManagement.expectAppUpgradeButtonIsNotVisible(options);
  }

  async expectNoAppUpgrades() {
    return this.appManagement.expectNoAppUpgrades();
  }

  async clickAppDetailsRenameAppButton() {
    return this.appManagement.clickAppDetailsRenameAppButton();
  }

  async clickAppDetailsMoreOptions() {
    return this.appManagement.clickAppDetailsMoreOptions();
  }

  async clickAppDetailsCopyAppButton() {
    return this.appManagement.clickAppDetailsCopyAppButton();
  }

  async clickConnectSupabaseButton() {
    return this.appManagement.clickConnectSupabaseButton();
  }

  async importApp(appDir: string) {
    return this.appManagement.importApp(appDir);
  }

  async configureGitUser(options?: {
    email?: string;
    name?: string;
    disableGpgSign?: boolean;
  }) {
    return this.appManagement.configureGitUser(options);
  }

  async ensurePnpmInstall() {
    return this.appManagement.ensurePnpmInstall();
  }

  // ================================
  // Prompt Library (delegated)
  // ================================

  async createPrompt(options: {
    title: string;
    description?: string;
    content: string;
  }) {
    return this.promptLibrary.createPrompt(options);
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
    await this.getChatInputContainer()
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
    await this.getChatInputContainer()
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
        // e.g. .dyad/chats/1/compaction-2026-02-05T21-25-24-285Z.md
        messagesList.innerHTML = messagesList.innerHTML.replace(
          /\.dyad\/chats\/\d+\/compaction-[^\s<"]+\.md/g,
          "[[compaction-backup-path]]",
        );

        messagesList.innerHTML = messagesList.innerHTML.replace(
          /\[\[dyad-dump-path=([^\]]+)\]\]/g,
          "[[dyad-dump-path=*]]",
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
    await this.waitForChatCompletion();
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
    const dumpContent: string = (fs.readFileSync(dumpFilePath, "utf-8") as any)
      .replaceAll(/\[\[dyad-dump-path=([^\]]+)\]\]/g, "[[dyad-dump-path=*]]")
      // Stabilize compaction backup file paths embedded in message text
      // e.g. .dyad/chats/1/compaction-2026-02-05T21-25-24-285Z.md
      .replaceAll(
        /\.dyad\/chats\/\d+\/compaction-[^\s"\\]+\.md/g,
        "[[compaction-backup-path]]",
      );
    // Perform snapshot comparison
    const parsedDump = JSON.parse(dumpContent);
    if (type === "request") {
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
