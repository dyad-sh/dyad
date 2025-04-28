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
  ChatStreamParams,
  CreateAppParams,
  CreateAppResult,
  ListAppsResponse,
  NodeSystemInfo,
  Message,
  Version,
  SystemDebugInfo,
  LocalModel,
  LocalModelListResponse,
  TokenCountParams,
  TokenCountResult,
} from "./ipc_types";
import type { CodeProposal, ProposalResult } from "@/lib/schemas";
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
            this.chatStreams
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
        const { type, message, appId } = data as AppOutput;
        const callbacks = this.appStreams.get(appId);
        if (callbacks) {
          callbacks.onOutput({ type, message, appId });
        }
      } else {
        showError(new Error(`[IPC] Invalid app output data received: ${data}`));
      }
    });

    this.ipcRenderer.on("chat:response:end", (payload) => {
      const { chatId, updatedFiles } = payload as unknown as ChatResponseEnd;
      const callbacks = this.chatStreams.get(chatId);
      if (callbacks) {
        callbacks.onEnd({ chatId, updatedFiles });
        console.debug("chat:response:end");
        this.chatStreams.delete(chatId);
      } else {
        console.error(
          new Error(`[IPC] No callbacks found for chat ${chatId} on stream end`)
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
    try {
      const result = await this.ipcRenderer.invoke("create-app", params);
      return result as CreateAppResult;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async getApp(appId: number): Promise<App> {
    try {
      const data = await this.ipcRenderer.invoke("get-app", appId);
      return data;
    } catch (error) {
      showError(error);
      throw error;
    }
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
    try {
      const data = await this.ipcRenderer.invoke("list-apps");
      return data;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Read a file from an app directory
  public async readAppFile(appId: number, filePath: string): Promise<string> {
    try {
      const content = await this.ipcRenderer.invoke("read-app-file", {
        appId,
        filePath,
      });
      return content as string;
    } catch (error) {
      // No toast because sometimes the file will disappear.
      console.error(error);
      throw error;
    }
  }

  // Edit a file in an app directory
  public async editAppFile(
    appId: number,
    filePath: string,
    content: string
  ): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("edit-app-file", {
        appId,
        filePath,
        content,
      });
      return result as { success: boolean };
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // New method for streaming responses
  public streamMessage(
    prompt: string,
    options: {
      chatId: number;
      redo?: boolean;
      onUpdate: (messages: Message[]) => void;
      onEnd: (response: ChatResponseEnd) => void;
      onError: (error: string) => void;
    }
  ): void {
    const { chatId, onUpdate, onEnd, onError, redo } = options;
    this.chatStreams.set(chatId, { onUpdate, onEnd, onError });

    // Use invoke to start the stream and pass the chatId
    this.ipcRenderer
      .invoke("chat:stream", {
        prompt,
        chatId,
        redo,
      } satisfies ChatStreamParams)
      .catch((err) => {
        showError(err);
        onError(String(err));
        this.chatStreams.delete(chatId);
      });
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
    try {
      const chatId = await this.ipcRenderer.invoke("create-chat", appId);
      return chatId;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Open an external URL using the default browser
  public async openExternalUrl(
    url: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("open-external-url", url);
      return result as { success: boolean; error?: string };
    } catch (error) {
      showError(error);
      // Ensure a consistent return type even on invoke error
      return { success: false, error: (error as Error).message };
    }
  }

  // Run an app
  public async runApp(
    appId: number,
    onOutput: (output: AppOutput) => void
  ): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("run-app", { appId });
      this.appStreams.set(appId, { onOutput });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Stop a running app
  public async stopApp(appId: number): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("stop-app", { appId });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Restart a running app
  public async restartApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
    removeNodeModules?: boolean
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
  }): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("revert-version", {
        appId,
        previousVersionId,
      });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Checkout a specific version without creating a revert commit
  public async checkoutVersion({
    appId,
    versionId,
  }: {
    appId: number;
    versionId: string;
  }): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("checkout-version", {
        appId,
        versionId,
      });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
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
    settings: Partial<UserSettings>
  ): Promise<UserSettings> {
    try {
      const updatedSettings = await this.ipcRenderer.invoke(
        "set-user-settings",
        settings
      );
      return updatedSettings;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Delete an app and all its files
  public async deleteApp(appId: number): Promise<{ success: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("delete-app", { appId });
      return result as { success: boolean };
    } catch (error) {
      showError(error);
      throw error;
    }
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
  }): Promise<{ success: boolean; app: App }> {
    try {
      const result = await this.ipcRenderer.invoke("rename-app", {
        appId,
        appName,
        appPath,
      });
      return result as { success: boolean; app: App };
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Reset all - removes all app files, settings, and drops the database
  public async resetAll(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.ipcRenderer.invoke("reset-all");
      return result as { success: boolean; message: string };
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async addDependency({
    chatId,
    packages,
  }: {
    chatId: number;
    packages: string[];
  }): Promise<void> {
    try {
      await this.ipcRenderer.invoke("chat:add-dep", {
        chatId,
        packages,
      });
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Check Node.js and npm status
  public async getNodejsStatus(): Promise<NodeSystemInfo> {
    try {
      const result = await this.ipcRenderer.invoke("nodejs-status");
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // --- GitHub Device Flow ---
  public startGithubDeviceFlow(appId: number | null): void {
    this.ipcRenderer.invoke("github:start-flow", { appId });
  }

  public onGithubDeviceFlowUpdate(
    callback: (data: GitHubDeviceFlowUpdateData) => void
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
    callback: (data: GitHubDeviceFlowSuccessData) => void
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
    callback: (data: GitHubDeviceFlowErrorData) => void
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

  // TODO: Implement cancel method if needed
  // public cancelGithubDeviceFlow(): void {
  //   this.ipcRenderer.sendMessage("github:cancel-flow");
  // }
  // --- End GitHub Device Flow ---

  // --- GitHub Repo Management ---
  public async checkGithubRepoAvailable(
    org: string,
    repo: string
  ): Promise<{ available: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("github:is-repo-available", {
        org,
        repo,
      });
      return result;
    } catch (error: any) {
      return { available: false, error: error.message || "Unknown error" };
    }
  }

  public async createGithubRepo(
    org: string,
    repo: string,
    appId: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("github:create-repo", {
        org,
        repo,
        appId,
      });
      return result;
    } catch (error: any) {
      return { success: false, error: error.message || "Unknown error" };
    }
  }

  // Sync (push) local repo to GitHub
  public async syncGithubRepo(
    appId: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("github:push", { appId });
      return result;
    } catch (error: any) {
      return { success: false, error: error.message || "Unknown error" };
    }
  }
  // --- End GitHub Repo Management ---

  // Get the main app version
  public async getAppVersion(): Promise<string> {
    try {
      const result = await this.ipcRenderer.invoke("get-app-version");
      return result.version as string;
    } catch (error) {
      showError(error);
      throw error;
    }
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
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("approve-proposal", {
        chatId,
        messageId,
      });
      return result as { success: boolean; error?: string };
    } catch (error) {
      showError(error);
      return { success: false, error: (error as Error).message };
    }
  }

  public async rejectProposal({
    chatId,
    messageId,
  }: {
    chatId: number;
    messageId: number;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.ipcRenderer.invoke("reject-proposal", {
        chatId,
        messageId,
      });
      return result as { success: boolean; error?: string };
    } catch (error) {
      showError(error);
      return { success: false, error: (error as Error).message };
    }
  }
  // --- End Proposal Management ---

  // --- Supabase Management ---
  public async listSupabaseProjects(): Promise<any[]> {
    try {
      const projects = await this.ipcRenderer.invoke("supabase:list-projects");
      return projects;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async setSupabaseAppProject(
    project: string,
    app: number
  ): Promise<{ success: boolean; appId: number; projectId: string }> {
    try {
      const result = await this.ipcRenderer.invoke("supabase:set-app-project", {
        project,
        app,
      });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async unsetSupabaseAppProject(
    app: number
  ): Promise<{ success: boolean; appId: number }> {
    try {
      const result = await this.ipcRenderer.invoke(
        "supabase:unset-app-project",
        {
          app,
        }
      );
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }
  // --- End Supabase Management ---

  // Get system debug information
  public async getSystemDebugInfo(): Promise<SystemDebugInfo> {
    try {
      const data = await this.ipcRenderer.invoke("get-system-debug-info");
      return data;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async listLocalModels(): Promise<LocalModel[]> {
    const { models, error } = (await this.ipcRenderer.invoke(
      "local-models:list"
    )) as LocalModelListResponse;
    if (error) {
      throw new Error(error);
    }
    return models;
  }

  // Listen for deep link events
  public onDeepLinkReceived(
    callback: (data: DeepLinkData) => void
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
    params: TokenCountParams
  ): Promise<TokenCountResult> {
    try {
      const result = await this.ipcRenderer.invoke("chat:count-tokens", params);
      return result as TokenCountResult;
    } catch (error) {
      showError(error);
      throw error;
    }
  }
}
