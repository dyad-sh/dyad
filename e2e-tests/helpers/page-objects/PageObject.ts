/**
 * Main PageObject class that composes all component page objects.
 * This provides a single entry point for tests with direct access
 * to component page objects (e.g., po.chatActions.sendPrompt()).
 */

import { Page, expect, type Locator, type TestInfo } from "@playwright/test";
import { ElectronApplication } from "playwright";
import fs from "fs";
import path from "path";

import { generateAppFilesSnapshotData } from "../generateAppFilesSnapshotData";
import {
  normalizeItemReferences,
  normalizeToolCallIds,
  normalizeMcpCallIds,
  normalizeVersionedFiles,
  normalizePath,
  prettifyDump,
  normalizeMessagesAriaSnapshot,
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
import { BrowserNotifications } from "./components/BrowserNotifications";

// Import dialog page objects
import { ContextFilesPickerDialog } from "./dialogs/ContextFilesPickerDialog";
import { ProModesDialog } from "./dialogs/ProModesDialog";
import { Timeout } from "../constants";

const IGNORED_SNAPSHOT_FILE_PATHS = new Set([".gitattributes"]);

function isIgnoredSnapshotFile(filePath: string | undefined): boolean {
  return (
    typeof filePath === "string" &&
    IGNORED_SNAPSHOT_FILE_PATHS.has(normalizePath(filePath))
  );
}

function removeIgnoredDyadFileBlocks(text: string): string {
  return text
    .replace(
      /\n?<dyad-file path="\.gitattributes">[\s\S]*?<\/dyad-file>\n*/g,
      "",
    )
    .replace(
      /This is my codebase\.\s+(<dyad-file)/g,
      "This is my codebase. $1",
    );
}

function sanitizeContentForSnapshot(content: unknown): unknown {
  if (typeof content === "string") {
    return removeIgnoredDyadFileBlocks(content);
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return {
          ...part,
          text: removeIgnoredDyadFileBlocks(part.text),
        };
      }
      return part;
    });
  }
  return content;
}

