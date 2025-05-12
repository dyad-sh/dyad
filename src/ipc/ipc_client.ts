import type { IpcRenderer } from "electron";
import {
  type ChatSummary,
  ChatSummariesSchema,
  type UserSettings,
} from "../lib/schemas";
import type {
  App,
  AppOutput,
  Chat,
  ChatResponseEnd,
  CreateAppParams,
  CreateAppResult,
  ListAppsResponse,
  NodeSystemInfo,
  Message,
  Version,
  SystemDebugInfo,
  LocalModel,
  TokenCountParams,
  TokenCountResult,
  ChatLogsData,
  BranchResult,
  LanguageModelProvider,
} from "./ipc_types";
import type { ProposalResult } from "@/lib/schemas";
import { showError } from "@/lib/toast";

export interface ChatStreamCallbacks {
  onUpdate: (messages: Message[]) => void;
  onEnd: (response: ChatResponseEnd) => void;
  onError: (error: string) => void;
}

export interface AppStreamCallbacks {
  onOutput: (output: AppOutput) => void;
}

export interface GitHubDeviceFlowUpdateData {
  userCode?: string;
  verificationUri?: string;
  message?: string;
}

export interface GitHubDeviceFlowSuccessData {
  message?: string;
}

export interface GitHubDeviceFlowErrorData {
  error: string;
}

export interface DeepLinkData {
  type: string;
  url?: string;
}

