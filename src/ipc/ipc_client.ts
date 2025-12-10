import type { IpcRenderer } from "electron";
import {
  type ChatSummary,
  ChatSummariesSchema,
  type UserSettings,
  type ContextPathResults,
  ChatSearchResultsSchema,
  AppSearchResultsSchema,
} from "../lib/schemas";
import type {
  AppOutput,
  Chat,
  ChatResponseEnd,
  ChatProblemsEvent,
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
  LanguageModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
  DoesReleaseNoteExistParams,
  ApproveProposalResult,
  ImportAppResult,
  ImportAppParams,
  RenameBranchParams,
  UserBudgetInfo,
  CopyAppParams,
  App,
  ComponentSelection,
  AppUpgrade,
  ProblemReport,
  EditAppFileReturnType,
  GetAppEnvVarsParams,
  SetAppEnvVarsParams,
  ConnectToExistingVercelProjectParams,
  IsVercelProjectAvailableResponse,
  CreateVercelProjectParams,
  VercelDeployment,
  GetVercelDeploymentsParams,
  DisconnectVercelProjectParams,
  SecurityReviewResult,
  IsVercelProjectAvailableParams,
  SaveVercelAccessTokenParams,
  VercelProject,
  UpdateChatParams,
  FileAttachment,
  CreateNeonProjectParams,
  NeonProject,
  GetNeonProjectParams,
  GetNeonProjectResponse,
  RevertVersionResponse,
  RevertVersionParams,
  RespondToAppInputParams,
  PromptDto,
  CreatePromptParamsDto,
  UpdatePromptParamsDto,
  McpServerUpdate,
  CreateMcpServer,
  CloneRepoParams,
  SupabaseBranch,
  SetSupabaseAppProjectParams,

  SelectNodeFolderResult,
} from "./ipc_types";
import { appsApi, chatsApi, settingsApi, githubApi, mcpApi } from "@/api/client";
import type { Template } from "../shared/templates";
import type {
  AppChatContext,
  AppSearchResult,
  ChatSearchResult,
  ProposalResult,
} from "@/lib/schemas";
import { showError } from "@/lib/toast";
import { DeepLinkData } from "./deep_link_data";

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

interface DeleteCustomModelParams {
  providerId: string;
  modelApiName: string;
}