function removeIgnoredSnapshotFilesFromDump(dump: any): void {
  const body = dump?.body;
  if (!body) {
    return;
  }

  for (const key of ["input", "messages"] as const) {
    if (Array.isArray(body[key])) {
      body[key] = body[key].map((message: any) => ({
        ...message,
        content: sanitizeContentForSnapshot(message.content),
      }));
    }
  }

  if (Array.isArray(body.dyad_options?.files)) {
    body.dyad_options.files = body.dyad_options.files.filter(
      (file: any) => !isIgnoredSnapshotFile(file.path),
    );
  }

  if (Array.isArray(body.dyad_options?.mentioned_apps)) {
    for (const mentionedApp of body.dyad_options.mentioned_apps) {
      if (Array.isArray(mentionedApp.files)) {
        mentionedApp.files = mentionedApp.files.filter(
          (file: any) => !isIgnoredSnapshotFile(file.path),
        );
      }
    }
  }

  const vf = body.dyad_options?.versioned_files;
  if (!vf) {
    return;
  }

  const ignoredFileIds = new Set<string>();
  if (Array.isArray(vf.fileReferences)) {
    vf.fileReferences = vf.fileReferences.filter((ref: any) => {
      if (isIgnoredSnapshotFile(ref.path)) {
        if (typeof ref.fileId === "string") {
          ignoredFileIds.add(ref.fileId);
        }
        return false;
      }
      return true;
    });
  }

  if (vf.fileIdToContent) {
    for (const fileId of ignoredFileIds) {
      delete vf.fileIdToContent[fileId];
    }
  }

  if (vf.messageIndexToFilePathToFileId) {
    for (const pathToId of Object.values(
      vf.messageIndexToFilePathToFileId as Record<
        string,
        Record<string, string>
      >,
    )) {
      for (const filePath of Object.keys(pathToId)) {
        if (isIgnoredSnapshotFile(filePath)) {
          delete pathToId[filePath];
        }
      }
    }
  }
}

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
  public browserNotifications: BrowserNotifications;
  private stableMessageSnapshotIndex = 0;

  constructor(
    public electronApp: ElectronApplication,
    public page: Page,
    {
      userDataDir,
      fakeLlmPort,
      testInfo,
    }: { userDataDir: string; fakeLlmPort: number; testInfo?: TestInfo },
  ) {
    this.userDataDir = userDataDir;
    this.fakeLlmPort = fakeLlmPort;
    this.testInfo = testInfo;

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
    this.browserNotifications = new BrowserNotifications(this.page);
  }

  private testInfo?: TestInfo;

  private nextStableMessageSnapshotPath(name?: string) {
    if (name) {
      const snapshotName = name.endsWith(".aria.yml")
        ? name
        : `${name}.aria.yml`;
      return this.testInfo?.snapshotPath(snapshotName, {
        kind: "aria",
      });
    }

    this.stableMessageSnapshotIndex++;
    if (!this.testInfo) {
      return undefined;
    }
    const title = this.testInfo?.title ?? "messages";
    // Mirrors Playwright's snapshot-name sanitization: everything except
    // letters, digits, and "-" becomes a "-" so auto-derived names line up
    // with the files toMatchAriaSnapshot() would generate.
    const normalizedTitle =
      title
        .replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "") || "messages";
    return this.testInfo.snapshotPath(
      `${normalizedTitle}-${this.stableMessageSnapshotIndex}.aria.yml`,
      { kind: "aria" },
    );
  }

  private async expectStableMessageAriaSnapshot(
    captureSnapshot: () => Promise<string>,
    name?: string,
  ) {
    const snapshotPath = this.nextStableMessageSnapshotPath(name);
    if (!snapshotPath) {
      const actualSnapshot = await captureSnapshot();
      expect(actualSnapshot).toMatchSnapshot();
      return;
    }

    const updateSnapshots = this.testInfo?.config.updateSnapshots ?? "none";
    const snapshotExists = fs.existsSync(snapshotPath);
    const shouldUpdate =
      updateSnapshots === "all" ||
      updateSnapshots === "changed" ||
      (updateSnapshots === "missing" && !snapshotExists);

    if (shouldUpdate) {
      const actualSnapshot = await captureSnapshot();
      fs.writeFileSync(snapshotPath, actualSnapshot);
      if (updateSnapshots === "missing") {
        // Match Playwright's snapshot semantics: a missing baseline is
        // written but still fails the test, so a renamed/typo'd snapshot
        // name cannot silently pass on CI.
        throw new Error(
          `ARIA snapshot is missing at ${snapshotPath}, writing actual. Re-run the test to use the new baseline.`,
        );
      }
      return;
    }

    if (!snapshotExists) {
      throw new Error(`ARIA snapshot does not exist: ${snapshotPath}`);
    }

    const expectedSnapshot = fs.readFileSync(snapshotPath, "utf8");

    let actualSnapshot = await captureSnapshot();
    if (actualSnapshot !== expectedSnapshot) {
      try {
        await expect(async () => {
          actualSnapshot = await captureSnapshot();
          expect(actualSnapshot).toBe(expectedSnapshot);
        }).toPass({
          intervals: [100, 250, 500, 1_000],
          timeout: Timeout.SHORT,
        });
        return;
      } catch {
        // Attach the last observed mismatch below for the normal snapshot diff.
      }
    }

    if (actualSnapshot !== expectedSnapshot && this.testInfo) {
      const baseName = path.basename(snapshotPath, ".aria.yml");
      const actualPath = this.testInfo.outputPath(
        `${baseName}-actual.aria.yml`,
      );
      fs.writeFileSync(actualPath, actualSnapshot);
      await this.testInfo.attach(`${baseName}-expected`, {
        path: snapshotPath,
        contentType: "text/plain",
      });
      await this.testInfo.attach(`${baseName}-actual`, {
        path: actualPath,
        contentType: "text/plain",
      });
    }
    expect(actualSnapshot).toBe(expectedSnapshot);
  }

  // ================================
  // Setup Methods
  // ================================

  private async baseSetup() {
    await this.githubConnector.clearPushEvents();
    await this.githubConnector.resetRepos();
  }

  async pinBuildChatModeForSetup() {
    await this.expectBuildChatModeForSetup({ timeout: Timeout.MEDIUM });
  }

  async expectBuildChatModeForSetup({ timeout }: { timeout: number }) {
    await expect
      .poll(
        () => ({
          selectedChatMode: this.settings.recordSettings().selectedChatMode,
          defaultChatMode: this.settings.recordSettings().defaultChatMode,
        }),
        { timeout },
      )
      .toEqual({
        selectedChatMode: "build",
        defaultChatMode: "build",
      });
  }

  async forceBuildChatModeForSetup() {
    await expect(async () => {
      await this.page.evaluate(async () => {
        await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
          selectedChatMode: "build",
          defaultChatMode: "build",
        });
      });
      await this.expectBuildChatModeForSetup({ timeout: 1_000 });
    }).toPass({ timeout: Timeout.MEDIUM });
  }

  async waitForDyadProviderSetup() {
    await expect
      .poll(
        () => {
          const settings = this.settings.recordSettings();
          const providerSettings = settings.providerSettings as
            | { auto?: { apiKey?: { value?: string } } }
            | undefined;
          return {
            enableDyadPro: settings.enableDyadPro,
            dyadApiKey: providerSettings?.auto?.apiKey?.value,
          };
        },
        { timeout: Timeout.MEDIUM },
      )
      .toEqual({
        enableDyadPro: true,
        dyadApiKey: "testdyadkey",
      });
  }

  async setUp({
    autoApprove = false,
    disableNativeGit = false,
    enableAutoFixProblems = false,
    enableBasicAgent = false,
    enableSelectAppFromHomeChatInput = false,
  }: {
    autoApprove?: boolean;
    disableNativeGit?: boolean;
    enableAutoFixProblems?: boolean;
    enableBasicAgent?: boolean;
    enableSelectAppFromHomeChatInput?: boolean;
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
    if (enableSelectAppFromHomeChatInput) {
      await this.settings.toggleEnableSelectAppFromHomeChatInput();
    }
    await this.settings.setUpTestProvider();
    await this.settings.setUpTestModel();
    if (!enableBasicAgent) {
      await this.forceBuildChatModeForSetup();
    }
    await this.navigation.goToAppsTab();
    if (!enableBasicAgent) {
      await this.chatActions.selectChatMode("build");
    }
    await this.modelPicker.selectTestModel();
    if (!enableBasicAgent) {
      await this.forceBuildChatModeForSetup();
    }
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
    await this.navigation.goToSettingsTab();
    if (autoApprove) {
      await this.settings.toggleAutoApprove();
    }
    await this.settings.setUpDyadProvider();
    await this.waitForDyadProviderSetup();
    if (!localAgent) {
      await this.forceBuildChatModeForSetup();
    }
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
    if (!localAgent) {
      await this.forceBuildChatModeForSetup();
    }
  }

  async setUpAzure({ autoApprove = false }: { autoApprove?: boolean } = {}) {
    await this.githubConnector.clearPushEvents();
    await this.navigation.goToSettingsTab();
    if (autoApprove) {
      await this.settings.toggleAutoApprove();
    }
    // Azure should already be configured via environment variables
    // so we don't need additional setup steps like setUpDyadProvider
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
    const approveButton = this.page
      .getByTestId("approve-proposal-button")
      .last();
    await expect(approveButton).toBeEnabled({ timeout: Timeout.MEDIUM });
    await approveButton.click();
    await expect(approveButton).toBeHidden({ timeout: Timeout.MEDIUM });
  }

  async rejectProposal() {
    const rejectButton = this.page.getByTestId("reject-proposal-button").last();
    await expect(rejectButton).toBeEnabled({ timeout: Timeout.MEDIUM });
    await rejectButton.click();
    await expect(rejectButton).toBeHidden({ timeout: Timeout.MEDIUM });
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
      filesData = filesData.filter(
        (file) => !isIgnoredSnapshotFile(file.relativePath),
      );
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
    name,
    stable = true,
    timeout,
  }: {
    replaceDumpPath?: boolean;
    name?: string;
    stable?: boolean;
    timeout?: number;
  } = {}) {
    const messagesList = this.page.getByTestId("messages-list");
    if (!stable) {
      await expect(messagesList).toMatchAriaSnapshot({ timeout });
      return;
    }

    await this.expectStableMessageAriaSnapshot(async () => {
      const rawSnapshot = await messagesList.ariaSnapshot({ timeout });
      let normalizedSnapshot = normalizeMessagesAriaSnapshot(rawSnapshot);
      if (replaceDumpPath) {
        // Scrub machine-specific paths after snapshotting so React-owned DOM is not mutated.
        normalizedSnapshot = normalizedSnapshot
          .replace(
            /\.dyad\/chats\/\d+\/compaction-[^\s<"]+\.md/g,
            "[[compaction-backup-path]]",
          )
          .replace(/\[\[dyad-dump-path=([^\]]+)\]\]/g, "[[dyad-dump-path=*]]");
      }
      return `${normalizedSnapshot.trimEnd()}\n`;
    }, name);
  }

  async snapshotStableAria(
    locator: Locator,
    name: string,
    { timeout }: { timeout?: number } = {},
  ) {
    await this.expectStableMessageAriaSnapshot(async () => {
      const rawSnapshot = await locator.ariaSnapshot({ timeout });
      return `${normalizeMessagesAriaSnapshot(rawSnapshot).trimEnd()}\n`;
    }, name);
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
    removeIgnoredSnapshotFilesFromDump(parsedDump);
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
    if (parsedDump["body"]["system"]) {
      parsedDump["body"]["system"] = parsedDump["body"]["system"].map(
        (message: any) => {
          if (message.type === "text") {
            message.text = "[[SYSTEM_MESSAGE]]";
          }
          return message;
        },
      );
    }
    // Normalize tool call IDs across both raw request snapshots and prettified
    // message dumps. Anthropic direct passthrough stores tool IDs inside content
    // blocks instead of OpenAI-style message.tool_calls arrays.
    normalizeToolCallIds(parsedDump);
    normalizeMcpCallIds(parsedDump);
    if (type === "request") {
      // Normalize fileIds to be deterministic based on content
      normalizeVersionedFiles(parsedDump);
      // Normalize item_reference IDs (e.g., msg_1234567890) to be deterministic
      normalizeItemReferences(parsedDump);
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
    options?: { skipWaitForCompletion?: boolean; timeout?: number },
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