export class IpcClient {
  private static instance: IpcClient;
  private ipcRenderer: IpcRenderer;
  private chatStreams: Map<number, ChatStreamCallbacks>;
  private appStreams: Map<number, AppStreamCallbacks>;
  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.chatStreams = new Map();
    this.appStreams = new Map();
    // Set up listeners for stream events
    this.ipcRenderer.on("chat:response:chunk", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "chatId" in data &&
        "messages" in data
      ) {
        const { chatId, messages } = data as {
          chatId: number;
          messages: Message[];
        };

        const callbacks = this.chatStreams.get(chatId);
        if (callbacks) {
          callbacks.onUpdate(messages);
        } else {
          console.warn(
            `[IPC] No callbacks found for chat ${chatId}`,
            this.chatStreams,
          );
        }
      } else {
        showError(new Error(`[IPC] Invalid chunk data received: ${data}`));
      }
    });

    this.ipcRenderer.on("app:output", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "type" in data &&
        "message" in data &&
        "appId" in data
      ) {
        const { type, message, appId } = data as unknown as AppOutput;
        const callbacks = this.appStreams.get(appId);
        if (callbacks) {
          callbacks.onOutput({ type, message, appId, timestamp: Date.now() });
        }
      } else {
        showError(new Error(`[IPC] Invalid app output data received: ${data}`));
      }
    });

    this.ipcRenderer.on("chat:response:end", (payload) => {
      const { chatId } = payload as unknown as ChatResponseEnd;
      const callbacks = this.chatStreams.get(chatId);
      if (callbacks) {
        callbacks.onEnd(payload as unknown as ChatResponseEnd);
        console.debug("chat:response:end");
        this.chatStreams.delete(chatId);
      } else {
        console.error(
          new Error(
            `[IPC] No callbacks found for chat ${chatId} on stream end`,
          ),
        );
      }
    });

    this.ipcRenderer.on("chat:response:error", (error) => {
      console.debug("chat:response:error");
      if (typeof error === "string") {
        for (const [chatId, callbacks] of this.chatStreams.entries()) {
          callbacks.onError(error);
          this.chatStreams.delete(chatId);
        }
      } else {
        console.error("[IPC] Invalid error data received:", error);
      }
    });
  }

  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  public async reloadEnvPath(): Promise<void> {
    await this.ipcRenderer.invoke("reload-env-path");
  }

  // Create a new app with an initial chat
  public async createApp(params: CreateAppParams): Promise<CreateAppResult> {
    return this.ipcRenderer.invoke("create-app", params);
  }

  public async getApp(appId: number): Promise<App> {
    return this.ipcRenderer.invoke("get-app", appId);
  }

  public async getChat(chatId: number): Promise<Chat> {
    try {
      const data = await this.ipcRenderer.invoke("get-chat", chatId);
      return data;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get all chats
  public async getChats(appId?: number): Promise<ChatSummary[]> {
    try {
      const data = await this.ipcRenderer.invoke("get-chats", appId);
      return ChatSummariesSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get all apps
  public async listApps(): Promise<ListAppsResponse> {
    return this.ipcRenderer.invoke("list-apps");
  }

  public async readAppFile(appId: number, filePath: string): Promise<string> {
    return this.ipcRenderer.invoke("read-app-file", {
      appId,
      filePath,
    });
  }

  // Edit a file in an app directory
  public async editAppFile(
    appId: number,
    filePath: string,
    content: string,
  ): Promise<void> {
    await this.ipcRenderer.invoke("edit-app-file", {
      appId,
      filePath,
      content,
    });
  }

  // New method for streaming responses
  public streamMessage(
    prompt: string,
    options: {
      chatId: number;
      redo?: boolean;
      attachments?: File[];
      onUpdate: (messages: Message[]) => void;
      onEnd: (response: ChatResponseEnd) => void;
      onError: (error: string) => void;
    },
  ): void {
    const { chatId, redo, attachments, onUpdate, onEnd, onError } = options;
    this.chatStreams.set(chatId, { onUpdate, onEnd, onError });

    // Handle file attachments if provided
    if (attachments && attachments.length > 0) {
      // Process each file and convert to base64
      Promise.all(
        attachments.map(async (file) => {
          return new Promise<{ name: string; type: string; data: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  name: file.name,
                  type: file.type,
                  data: reader.result as string,
                });
              };
              reader.onerror = () =>
                reject(new Error(`Failed to read file: ${file.name}`));
              reader.readAsDataURL(file);
            },
          );
        }),
      )
        .then((fileDataArray) => {
          // Use invoke to start the stream and pass the chatId and attachments
          this.ipcRenderer
            .invoke("chat:stream", {
              prompt,
              chatId,
              redo,
              attachments: fileDataArray,
            })
            .catch((err) => {
              showError(err);
              onError(String(err));
              this.chatStreams.delete(chatId);
            });
        })
        .catch((err) => {
          showError(err);
          onError(String(err));
          this.chatStreams.delete(chatId);
        });
    } else {
      // No attachments, proceed normally
      this.ipcRenderer
        .invoke("chat:stream", {
          prompt,
          chatId,
          redo,
        })
        .catch((err) => {
          showError(err);
          onError(String(err));
          this.chatStreams.delete(chatId);
        });
    }
  }

  // Method to cancel an ongoing stream
  public cancelChatStream(chatId: number): void {
    this.ipcRenderer.invoke("chat:cancel", chatId);
    const callbacks = this.chatStreams.get(chatId);
    if (callbacks) {
      this.chatStreams.delete(chatId);
    } else {
      console.error("Tried canceling chat that doesn't exist");
    }
  }

  // Create a new chat for an app
  public async createChat(appId: number): Promise<number> {
    return this.ipcRenderer.invoke("create-chat", appId);
  }

  public async deleteChat(chatId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-chat", chatId);
  }

  public async deleteMessages(chatId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-messages", chatId);
  }

  // Open an external URL using the default browser
  public async openExternalUrl(url: string): Promise<void> {
    await this.ipcRenderer.invoke("open-external-url", url);
  }

  public async showItemInFolder(fullPath: string): Promise<void> {
    await this.ipcRenderer.invoke("show-item-in-folder", fullPath);
  }

  // Run an app
  public async runApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
  ): Promise<void> {
    await this.ipcRenderer.invoke("run-app", { appId });
    this.appStreams.set(appId, { onOutput });
  }

  // Stop a running app
  public async stopApp(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("stop-app", { appId });
  }

  // Restart a running app
  public async restartApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
    removeNodeModules?: boolean,
  ): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("restart-app", {
        appId,
        removeNodeModules,
      });
      this.appStreams.set(appId, { onOutput });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get allow-listed environment variables
  public async getEnvVars(): Promise<Record<string, string | undefined>> {
    try {
      const envVars = await this.ipcRenderer.invoke("get-env-vars");
      return envVars as Record<string, string | undefined>;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // List all versions (commits) of an app
  public async listVersions({ appId }: { appId: number }): Promise<Version[]> {
    try {
      const versions = await this.ipcRenderer.invoke("list-versions", {
        appId,
      });
      return versions;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Revert to a specific version
  public async revertVersion({
    appId,
    previousVersionId,
  }: {
    appId: number;
    previousVersionId: string;
  }): Promise<void> {
    await this.ipcRenderer.invoke("revert-version", {
      appId,
      previousVersionId,
    });
  }

  // Checkout a specific version without creating a revert commit
  public async checkoutVersion({
    appId,
    versionId,
  }: {
    appId: number;
    versionId: string;
  }): Promise<void> {
    await this.ipcRenderer.invoke("checkout-version", {
      appId,
      versionId,
    });
  }

  // Get the current branch of an app
  public async getCurrentBranch(appId: number): Promise<BranchResult> {
    return this.ipcRenderer.invoke("get-current-branch", {
      appId,
    });
  }

  // Get user settings
  public async getUserSettings(): Promise<UserSettings> {
    try {
      const settings = await this.ipcRenderer.invoke("get-user-settings");
      return settings;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Update user settings
  public async setUserSettings(
    settings: Partial<UserSettings>,
  ): Promise<UserSettings> {
    try {
      const updatedSettings = await this.ipcRenderer.invoke(
        "set-user-settings",
        settings,
      );
      return updatedSettings;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Delete an app and all its files
  public async deleteApp(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-app", { appId });
  }

  // Rename an app (update name and path)
  public async renameApp({
    appId,
    appName,
    appPath,
  }: {
    appId: number;
    appName: string;
    appPath: string;
  }): Promise<void> {
    await this.ipcRenderer.invoke("rename-app", {
      appId,
      appName,
      appPath,
    });
  }

  // Reset all - removes all app files, settings, and drops the database
  public async resetAll(): Promise<void> {
    await this.ipcRenderer.invoke("reset-all");
  }

  public async addDependency({
    chatId,
    packages,
  }: {
    chatId: number;
    packages: string[];
  }): Promise<void> {
    await this.ipcRenderer.invoke("chat:add-dep", {
      chatId,
      packages,
    });
  }

  // Check Node.js and npm status
  public async getNodejsStatus(): Promise<NodeSystemInfo> {
    return this.ipcRenderer.invoke("nodejs-status");
  }

  // --- GitHub Device Flow ---
  public startGithubDeviceFlow(appId: number | null): void {
    this.ipcRenderer.invoke("github:start-flow", { appId });
  }

  public onGithubDeviceFlowUpdate(
    callback: (data: GitHubDeviceFlowUpdateData) => void,
  ): () => void {
    const listener = (data: any) => {
      console.log("github:flow-update", data);
      callback(data as GitHubDeviceFlowUpdateData);
    };
    this.ipcRenderer.on("github:flow-update", listener);
    // Return a function to remove the listener
    return () => {
      this.ipcRenderer.removeListener("github:flow-update", listener);
    };
  }

  public onGithubDeviceFlowSuccess(
    callback: (data: GitHubDeviceFlowSuccessData) => void,
  ): () => void {
    const listener = (data: any) => {
      console.log("github:flow-success", data);
      callback(data as GitHubDeviceFlowSuccessData);
    };
    this.ipcRenderer.on("github:flow-success", listener);
    return () => {
      this.ipcRenderer.removeListener("github:flow-success", listener);
    };
  }

  public onGithubDeviceFlowError(
    callback: (data: GitHubDeviceFlowErrorData) => void,
  ): () => void {
    const listener = (data: any) => {
      console.log("github:flow-error", data);
      callback(data as GitHubDeviceFlowErrorData);
    };
    this.ipcRenderer.on("github:flow-error", listener);
    return () => {
      this.ipcRenderer.removeListener("github:flow-error", listener);
    };
  }
  // --- End GitHub Device Flow ---

  // --- GitHub Repo Management ---
  public async checkGithubRepoAvailable(
    org: string,
    repo: string,
  ): Promise<{ available: boolean; error?: string }> {
    return this.ipcRenderer.invoke("github:is-repo-available", {
      org,
      repo,
    });
  }

  public async createGithubRepo(
    org: string,
    repo: string,
    appId: number,
  ): Promise<void> {
    await this.ipcRenderer.invoke("github:create-repo", {
      org,
      repo,
      appId,
    });
  }

  // Sync (push) local repo to GitHub
  public async syncGithubRepo(
    appId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("github:push", { appId });
      return result as { success: boolean; error?: string };
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async disconnectGithubRepo(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("github:disconnect", {
      appId,
    });
  }
  // --- End GitHub Repo Management ---

  // Get the main app version
  public async getAppVersion(): Promise<string> {
    const result = await this.ipcRenderer.invoke("get-app-version");
    return result.version as string;
  }

  // Get proposal details
  public async getProposal(chatId: number): Promise<ProposalResult | null> {
    try {
      const data = await this.ipcRenderer.invoke("get-proposal", { chatId });
      // Assuming the main process returns data matching the ProposalResult interface
      // Add a type check/guard if necessary for robustness
      return data as ProposalResult | null;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Example methods for listening to events (if needed)
  // public on(channel: string, func: (...args: any[]) => void): void {

  // --- Proposal Management ---
  public async approveProposal({
    chatId,
    messageId,
  }: {
    chatId: number;
    messageId: number;
  }): Promise<{
    uncommittedFiles?: string[];
  }> {
    return this.ipcRenderer.invoke("approve-proposal", {
      chatId,
      messageId,
    });
  }

  public async rejectProposal({
    chatId,
    messageId,
  }: {
    chatId: number;
    messageId: number;
  }): Promise<void> {
    await this.ipcRenderer.invoke("reject-proposal", {
      chatId,
      messageId,
    });
  }
  // --- End Proposal Management ---

  // --- Supabase Management ---
  public async listSupabaseProjects(): Promise<any[]> {
    return this.ipcRenderer.invoke("supabase:list-projects");
  }

  public async setSupabaseAppProject(
    project: string,
    app: number,
  ): Promise<void> {
    await this.ipcRenderer.invoke("supabase:set-app-project", {
      project,
      app,
    });
  }

  public async unsetSupabaseAppProject(app: number): Promise<void> {
    await this.ipcRenderer.invoke("supabase:unset-app-project", {
      app,
    });
  }
  // --- End Supabase Management ---

  public async getSystemDebugInfo(): Promise<SystemDebugInfo> {
    return this.ipcRenderer.invoke("get-system-debug-info");
  }

  public async getChatLogs(chatId: number): Promise<ChatLogsData> {
    return this.ipcRenderer.invoke("get-chat-logs", chatId);
  }

  public async uploadToSignedUrl(
    url: string,
    contentType: string,
    data: any,
  ): Promise<void> {
    await this.ipcRenderer.invoke("upload-to-signed-url", {
      url,
      contentType,
      data,
    });
  }

  public async listLocalOllamaModels(): Promise<LocalModel[]> {
    const response = await this.ipcRenderer.invoke("local-models:list-ollama");
    return response?.models || [];
  }

  public async listLocalLMStudioModels(): Promise<LocalModel[]> {
    const response = await this.ipcRenderer.invoke(
      "local-models:list-lmstudio",
    );
    return response?.models || [];
  }

  // Listen for deep link events
  public onDeepLinkReceived(
    callback: (data: DeepLinkData) => void,
  ): () => void {
    const listener = (data: any) => {
      callback(data as DeepLinkData);
    };
    this.ipcRenderer.on("deep-link-received", listener);
    return () => {
      this.ipcRenderer.removeListener("deep-link-received", listener);
    };
  }

  // Count tokens for a chat and input
  public async countTokens(
    params: TokenCountParams,
  ): Promise<TokenCountResult> {
    try {
      const result = await this.ipcRenderer.invoke("chat:count-tokens", params);
      return result as TokenCountResult;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Window control methods
  public async minimizeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:minimize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async maximizeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:maximize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async closeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:close");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get system platform (win32, darwin, linux)
  public async getSystemPlatform(): Promise<string> {
    return this.ipcRenderer.invoke("get-system-platform");
  }

  public async getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
    return this.ipcRenderer.invoke("get-language-model-providers");
  }

  public async createCustomLanguageModelProvider({
    id,
    name,
    apiBaseUrl,
    envVarName,
  }: {
    id: string;
    name: string;
    apiBaseUrl: string;
    envVarName?: string;
  }): Promise<LanguageModelProvider> {
    return this.ipcRenderer.invoke("create-custom-language-model-provider", {
      id,
      name,
      apiBaseUrl,
      envVarName,
    });
  }

  // --- End window control methods ---
}