export class IpcClient {
  private static instance: IpcClient;
  private ipcRenderer: IpcRenderer;
  private chatStreams: Map<number, ChatStreamCallbacks>;
  private appStreams: Map<number, AppStreamCallbacks>;
  private helpStreams: Map<
    string,
    {
      onChunk: (delta: string) => void;
      onEnd: () => void;
      onError: (error: string) => void;
    }
  >;
  private mcpConsentHandlers: Map<string, (payload: any) => void>;
  private constructor() {
    const electron = (window as any).electron;
    this.ipcRenderer = electron ? electron.ipcRenderer : null;
    this.chatStreams = new Map();
    this.appStreams = new Map();
    this.helpStreams = new Map();
    this.mcpConsentHandlers = new Map();

    if (!this.ipcRenderer) {
      console.warn("IpcClient: Running in browser mode, IPC methods will likely fail unless polyfilled.");
      return;
    }

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

    this.ipcRenderer.on("chat:response:error", (payload) => {
      console.debug("chat:response:error");
      if (
        payload &&
        typeof payload === "object" &&
        "chatId" in payload &&
        "error" in payload
      ) {
        const { chatId, error } = payload as { chatId: number; error: string };
        const callbacks = this.chatStreams.get(chatId);
        if (callbacks) {
          callbacks.onError(error);
          this.chatStreams.delete(chatId);
        } else {
          console.warn(
            `[IPC] No callbacks found for chat ${chatId} on error`,
            this.chatStreams,
          );
        }
      } else {
        console.error("[IPC] Invalid error data received:", payload);
      }
    });

    // Help bot events
    this.ipcRenderer.on("help:chat:response:chunk", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data &&
        "delta" in data
      ) {
        const { sessionId, delta } = data as {
          sessionId: string;
          delta: string;
        };
        const callbacks = this.helpStreams.get(sessionId);
        if (callbacks) callbacks.onChunk(delta);
      }
    });

    this.ipcRenderer.on("help:chat:response:end", (data) => {
      if (data && typeof data === "object" && "sessionId" in data) {
        const { sessionId } = data as { sessionId: string };
        const callbacks = this.helpStreams.get(sessionId);
        if (callbacks) callbacks.onEnd();
        this.helpStreams.delete(sessionId);
      }
    });
    this.ipcRenderer.on("help:chat:response:error", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data &&
        "error" in data
      ) {
        const { sessionId, error } = data as {
          sessionId: string;
          error: string;
        };
        const callbacks = this.helpStreams.get(sessionId);
        if (callbacks) callbacks.onError(error);
        this.helpStreams.delete(sessionId);
      }
    });

    // MCP tool consent request from main
    this.ipcRenderer.on("mcp:tool-consent-request", (payload) => {
      const handler = this.mcpConsentHandlers.get("consent");
      if (handler) handler(payload);
    });
  }

  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  public async restartDyad(): Promise<void> {
    await this.ipcRenderer.invoke("restart-dyad");
  }

  public async reloadEnvPath(): Promise<void> {
    await this.ipcRenderer.invoke("reload-env-path");
  }

  // Create a new app with an initial chat
  public async createApp(params: CreateAppParams): Promise<CreateAppResult> {
    if (!this.ipcRenderer) {
      return appsApi.create(params);
    }
    return this.ipcRenderer.invoke("create-app", params);
  }

  public async getApp(appId: number): Promise<App> {
    if (!this.ipcRenderer) {
      return appsApi.get(appId);
    }
    return this.ipcRenderer.invoke("get-app", appId);
  }

  public async addAppToFavorite(
    appId: number,
  ): Promise<{ isFavorite: boolean }> {
    try {
      const result = await this.ipcRenderer.invoke("add-to-favorite", {
        appId,
      });
      return result;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async getAppEnvVars(
    params: GetAppEnvVarsParams,
  ): Promise<{ key: string; value: string }[]> {
    return this.ipcRenderer.invoke("get-app-env-vars", params);
  }

  public async setAppEnvVars(params: SetAppEnvVarsParams): Promise<void> {
    return this.ipcRenderer.invoke("set-app-env-vars", params);
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
      if (!this.ipcRenderer) {
        const chats = await chatsApi.list(appId);
        return ChatSummariesSchema.parse(chats);
      }
      const data = await this.ipcRenderer.invoke("get-chats", appId);
      return ChatSummariesSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // search for chats
  public async searchChats(
    appId: number,
    query: string,
  ): Promise<ChatSearchResult[]> {
    try {
      if (!this.ipcRenderer) {
        console.warn("IpcClient: Search chats not fully implemented in web mode");
        const chats = await chatsApi.list(appId);
        return chats.filter((c: any) => c.title?.toLowerCase().includes(query.toLowerCase())).map((c: any) => ({
          id: c.id,
          appId: appId,
          title: c.title,
          createdAt: new Date(c.createdAt || Date.now()),
          matchedMessageContent: null
        }));
      }
      const data = await this.ipcRenderer.invoke("search-chats", appId, query);
      return ChatSearchResultsSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get all apps
  public async listApps(): Promise<ListAppsResponse> {
    if (!this.ipcRenderer) {
      const apps = await appsApi.list();
      return { apps, appBasePath: "" };
    }
    return this.ipcRenderer.invoke("list-apps");
  }

  // Search apps by name
  public async searchApps(searchQuery: string): Promise<AppSearchResult[]> {
    try {
      const data = await this.ipcRenderer.invoke("search-app", searchQuery);
      return AppSearchResultsSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
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
  ): Promise<EditAppFileReturnType> {
    return this.ipcRenderer.invoke("edit-app-file", {
      appId,
      filePath,
      content,
    });
  }

  // New method for streaming responses
  public streamMessage(
    prompt: string,
    options: {
      selectedComponents?: ComponentSelection[];
      chatId: number;
      redo?: boolean;
      attachments?: FileAttachment[];
      onUpdate: (messages: Message[]) => void;
      onEnd: (response: ChatResponseEnd) => void;
      onError: (error: string) => void;
      onProblems?: (problems: ChatProblemsEvent) => void;
    },
  ): void {
    const {
      chatId,
      redo,
      attachments,
      selectedComponents,
      onUpdate,
      onEnd,
      onError,
    } = options;
    this.chatStreams.set(chatId, { onUpdate, onEnd, onError });

    if (!this.ipcRenderer) {
      console.warn("IpcClient: streamMessage not fully implemented in web mode");
      onError("Chat streaming is not yet supported in the web version.");
      return;
    }

    // Handle file attachments if provided
    if (attachments && attachments.length > 0) {
      // Process each file attachment and convert to base64
      Promise.all(
        attachments.map(async (attachment) => {
          return new Promise<{
            name: string;
            type: string;
            data: string;
            attachmentType: "upload-to-codebase" | "chat-context";
          }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: attachment.file.name,
                type: attachment.file.type,
                data: reader.result as string,
                attachmentType: attachment.type,
              });
            };
            reader.onerror = () =>
              reject(new Error(`Failed to read file: ${attachment.file.name}`));
            reader.readAsDataURL(attachment.file);
          });
        }),
      )
        .then((fileDataArray) => {
          // Use invoke to start the stream and pass the chatId and attachments
          this.ipcRenderer
            .invoke("chat:stream", {
              prompt,
              chatId,
              redo,
              selectedComponents,
              attachments: fileDataArray,
            })
            .catch((err) => {
              console.error("Error streaming message:", err);
              showError(err);
              onError(String(err));
              this.chatStreams.delete(chatId);
            });
        })
        .catch((err) => {
          console.error("Error streaming message:", err);
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
          selectedComponents,
        })
        .catch((err) => {
          console.error("Error streaming message:", err);
          showError(err);
          onError(String(err));
          this.chatStreams.delete(chatId);
        });
    }
  }

  // Method to cancel an ongoing stream
  public cancelChatStream(chatId: number): void {
    this.ipcRenderer.invoke("chat:cancel", chatId);
  }

  // Create a new chat for an app
  public async createChat(appId: number): Promise<number> {
    if (!this.ipcRenderer) {
      const chat = await chatsApi.create({ appId });
      return chat.id;
    }
    return this.ipcRenderer.invoke("create-chat", appId);
  }

  public async updateChat(params: UpdateChatParams): Promise<void> {
    return this.ipcRenderer.invoke("update-chat", params);
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

  // Respond to an app input request (y/n prompts)
  public async respondToAppInput(
    params: RespondToAppInputParams,
  ): Promise<void> {
    try {
      await this.ipcRenderer.invoke("respond-to-app-input", params);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get allow-listed environment variables
  public async getEnvVars(): Promise<Record<string, string | undefined>> {
    try {
      if (!this.ipcRenderer) {
        // In web mode, we don't expose system env vars this way/yet
        return {};
      }
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
      if (!this.ipcRenderer) {
        // Not supported in web mode yet
        return [];
      }
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
  public async revertVersion(
    params: RevertVersionParams,
  ): Promise<RevertVersionResponse> {
    return this.ipcRenderer.invoke("revert-version", params);
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
    if (!this.ipcRenderer) {
      return { branch: "main", exists: true };
    }
    return this.ipcRenderer.invoke("get-current-branch", {
      appId,
    });
  }

  // Get user settings
  public async getUserSettings(): Promise<UserSettings> {
    try {
      if (!this.ipcRenderer) {
        const settings = await settingsApi.get();
        // Ensure we return the expected structure even if API returns partial
        return (settings || { providerSettings: {} }) as UserSettings;
      }
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
      if (!this.ipcRenderer) {
        const updated = await settingsApi.update(settings);
        return updated as UserSettings;
      }
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
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("rename-app", {
      appId,
      appName,
      appPath,
    });
  }

  public async copyApp(params: CopyAppParams): Promise<{ app: App }> {
    if (!this.ipcRenderer) throw new Error("Not supported in web mode");
    return this.ipcRenderer.invoke("copy-app", params);
  }

  // Reset all - removes all app files, settings, and drops the database
  public async resetAll(): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("reset-all");
  }

  public async addDependency({
    chatId,
    packages,
  }: {
    chatId: number;
    packages: string[];
  }): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("chat:add-dep", {
      chatId,
      packages,
    });
  }

  // Check Node.js and npm status
  public async getNodejsStatus(): Promise<NodeSystemInfo> {
    if (!this.ipcRenderer) {
      // Return dummy valid status for web
      return {
        nodeVersion: "20.0.0",
        pnpmVersion: "8.0.0",
        nodeDownloadUrl: ""
      };
    }
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
  public async listGithubRepos(): Promise<
    { name: string; full_name: string; private: boolean }[]
  > {
    return this.ipcRenderer.invoke("github:list-repos");
  }

  public async getGithubRepoBranches(
    owner: string,
    repo: string,
  ): Promise<{ name: string; commit: { sha: string } }[]> {
    return this.ipcRenderer.invoke("github:get-repo-branches", {
      owner,
      repo,
    });
  }

  public async connectToExistingGithubRepo(
    owner: string,
    repo: string,
    branch: string,
    appId: number,
  ): Promise<void> {
    await this.ipcRenderer.invoke("github:connect-existing-repo", {
      owner,
      repo,
      branch,
      appId,
    });
  }

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
    branch?: string,
  ): Promise<void> {
    await this.ipcRenderer.invoke("github:create-repo", {
      org,
      repo,
      appId,
      branch,
    });
  }

  // Sync (push) local repo to GitHub
  public async syncGithubRepo(
    appId: number,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("github:push", {
      appId,
      force,
    });
  }

  public async disconnectGithubRepo(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("github:disconnect", {
      appId,
    });
  }
  // --- End GitHub Repo Management ---

  // --- Vercel Token Management ---
  public async saveVercelAccessToken(
    params: SaveVercelAccessTokenParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:save-token", params);
  }
  // --- End Vercel Token Management ---

  // --- Vercel Project Management ---
  public async listVercelProjects(): Promise<VercelProject[]> {
    return this.ipcRenderer.invoke("vercel:list-projects", undefined);
  }

  public async connectToExistingVercelProject(
    params: ConnectToExistingVercelProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:connect-existing-project", params);
  }

  public async isVercelProjectAvailable(
    params: IsVercelProjectAvailableParams,
  ): Promise<IsVercelProjectAvailableResponse> {
    return this.ipcRenderer.invoke("vercel:is-project-available", params);
  }

  public async createVercelProject(
    params: CreateVercelProjectParams,
  ): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("vercel:create-project", params);
  }

  // Get Vercel Deployments
  public async getVercelDeployments(
    params: GetVercelDeploymentsParams,
  ): Promise<VercelDeployment[]> {
    if (!this.ipcRenderer) return [];
    return this.ipcRenderer.invoke("vercel:get-deployments", params);
  }

  public async disconnectVercelProject(
    params: DisconnectVercelProjectParams,
  ): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("vercel:disconnect", params);
  }
  // --- End Vercel Project Management ---

  // Get the main app version
  public async getAppVersion(): Promise<string> {
    if (!this.ipcRenderer) return "1.0.0-web";
    const result = await this.ipcRenderer.invoke("get-app-version");
    return result.version as string;
  }

  // --- MCP Client Methods ---
  public async listMcpServers() {
    if (!this.ipcRenderer) return mcpApi.listServers();
    return this.ipcRenderer.invoke("mcp:list-servers");
  }

  public async createMcpServer(params: CreateMcpServer) {
    if (!this.ipcRenderer) return mcpApi.createServer(params);
    return this.ipcRenderer.invoke("mcp:create-server", params);
  }

  public async updateMcpServer(params: McpServerUpdate) {
    if (!this.ipcRenderer) {
      if (!params.id) throw new Error("Server ID required for update");
      return mcpApi.updateServer(params.id, params);
    }
    return this.ipcRenderer.invoke("mcp:update-server", params);
  }

  public async deleteMcpServer(id: number) {
    if (!this.ipcRenderer) return mcpApi.deleteServer(id);
    return this.ipcRenderer.invoke("mcp:delete-server", id);
  }

  public async listMcpTools(serverId: number) {
    if (!this.ipcRenderer) {
      // Tools are fetched via SSE in web mode usually, or we might need an endpoint
      // For now, return empty to prevent crash
      return [];
    }
    return this.ipcRenderer.invoke("mcp:list-tools", serverId);
  }

  // Removed: upsertMcpTools and setMcpToolActive – tools are fetched dynamically at runtime

  public async getMcpToolConsents() {
    if (!this.ipcRenderer) {
      // Web mode: we'd need to fetch for all servers or have a bulk endpoint.
      // Returning empty for now.
      return [];
    }
    return this.ipcRenderer.invoke("mcp:get-tool-consents");
  }

  public async setMcpToolConsent(params: {
    serverId: number;
    toolName: string;
    consent: "ask" | "always" | "denied";
  }) {
    if (!this.ipcRenderer) return mcpApi.setConsent(params.serverId, params.toolName, params.consent);
    return this.ipcRenderer.invoke("mcp:set-tool-consent", params);
  }

  public onMcpToolConsentRequest(
    handler: (payload: {
      requestId: string;
      serverId: number;
      serverName: string;
      toolName: string;
      toolDescription?: string | null;
      inputPreview?: string | null;
    }) => void,
  ) {
    this.mcpConsentHandlers.set("consent", handler as any);
    return () => {
      this.mcpConsentHandlers.delete("consent");
    };
  }

  public respondToMcpConsentRequest(
    requestId: string,
    decision: "accept-once" | "accept-always" | "decline",
  ) {
    this.ipcRenderer.invoke("mcp:tool-consent-response", {
      requestId,
      decision,
    });
  }

  // Get proposal details
  public async getProposal(chatId: number): Promise<ProposalResult | null> {
    // In web mode, proposals are not yet supported
    if (!this.ipcRenderer) {
      console.log("IpcClient: getProposal not implemented in web mode");
      return null;
    }
    
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
  }): Promise<ApproveProposalResult> {
    if (!this.ipcRenderer) {
      throw new Error("Proposal approval is not supported in web mode");
    }
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
    if (!this.ipcRenderer) {
      throw new Error("Proposal rejection is not supported in web mode");
    }
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

  public async listSupabaseBranches(params: {
    projectId: string;
  }): Promise<SupabaseBranch[]> {
    return this.ipcRenderer.invoke("supabase:list-branches", params);
  }

  public async setSupabaseAppProject(
    params: SetSupabaseAppProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("supabase:set-app-project", params);
  }

  public async unsetSupabaseAppProject(app: number): Promise<void> {
    await this.ipcRenderer.invoke("supabase:unset-app-project", {
      app,
    });
  }

  public async fakeHandleSupabaseConnect(params: {
    appId: number;
    fakeProjectId: string;
  }): Promise<void> {
    await this.ipcRenderer.invoke(
      "supabase:fake-connect-and-set-project",
      params,
    );
  }

  // --- End Supabase Management ---

  // --- Neon Management ---
  public async fakeHandleNeonConnect(): Promise<void> {
    await this.ipcRenderer.invoke("neon:fake-connect");
  }

  public async createNeonProject(
    params: CreateNeonProjectParams,
  ): Promise<NeonProject> {
    return this.ipcRenderer.invoke("neon:create-project", params);
  }

  public async getNeonProject(
    params: GetNeonProjectParams,
  ): Promise<GetNeonProjectResponse> {
    return this.ipcRenderer.invoke("neon:get-project", params);
  }

  // --- End Neon Management ---

  // --- Portal Management ---
  public async portalMigrateCreate(params: {
    appId: number;
  }): Promise<{ output: string }> {
    if (!this.ipcRenderer) return { output: "" };
    return this.ipcRenderer.invoke("portal:migrate-create", params);
  }

  // --- End Portal Management ---

  public async getSystemDebugInfo(): Promise<SystemDebugInfo> {
    if (!this.ipcRenderer) {
      return {
        os: "web",
        arch: "web",
        release: "web",
        hostname: window.location.hostname,
        totalmem: 0,
        freemem: 0,
        cpus: [],
        uptime: 0,
        shell: navigator.userAgent,
        // Add other required fields with defaults
        nodeVersion: "n/a",
        electronVersion: "n/a",
        chromeVersion: "n/a",
        appVersion: "web",
        userDataPath: "n/a",
        logsPath: "n/a",
        appPath: "n/a",
        tempPath: "n/a",
        homePath: "n/a",
        env: {},
        networkInterfaces: {}
      } as unknown as SystemDebugInfo;
    }
    return this.ipcRenderer.invoke("get-system-debug-info");
  }

  public async getChatLogs(chatId: number): Promise<ChatLogsData> {
    if (!this.ipcRenderer) return { logs: [] } as any;
    return this.ipcRenderer.invoke("get-chat-logs", chatId);
  }

  public async uploadToSignedUrl(
    url: string,
    contentType: string,
    data: any,
  ): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("upload-to-signed-url", {
      url,
      contentType,
      data,
    });
  }

  public async listLocalOllamaModels(): Promise<LocalModel[]> {
    if (!this.ipcRenderer) return [];
    const response = await this.ipcRenderer.invoke("local-models:list-ollama");
    return response?.models || [];
  }

  public async listLocalLMStudioModels(): Promise<LocalModel[]> {
    if (!this.ipcRenderer) return [];
    const response = await this.ipcRenderer.invoke(
      "local-models:list-lmstudio",
    );
    return response?.models || [];
  }

  // Listen for deep link events
  public onDeepLinkReceived(
    callback: (data: DeepLinkData) => void,
  ): () => void {
    if (!this.ipcRenderer) {
      // Deep links not yet supported/handled in web mode
      return () => { };
    }
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
      if (!this.ipcRenderer) {
        // Mock token count for now or implement client side estimation
        return {
          estimatedTotalTokens: 0,
          actualMaxTokens: 128000,
          messageHistoryTokens: 0,
          codebaseTokens: 0,
          mentionedAppsTokens: 0,
          inputTokens: 0,
          systemPromptTokens: 0,
          contextWindow: 128000
        };
      }
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
      if (!this.ipcRenderer) return;
      await this.ipcRenderer.invoke("window:minimize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async maximizeWindow(): Promise<void> {
    try {
      if (!this.ipcRenderer) return;
      await this.ipcRenderer.invoke("window:maximize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  public async closeWindow(): Promise<void> {
    try {
      if (!this.ipcRenderer) return;
      await this.ipcRenderer.invoke("window:close");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get system platform (win32, darwin, linux)
  public async getSystemPlatform(): Promise<string> {
    if (!this.ipcRenderer) {
      // Simple client-side detection or default to linux for web
      return "linux";
    }
    return this.ipcRenderer.invoke("get-system-platform");
  }

  public async doesReleaseNoteExist(
    params: DoesReleaseNoteExistParams,
  ): Promise<{ exists: boolean; url?: string }> {
    return this.ipcRenderer.invoke("does-release-note-exist", params);
  }

  public async getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
    if (!this.ipcRenderer) {
      // In web mode, return default cloud and local providers
      const { CLOUD_PROVIDERS, LOCAL_PROVIDERS, PROVIDER_TO_ENV_VAR } = await import("./shared/language_model_constants");

      const providers: LanguageModelProvider[] = [];

      // Add cloud providers
      for (const providerKey in CLOUD_PROVIDERS) {
        if (Object.prototype.hasOwnProperty.call(CLOUD_PROVIDERS, providerKey)) {
          const providerDetails = CLOUD_PROVIDERS[providerKey];
          if (providerDetails) {
            providers.push({
              id: providerKey,
              name: providerDetails.displayName,
              hasFreeTier: providerDetails.hasFreeTier,
              websiteUrl: providerDetails.websiteUrl,
              gatewayPrefix: providerDetails.gatewayPrefix,
              secondary: providerDetails.secondary,
              envVarName: PROVIDER_TO_ENV_VAR[providerKey] ?? undefined,
              type: "cloud",
            });
          }
        }
      }

      // Add local providers
      for (const providerKey in LOCAL_PROVIDERS) {
        if (Object.prototype.hasOwnProperty.call(LOCAL_PROVIDERS, providerKey)) {
          const providerDetails = LOCAL_PROVIDERS[providerKey];
          providers.push({
            id: providerKey,
            name: providerDetails.displayName,
            hasFreeTier: providerDetails.hasFreeTier,
            type: "local",
          });
        }
      }

      return providers;
    }
    return this.ipcRenderer.invoke("get-language-model-providers");
  }

  public async getLanguageModels(params: {
    providerId: string;
  }): Promise<LanguageModel[]> {
    if (!this.ipcRenderer) {
      // In web mode, return models from constants
      const { MODEL_OPTIONS } = await import("./shared/language_model_constants");
      const models = MODEL_OPTIONS[params.providerId] || [];
      return models.map(model => ({
        ...model,
        apiName: model.name,
        type: "cloud" as const,
      }));
    }
    return this.ipcRenderer.invoke("get-language-models", params);
  }

  public async getLanguageModelsByProviders(): Promise<
    Record<string, LanguageModel[]>
  > {
    if (!this.ipcRenderer) {
      // In web mode, return models for all providers
      const providers = await this.getLanguageModelProviders();
      const record: Record<string, LanguageModel[]> = {};

      for (const provider of providers) {
        if (provider.type !== "local") {
          record[provider.id] = await this.getLanguageModels({ providerId: provider.id });
        }
      }

      return record;
    }
    return this.ipcRenderer.invoke("get-language-models-by-providers");
  }

  public async createCustomLanguageModelProvider({
    id,
    name,
    apiBaseUrl,
    envVarName,
  }: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider> {
    if (!this.ipcRenderer) throw new Error("Not supported in web mode");
    return this.ipcRenderer.invoke("create-custom-language-model-provider", {
      id,
      name,
      apiBaseUrl,
      envVarName,
    });
  }
  public async editCustomLanguageModelProvider(
    params: CreateCustomLanguageModelProviderParams,
  ): Promise<LanguageModelProvider> {
    if (!this.ipcRenderer) throw new Error("Not supported in web mode");
    return this.ipcRenderer.invoke(
      "edit-custom-language-model-provider",
      params,
    );
  }

  public async createCustomLanguageModel(
    params: CreateCustomLanguageModelParams,
  ): Promise<void> {
    if (!this.ipcRenderer) return;
    await this.ipcRenderer.invoke("create-custom-language-model", params);
  }

  public async deleteCustomLanguageModel(modelId: string): Promise<void> {
    if (!this.ipcRenderer) return;
    return this.ipcRenderer.invoke("delete-custom-language-model", modelId);
  }

  async deleteCustomModel(params: DeleteCustomModelParams): Promise<void> {
    if (!this.ipcRenderer) return;
    return this.ipcRenderer.invoke("delete-custom-model", params);
  }

  async deleteCustomLanguageModelProvider(providerId: string): Promise<void> {
    return this.ipcRenderer.invoke("delete-custom-language-model-provider", {
      providerId,
    });
  }

  public async selectAppFolder(): Promise<{
    path: string | null;
    name: string | null;
  }> {
    return this.ipcRenderer.invoke("select-app-folder");
  }

  // Add these methods to IpcClient class

  public async selectNodeFolder(): Promise<SelectNodeFolderResult> {
    return this.ipcRenderer.invoke("select-node-folder");
  }

  public async getNodePath(): Promise<string | null> {
    return this.ipcRenderer.invoke("get-node-path");
  }

  public async checkAiRules(params: {
    path: string;
  }): Promise<{ exists: boolean }> {
    return this.ipcRenderer.invoke("check-ai-rules", params);
  }

  public async getLatestSecurityReview(
    appId: number,
  ): Promise<SecurityReviewResult> {
    return this.ipcRenderer.invoke("get-latest-security-review", appId);
  }

  public async importApp(params: ImportAppParams): Promise<ImportAppResult> {
    return this.ipcRenderer.invoke("import-app", params);
  }

  async checkAppName(params: {
    appName: string;
  }): Promise<{ exists: boolean }> {
    return this.ipcRenderer.invoke("check-app-name", params);
  }

  public async renameBranch(params: RenameBranchParams): Promise<void> {
    await this.ipcRenderer.invoke("rename-branch", params);
  }

  async clearSessionData(): Promise<void> {
    return this.ipcRenderer.invoke("clear-session-data");
  }

  // Method to get user budget information
  public async getUserBudget(): Promise<UserBudgetInfo | null> {
    return this.ipcRenderer.invoke("get-user-budget");
  }

  public async getChatContextResults(params: {
    appId: number;
  }): Promise<ContextPathResults> {
    return this.ipcRenderer.invoke("get-context-paths", params);
  }

  public async setChatContext(params: {
    appId: number;
    chatContext: AppChatContext;
  }): Promise<void> {
    await this.ipcRenderer.invoke("set-context-paths", params);
  }

  public async getAppUpgrades(params: {
    appId: number;
  }): Promise<AppUpgrade[]> {
    return this.ipcRenderer.invoke("get-app-upgrades", params);
  }

  public async executeAppUpgrade(params: {
    appId: number;
    upgradeId: string;
  }): Promise<void> {
    return this.ipcRenderer.invoke("execute-app-upgrade", params);
  }

  // Capacitor methods
  public async isCapacitor(params: { appId: number }): Promise<boolean> {
    return this.ipcRenderer.invoke("is-capacitor", params);
  }

  public async syncCapacitor(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("sync-capacitor", params);
  }

  public async openIos(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("open-ios", params);
  }

  public async openAndroid(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("open-android", params);
  }

  public async checkProblems(params: {
    appId: number;
  }): Promise<ProblemReport> {
    if (!this.ipcRenderer) return { missingEnvVars: [], missingFiles: [] } as any;
    return this.ipcRenderer.invoke("check-problems", params);
  }

  // Template methods
  public async getTemplates(): Promise<Template[]> {
    if (!this.ipcRenderer) return [];
    return this.ipcRenderer.invoke("get-templates");
  }

  // --- Prompts Library ---
  public async listPrompts(): Promise<PromptDto[]> {
    if (!this.ipcRenderer) return [];
    return this.ipcRenderer.invoke("prompts:list");
  }

  public async createPrompt(params: CreatePromptParamsDto): Promise<PromptDto> {
    return this.ipcRenderer.invoke("prompts:create", params);
  }

  public async updatePrompt(params: UpdatePromptParamsDto): Promise<void> {
    await this.ipcRenderer.invoke("prompts:update", params);
  }

  public async deletePrompt(id: number): Promise<void> {
    await this.ipcRenderer.invoke("prompts:delete", id);
  }
  public async cloneRepoFromUrl(
    params: CloneRepoParams,
  ): Promise<{ app: App; hasAiRules: boolean } | { error: string }> {
    return this.ipcRenderer.invoke("github:clone-repo-from-url", params);
  }

  // --- Help bot ---
  public startHelpChat(
    sessionId: string,
    message: string,
    options: {
      onChunk: (delta: string) => void;
      onEnd: () => void;
      onError: (error: string) => void;
    },
  ): void {
    this.helpStreams.set(sessionId, options);
    this.ipcRenderer
      .invoke("help:chat:start", { sessionId, message })
      .catch((err) => {
        this.helpStreams.delete(sessionId);
        showError(err);
        options.onError(String(err));
      });
  }

  public async takeScreenshot(): Promise<void> {
    await this.ipcRenderer.invoke("take-screenshot");
  }

  public cancelHelpChat(sessionId: string): void {
    this.ipcRenderer.invoke("help:chat:cancel", sessionId).catch(() => { });
  }
}
