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
  SupabaseOrganizationInfo,
  SupabaseProject,
  DeleteSupabaseOrganizationParams,
  SelectNodeFolderResult,
  ApplyVisualEditingChangesParams,
  AnalyseComponentParams,
  AgentTool,
  SetAgentToolConsentParams,
  AgentToolConsentRequestPayload,
  AgentToolConsentResponseParams,
  TelemetryEventPayload,
  ImageStudioImage,
  ImageStudioProvider,
  VideoStudioVideo,
  VideoStudioProvider,
} from "./ipc_types";
import type { ConsoleEntry } from "../atoms/appAtoms";
import type { Template } from "../shared/templates";
import type {
  AppChatContext,
  AppSearchResult,
  ChatSearchResult,
  ProposalResult,
} from "@/lib/schemas";
import type {
  IpldInferenceReceiptInput,
  IpldReceiptRecord,
} from "@/types/ipld_receipt";
import { showError } from "@/lib/toast";
import { DeepLinkData } from "./deep_link_data";
import type {
  CollectionId,
  ModelId,
  VectorCollection,
  VectorDocument,
  VectorSearchRequest,
  VectorSearchResult,
  RAGRequest,
  RAGResponse,
  VectorBackend,
  DistanceMetric,
  ChunkingConfig,
} from "@/types/sovereign_stack_types";
import type {
  MarketplaceBrowseParams,
  MarketplaceBrowseResult,
  MarketplaceAssetDetail,
  InstallAssetRequest,
  InstallAssetResult,
  CreatorOverview,
  CreatorAssetRecord,
  EarningsBreakdown,
  CreatorAnalytics,
  UnifiedPublishPayload,
  PublishResult,
} from "@/types/publish_types";

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
  private agentConsentHandlers: Map<string, (payload: any) => void>;
  private telemetryEventHandlers: Set<(payload: TelemetryEventPayload) => void>;
  // Global handlers called for any chat stream completion (used for cleanup)
  private globalChatStreamEndHandlers: Set<(chatId: number) => void>;
  // Centralized event handler sets to avoid adding multiple ipcRenderer listeners
  private githubFlowUpdateHandlers: Set<
    (data: GitHubDeviceFlowUpdateData) => void
  >;
  private githubFlowSuccessHandlers: Set<
    (data: GitHubDeviceFlowSuccessData) => void
  >;
  private githubFlowErrorHandlers: Set<
    (data: GitHubDeviceFlowErrorData) => void
  >;
  private forceCloseHandlers: Set<(data: any) => void>;
  private agentBlueprintHandlers: Set<(data: { chatId: number; blueprint: any; intent: any }) => void>;
  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.chatStreams = new Map();
    this.appStreams = new Map();
    this.helpStreams = new Map();
    this.mcpConsentHandlers = new Map();
    this.agentConsentHandlers = new Map();
    this.telemetryEventHandlers = new Set();
    this.globalChatStreamEndHandlers = new Set();
    this.githubFlowUpdateHandlers = new Set();
    this.githubFlowSuccessHandlers = new Set();
    this.githubFlowErrorHandlers = new Set();
    this.forceCloseHandlers = new Set();
    this.agentBlueprintHandlers = new Set();
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
      // Notify global handlers (used for cleanup like clearing pending consents)
      for (const handler of this.globalChatStreamEndHandlers) {
        handler(chatId);
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
        // Notify global handlers (used for cleanup like clearing pending consents)
        for (const handler of this.globalChatStreamEndHandlers) {
          handler(chatId);
        }
      } else {
        console.error("[IPC] Invalid error data received:", payload);
      }
    });

    // Agent blueprint events (NLP → Agent Creation pipeline)
    this.ipcRenderer.on("chat:agent-blueprint", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "chatId" in data &&
        "blueprint" in data
      ) {
        for (const handler of this.agentBlueprintHandlers) {
          handler(data as unknown as { chatId: number; blueprint: any; intent: any });
        }
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

    // Agent tool consent request from main
    this.ipcRenderer.on("agent-tool:consent-request", (payload) => {
      const handler = this.agentConsentHandlers.get("consent");
      if (handler) handler(payload);
    });

    // Telemetry events from main to renderer
    this.ipcRenderer.on("telemetry:event", (payload) => {
      if (payload && typeof payload === "object" && "eventName" in payload) {
        for (const handler of this.telemetryEventHandlers) {
          handler(payload as TelemetryEventPayload);
        }
      }
    });

    // Centralized GitHub Device Flow listeners
    this.ipcRenderer.on("github:flow-update", (data) => {
      console.log("github:flow-update", data);
      for (const handler of this.githubFlowUpdateHandlers) {
        handler(data as GitHubDeviceFlowUpdateData);
      }
    });
    this.ipcRenderer.on("github:flow-success", (data) => {
      console.log("github:flow-success", data);
      for (const handler of this.githubFlowSuccessHandlers) {
        handler(data as GitHubDeviceFlowSuccessData);
      }
    });
    this.ipcRenderer.on("github:flow-error", (data) => {
      console.log("github:flow-error", data);
      for (const handler of this.githubFlowErrorHandlers) {
        handler(data as unknown as GitHubDeviceFlowErrorData);
      }
    });

    // Centralized force-close listener
    this.ipcRenderer.on("force-close-detected", (data) => {
      for (const handler of this.forceCloseHandlers) {
        handler(data);
      }
    });
  }

  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  public async restartJoy(): Promise<void> {
    await this.ipcRenderer.invoke("restart-joy");
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
      const data = await this.ipcRenderer.invoke("search-chats", appId, query);
      return ChatSearchResultsSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  // Get all apps
  public async listApps(): Promise<ListAppsResponse> {
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
    // Register the output handler BEFORE invoking run-app
    // so we don't miss any messages that arrive during startup
    this.appStreams.set(appId, { onOutput });
    await this.ipcRenderer.invoke("run-app", { appId });
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
      // Register the output handler BEFORE invoking restart-app
      // so we don't miss any messages that arrive during startup
      this.appStreams.set(appId, { onOutput });
      const result = await this.ipcRenderer.invoke("restart-app", {
        appId,
        removeNodeModules,
      });
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

  public async copyApp(params: CopyAppParams): Promise<{ app: App }> {
    return this.ipcRenderer.invoke("copy-app", params);
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
    // Use centralized handler set instead of adding new ipcRenderer listener
    this.githubFlowUpdateHandlers.add(callback);
    return () => {
      this.githubFlowUpdateHandlers.delete(callback);
    };
  }

  public onGithubDeviceFlowSuccess(
    callback: (data: GitHubDeviceFlowSuccessData) => void,
  ): () => void {
    // Use centralized handler set instead of adding new ipcRenderer listener
    this.githubFlowSuccessHandlers.add(callback);
    return () => {
      this.githubFlowSuccessHandlers.delete(callback);
    };
  }

  public onGithubDeviceFlowError(
    callback: (data: GitHubDeviceFlowErrorData) => void,
  ): () => void {
    // Use centralized handler set instead of adding new ipcRenderer listener
    this.githubFlowErrorHandlers.add(callback);
    return () => {
      this.githubFlowErrorHandlers.delete(callback);
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
    await this.ipcRenderer.invoke("vercel:create-project", params);
  }

  // Get Vercel Deployments
  public async getVercelDeployments(
    params: GetVercelDeploymentsParams,
  ): Promise<VercelDeployment[]> {
    return this.ipcRenderer.invoke("vercel:get-deployments", params);
  }

  public async disconnectVercelProject(
    params: DisconnectVercelProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:disconnect", params);
  }
  // --- End Vercel Project Management ---

  // Get the main app version
  public async getAppVersion(): Promise<string> {
    const result = await this.ipcRenderer.invoke("get-app-version");
    return result.version as string;
  }

  // --- MCP Client Methods ---
  public async listMcpServers() {
    return this.ipcRenderer.invoke("mcp:list-servers");
  }

  public async createMcpServer(params: CreateMcpServer) {
    return this.ipcRenderer.invoke("mcp:create-server", params);
  }

  public async updateMcpServer(params: McpServerUpdate) {
    return this.ipcRenderer.invoke("mcp:update-server", params);
  }

  public async deleteMcpServer(id: number) {
    return this.ipcRenderer.invoke("mcp:delete-server", id);
  }

  public async listMcpTools(serverId: number) {
    return this.ipcRenderer.invoke("mcp:list-tools", serverId);
  }

  // Removed: upsertMcpTools and setMcpToolActive – tools are fetched dynamically at runtime

  public async getMcpToolConsents() {
    return this.ipcRenderer.invoke("mcp:get-tool-consents");
  }

  public async setMcpToolConsent(params: {
    serverId: number;
    toolName: string;
    consent: "ask" | "always" | "denied";
  }) {
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

  // --- Agent Tool Methods ---
  public async getAgentTools(): Promise<AgentTool[]> {
    return this.ipcRenderer.invoke("agent-tool:get-tools");
  }

  public async setAgentToolConsent(params: SetAgentToolConsentParams) {
    return this.ipcRenderer.invoke("agent-tool:set-consent", params);
  }

  public onAgentToolConsentRequest(
    handler: (payload: AgentToolConsentRequestPayload) => void,
  ) {
    this.agentConsentHandlers.set("consent", handler as any);
    return () => {
      this.agentConsentHandlers.delete("consent");
    };
  }

  public respondToAgentConsentRequest(params: AgentToolConsentResponseParams) {
    this.ipcRenderer.invoke("agent-tool:consent-response", params);
  }

  /**
   * Subscribe to be notified when any chat stream ends (either successfully or with an error).
   * Useful for cleanup tasks like clearing pending consent requests.
   * @returns Unsubscribe function
   */
  public onChatStreamEnd(handler: (chatId: number) => void): () => void {
    this.globalChatStreamEndHandlers.add(handler);
    return () => {
      this.globalChatStreamEndHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to agent blueprint events from the NLP → Agent Creation pipeline.
   * Fired when the chat detects agent creation intent in the user's message.
   * @returns Unsubscribe function
   */
  public onAgentBlueprint(
    handler: (data: { chatId: number; blueprint: any; intent: any }) => void,
  ): () => void {
    this.agentBlueprintHandlers.add(handler);
    return () => {
      this.agentBlueprintHandlers.delete(handler);
    };
  }

  /**
   * Detect agent creation intent in a message (invoke-based, not event)
   */
  async detectAgentIntent(message: string, useLLM = false): Promise<any> {
    return this.ipcRenderer.invoke("agent:intent:detect", { message, useLLM });
  }

  /**
   * Generate an agent blueprint from an intent
   */
  async generateAgentBlueprint(
    intent: any,
    originalMessage: string,
    useLLM = false,
  ): Promise<any> {
    return this.ipcRenderer.invoke("agent:blueprint:generate", {
      intent,
      originalMessage,
      useLLM,
    });
  }

  /**
   * Full pipeline: detect intent + generate blueprint in one call
   */
  async detectAndGenerateAgent(
    message: string,
    useLLM = false,
  ): Promise<{ detected: boolean; intent: any; blueprint: any }> {
    return this.ipcRenderer.invoke("agent:pipeline:detect-and-generate", {
      message,
      useLLM,
    });
  }

  // --- Agent Builder AI System Prompt Methods ---

  /**
   * Generate a system prompt using local AI based on agent configuration
   */
  async generateAgentSystemPrompt(args: {
    name: string;
    description?: string;
    type: string;
    capabilities?: string[];
    constraints?: string[];
    personality?: string;
    domain?: string;
    outputFormat?: string;
  }): Promise<{
    success: boolean;
    systemPrompt: string;
    provider: string;
    localProcessed: boolean;
  }> {
    return this.ipcRenderer.invoke("agent-builder:generate-system-prompt", args);
  }

  /**
   * Update an existing agent's system prompt using local AI
   */
  async updateAgentSystemPromptWithAI(args: {
    agentId: string;
    instruction: string;
    mode: "refine" | "expand" | "regenerate" | "custom";
  }): Promise<{
    success: boolean;
    agent: any;
    previousPrompt: string;
    newPrompt: string;
    provider: string;
    localProcessed: boolean;
  }> {
    return this.ipcRenderer.invoke("agent-builder:update-system-prompt-with-ai", args);
  }

  /**
   * Analyze and suggest improvements for an agent's system prompt
   */
  async analyzeAgentSystemPrompt(agentId: string): Promise<{
    success: boolean;
    analysis: {
      strengths: string[];
      weaknesses: string[];
      suggestions: string[];
      clarity_score: number;
      completeness_score: number;
    };
    provider: string;
    localProcessed: boolean;
  }> {
    return this.ipcRenderer.invoke("agent-builder:analyze-system-prompt", { agentId });
  }

  /**
   * Subscribe to telemetry events from the main process.
   * Used to forward events to PostHog in the renderer.
   * @returns Unsubscribe function
   */
  public onTelemetryEvent(
    handler: (payload: TelemetryEventPayload) => void,
  ): () => void {
    this.telemetryEventHandlers.add(handler);
    return () => {
      this.telemetryEventHandlers.delete(handler);
    };
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
  }): Promise<ApproveProposalResult> {
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

  // List all connected Supabase organizations
  public async listSupabaseOrganizations(): Promise<
    SupabaseOrganizationInfo[]
  > {
    return this.ipcRenderer.invoke("supabase:list-organizations");
  }

  // Delete a Supabase organization connection
  public async deleteSupabaseOrganization(
    params: DeleteSupabaseOrganizationParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("supabase:delete-organization", params);
  }

  // List all projects from all connected organizations
  public async listAllSupabaseProjects(): Promise<SupabaseProject[]> {
    return this.ipcRenderer.invoke("supabase:list-all-projects");
  }

  public async listSupabaseBranches(params: {
    projectId: string;
    organizationSlug: string | null;
  }): Promise<SupabaseBranch[]> {
    return this.ipcRenderer.invoke("supabase:list-branches", params);
  }

  public async getSupabaseEdgeLogs(params: {
    projectId: string;
    timestampStart?: number;
    appId: number;
    organizationSlug: string | null;
  }): Promise<Array<ConsoleEntry>> {
    return this.ipcRenderer.invoke("supabase:get-edge-logs", params);
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
    return this.ipcRenderer.invoke("portal:migrate-create", params);
  }

  // --- End Portal Management ---

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
    try {
      const response = await this.ipcRenderer.invoke("local-models:list-ollama");
      const models = response?.models || [];
      console.log(`[IpcClient] Ollama models fetched: ${models.length} models`);
      return models;
    } catch (error) {
      console.error("[IpcClient] Error fetching Ollama models:", error);
      return [];
    }
  }

  public async listLocalLMStudioModels(): Promise<LocalModel[]> {
    try {
      const response = await this.ipcRenderer.invoke(
        "local-models:list-lmstudio",
      );
      const models = response?.models || [];
      console.log(`[IpcClient] LM Studio models fetched: ${models.length} models`);
      return models;
    } catch (error) {
      console.error("[IpcClient] Error fetching LM Studio models:", error);
      return [];
    }
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

  // Listen for force close detected events
  public onForceCloseDetected(
    callback: (data: {
      performanceData?: {
        timestamp: number;
        memoryUsageMB: number;
        cpuUsagePercent?: number;
        systemMemoryUsageMB?: number;
        systemMemoryTotalMB?: number;
        systemCpuPercent?: number;
      };
    }) => void,
  ): () => void {
    // Use centralized handler set instead of adding new ipcRenderer listener
    this.forceCloseHandlers.add(callback);
    return () => {
      this.forceCloseHandlers.delete(callback);
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

  public async doesReleaseNoteExist(
    params: DoesReleaseNoteExistParams,
  ): Promise<{ exists: boolean; url?: string }> {
    return this.ipcRenderer.invoke("does-release-note-exist", params);
  }

  public async getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
    return this.ipcRenderer.invoke("get-language-model-providers");
  }

  public async getLanguageModels(params: {
    providerId: string;
  }): Promise<LanguageModel[]> {
    return this.ipcRenderer.invoke("get-language-models", params);
  }

  public async getLanguageModelsByProviders(): Promise<
    Record<string, LanguageModel[]>
  > {
    return this.ipcRenderer.invoke("get-language-models-by-providers");
  }

  public async createCustomLanguageModelProvider({
    id,
    name,
    apiBaseUrl,
    envVarName,
  }: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider> {
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
    return this.ipcRenderer.invoke(
      "edit-custom-language-model-provider",
      params,
    );
  }

  public async createCustomLanguageModel(
    params: CreateCustomLanguageModelParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("create-custom-language-model", params);
  }

  public async deleteCustomLanguageModel(modelId: string): Promise<void> {
    return this.ipcRenderer.invoke("delete-custom-language-model", modelId);
  }

  async deleteCustomModel(params: DeleteCustomModelParams): Promise<void> {
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

  public async initCapacitor(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("capacitor:init", params);
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
    return this.ipcRenderer.invoke("check-problems", params);
  }

  // Template methods
  public async getTemplates(): Promise<Template[]> {
    return this.ipcRenderer.invoke("get-templates");
  }

  // --- Prompts Library ---
  public async listPrompts(): Promise<PromptDto[]> {
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

  // --- Library File Storage ---
  public async libraryUploadDialog(): Promise<any[]> {
    return this.ipcRenderer.invoke("library:upload-dialog");
  }

  public async libraryImportBuffer(params: { name: string; base64: string; mimeType?: string }): Promise<any> {
    return this.ipcRenderer.invoke("library:import-buffer", params);
  }

  public async libraryList(filters?: { storageTier?: string; mimeType?: string; search?: string; category?: string }): Promise<any[]> {
    return this.ipcRenderer.invoke("library:list", filters);
  }

  public async libraryGet(id: number): Promise<any> {
    return this.ipcRenderer.invoke("library:get", id);
  }

  public async libraryGetContent(id: number): Promise<string> {
    return this.ipcRenderer.invoke("library:get-content", id);
  }

  public async libraryUpdate(params: { id: number; name?: string; description?: string; tags?: string[]; category?: string }): Promise<any> {
    return this.ipcRenderer.invoke("library:update", params);
  }

  public async libraryDelete(id: number): Promise<void> {
    await this.ipcRenderer.invoke("library:delete", id);
  }

  public async libraryStoreToIpfs(id: number): Promise<{ cid: string; bytes: number }> {
    return this.ipcRenderer.invoke("library:store-to-ipfs", id);
  }

  public async libraryPinToRemote(id: number): Promise<{ cid: string; gateway?: string; provider?: string }> {
    return this.ipcRenderer.invoke("library:pin-to-remote", id);
  }

  public async libraryStoreToArweave(id: number): Promise<any> {
    return this.ipcRenderer.invoke("library:store-to-arweave", id);
  }

  public async libraryStoreToFilecoin(id: number): Promise<any> {
    return this.ipcRenderer.invoke("library:store-to-filecoin", id);
  }

  public async libraryStoreToCelestia(id: number, encrypt?: boolean): Promise<{ contentHash: string; height: number; encryptionKeyHex?: string }> {
    return this.ipcRenderer.invoke("library:store-to-celestia", { id, encrypt });
  }

  // --- Celestia Blob Service ---

  public async celestiaStatus(): Promise<{ available: boolean; height?: number; syncing?: boolean; balance?: { amount: string; denom: string }; walletAddress?: string; network?: string; error?: string }> {
    return this.ipcRenderer.invoke("celestia:status");
  }

  public async celestiaConfigGet(): Promise<any> {
    return this.ipcRenderer.invoke("celestia:config:get");
  }

  public async celestiaConfigUpdate(updates: Record<string, unknown>): Promise<any> {
    return this.ipcRenderer.invoke("celestia:config:update", updates);
  }

  public async celestiaBlobSubmitJson(params: { json: unknown; label?: string; dataType?: string; encrypt?: boolean }): Promise<any> {
    return this.ipcRenderer.invoke("celestia:blob:submit-json", params);
  }

  public async celestiaBlobGet(params: { contentHash: string; decryptionKeyHex?: string }): Promise<{ data: string; contentHash: string; verified: boolean; height: number } | null> {
    return this.ipcRenderer.invoke("celestia:blob:get", params);
  }

  public async celestiaBlobList(filter?: { dataType?: string; label?: string; since?: string; limit?: number }): Promise<any[]> {
    return this.ipcRenderer.invoke("celestia:blob:list", filter);
  }

  public async celestiaBlobStats(): Promise<{ totalBlobs: number; totalBytes: number; encryptedCount: number; dataTypes: Record<string, number> }> {
    return this.ipcRenderer.invoke("celestia:blob:stats");
  }

  public async celestiaBlobVerify(contentHash: string): Promise<{ verified: boolean; submission: any; error?: string }> {
    return this.ipcRenderer.invoke("celestia:blob:verify", { contentHash });
  }

  // --- NLP Pipeline ---

  public async nlpListEngines(): Promise<any> {
    return this.ipcRenderer.invoke("nlp:list-engines");
  }

  public async nlpListPipelines(): Promise<any> {
    return this.ipcRenderer.invoke("nlp:list-pipelines");
  }

  public async nlpGetPipeline(pipelineId: string): Promise<any> {
    return this.ipcRenderer.invoke("nlp:get-pipeline", pipelineId);
  }

  public async nlpSavePipeline(params: {
    name: string;
    description: string;
    engines: string[];
    config?: Record<string, Record<string, any>>;
    id?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:save-pipeline", params);
  }

  public async nlpDeletePipeline(pipelineId: string): Promise<any> {
    return this.ipcRenderer.invoke("nlp:delete-pipeline", pipelineId);
  }

  public async nlpProcessText(params: {
    text: string;
    pipeline: string | string[];
    config?: Record<string, Record<string, any>>;
    language?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:process-text", params);
  }

  public async nlpRunEngine(params: {
    text: string;
    engine: string;
    config?: Record<string, any>;
    language?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:run-engine", params);
  }

  public async nlpProcessDataset(params: {
    datasetId: string;
    pipeline: string | string[];
    config?: Record<string, Record<string, any>>;
    batchSize?: number;
    maxItems?: number;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:process-dataset", params);
  }

  public async nlpAutoTagDataset(params: {
    datasetId: string;
    includeEntities?: boolean;
    includeTopics?: boolean;
    includeSentiment?: boolean;
    includeKeywords?: boolean;
    customTags?: Array<{ key: string; value: string }>;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:auto-tag-dataset", params);
  }

  public async nlpPrepareMarketplaceListing(params: {
    datasetId: string;
    name?: string;
    description?: string;
    category?: string;
    license?: string;
    price?: number;
    currency?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:prepare-marketplace-listing", params);
  }

  public async nlpPublishDataset(params: { datasetId: string }): Promise<any> {
    return this.ipcRenderer.invoke("nlp:publish-dataset", params);
  }

  public async nlpRecommendModel(datasetId: string): Promise<any> {
    return this.ipcRenderer.invoke("nlp:recommend-model", datasetId);
  }

  // --- On-Chain Asset Bridge ---

  public async getOwnedTokens(walletAddress: string): Promise<any> {
    return this.ipcRenderer.invoke("onchain-bridge:get-owned-tokens", walletAddress);
  }

  public async importToken(params: {
    walletAddress: string;
    tokenId: string;
    metadata?: any;
    baseURI?: string;
    overrideAssetType?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("onchain-bridge:import-token", params);
  }

  public async importAllTokens(walletAddress: string): Promise<any> {
    return this.ipcRenderer.invoke("onchain-bridge:import-all", walletAddress);
  }

  public async getOnchainBridgeStatus(): Promise<any> {
    return this.ipcRenderer.invoke("onchain-bridge:status");
  }

  // --- Agent Marketplace Autonomy ---

  public async agentBrowseMarketplace(params: {
    agentId: string;
    query?: string;
    assetType?: string;
    maxPrice?: number;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:browse", params);
  }

  public async agentRequestPurchase(params: {
    agentId: string;
    listingId: string;
    tokenId: string;
    reason: string;
    maxBudget: number;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:request-purchase", params);
  }

  public async agentRequestListing(params: {
    agentId: string;
    localAssetId: string;
    assetType: string;
    price: number;
    currency?: string;
    reason: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:request-listing", params);
  }

  public async agentPendingIntents(): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:pending-intents");
  }

  public async agentResolveIntent(params: {
    intentId: string;
    action: "approve" | "reject";
    reason?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:resolve-intent", params);
  }

  public async agentBrowseModels(params?: { verified?: boolean; first?: number }): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:browse-models", params);
  }

  public async agentMyLicenses(walletAddress: string): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:my-licenses", walletAddress);
  }

  public async agentPurchaseHistory(walletAddress: string): Promise<any> {
    return this.ipcRenderer.invoke("agent-market:purchase-history", walletAddress);
  }

  // --- Goldsky Subgraph Queries ---

  public async queryMarketplaceSubgraph(query: string, variables?: Record<string, unknown>): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:query-marketplace-subgraph", query, variables);
  }

  public async queryStoresSubgraph(query: string, variables?: Record<string, unknown>): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:query-stores-subgraph", query, variables);
  }

  public async queryDropSubgraph(query: string, variables?: Record<string, unknown>): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:query-drop-subgraph", query, variables);
  }

  public async getActiveListings(): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:get-active-listings");
  }

  public async getStoreByOwner(ownerAddress: string): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:get-store-by-owner", ownerAddress);
  }

  public async getDrops(): Promise<any> {
    return this.ipcRenderer.invoke("marketplace-sync:get-drops");
  }

  // --- Neural Builder ---

  public async neuralListNetworks(): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:list-networks");
  }

  public async neuralCreateNetwork(params: { name: string; description?: string; taskType?: string }): Promise<any> {
    return this.ipcRenderer.invoke("neural:create-network", params);
  }

  public async neuralGetNetwork(id: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:get-network", id);
  }

  public async neuralUpdateNetwork(id: string, updates: Record<string, unknown>): Promise<any> {
    return this.ipcRenderer.invoke("neural:update-network", id, updates);
  }

  public async neuralDeleteNetwork(id: string): Promise<void> {
    await this.ipcRenderer.invoke("neural:delete-network", id);
  }

  public async neuralStartTraining(id: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:start-training", id);
  }

  public async neuralStopTraining(id: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:stop-training", id);
  }

  public async neuralAddLayer(networkId: string, layerType: string, afterPosition?: number): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:add-layer", networkId, layerType, afterPosition);
  }

  public async neuralRemoveLayer(networkId: string, layerId: string): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:remove-layer", networkId, layerId);
  }

  public async neuralListVersions(networkId: string): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:list-versions", networkId);
  }

  public async neuralCreateVersion(networkId: string, notes: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:create-version", networkId, notes);
  }

  public async neuralListPretrainedModels(): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:list-pretrained-models");
  }

  public async neuralApplyTransferLearning(networkId: string, baseModelId: string, frozenLayers: number): Promise<any> {
    return this.ipcRenderer.invoke("neural:apply-transfer-learning", networkId, baseModelId, frozenLayers);
  }

  public async neuralAutomlOptimize(networkId: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:automl-optimize", networkId);
  }

  public async neuralExportModel(networkId: string, format: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:export-model", networkId, format);
  }

  public async neuralGetAnalytics(networkId: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:get-analytics", networkId);
  }

  public async neuralDeployToEdge(networkId: string): Promise<any> {
    return this.ipcRenderer.invoke("neural:deploy-to-edge", networkId);
  }

  public async neuralListAbTests(): Promise<any[]> {
    return this.ipcRenderer.invoke("neural:list-ab-tests");
  }

  public async neuralCreateAbTest(params: { name: string; modelAId: string; modelBId: string; metric: string; notes: string }): Promise<any> {
    return this.ipcRenderer.invoke("neural:create-ab-test", params);
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
    this.ipcRenderer.invoke("help:chat:cancel", sessionId).catch(() => {});
  }

  // --- Visual Editing ---
  public async applyVisualEditingChanges(
    changes: ApplyVisualEditingChangesParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("apply-visual-editing-changes", changes);
  }

  public async analyzeComponent(
    params: AnalyseComponentParams,
  ): Promise<{ isDynamic: boolean; hasStaticText: boolean }> {
    return this.ipcRenderer.invoke("analyze-component", params);
  }

  // --- IPLD Receipts ---
  public async createIpldReceipt(
    input: IpldInferenceReceiptInput,
  ): Promise<IpldReceiptRecord> {
    return this.ipcRenderer.invoke("receipt:create", input);
  }

  public async listIpldReceipts(): Promise<IpldReceiptRecord[]> {
    return this.ipcRenderer.invoke("receipt:list");
  }

  public async getIpldReceipt(cid: string): Promise<IpldReceiptRecord | null> {
    return this.ipcRenderer.invoke("receipt:get", cid);
  }

  public async verifyIpldReceipt(
    cid: string,
  ): Promise<{ valid: boolean; computedCid: string }> {
    return this.ipcRenderer.invoke("receipt:verify", cid);
  }

  // --- Decentralized Deployment (4everland, Fleek, IPFS, Arweave) ---
  public async saveDecentralizedCredentials(
    platform: string,
    credentials: {
      platform: string;
      apiKey?: string;
      accessToken?: string;
      projectId?: string;
      bucketName?: string;
      walletKey?: string;
    },
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke(
      "decentralized:save-credentials",
      platform,
      credentials,
    );
  }

  public async getDecentralizedCredentials(
    platform: string,
  ): Promise<{
    platform: string;
    projectId?: string;
    bucketName?: string;
    hasApiKey: boolean;
    hasAccessToken: boolean;
  } | null> {
    return this.ipcRenderer.invoke("decentralized:get-credentials", platform);
  }

  public async removeDecentralizedCredentials(
    platform: string,
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("decentralized:remove-credentials", platform);
  }

  public async deployToDecentralized(request: {
    appId: number;
    platform: string;
    buildCommand?: string;
    outputDir?: string;
    envVars?: Record<string, string>;
    ensName?: string;
    customDomain?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    platform: string;
    deploymentId: string;
    cid?: string;
    txId?: string;
    url: string;
    gatewayUrls: string[];
    timestamp: number;
    error?: string;
  }> {
    return this.ipcRenderer.invoke("decentralized:deploy", request);
  }

  public async getDecentralizedDeployments(appId?: number): Promise<
    Array<{
      id: string;
      appId: number;
      platform: string;
      status: string;
      cid?: string;
      txId?: string;
      url: string;
      gatewayUrls: string[];
      ensName?: string;
      customDomain?: string;
      createdAt: number;
      updatedAt: number;
    }>
  > {
    return this.ipcRenderer.invoke("decentralized:get-deployments", appId);
  }

  public async getDecentralizedDeployment(deploymentId: string): Promise<{
    id: string;
    appId: number;
    platform: string;
    status: string;
    cid?: string;
    txId?: string;
    url: string;
    gatewayUrls: string[];
    ensName?: string;
    customDomain?: string;
    createdAt: number;
    updatedAt: number;
  } | null> {
    return this.ipcRenderer.invoke("decentralized:get-deployment", deploymentId);
  }

  public async checkDecentralizedPinStatus(
    cid: string,
    platform: string,
  ): Promise<{ status: string; error?: string }> {
    return this.ipcRenderer.invoke(
      "decentralized:check-pin-status",
      cid,
      platform,
    );
  }

  public async getDecentralizedPlatforms(): Promise<
    Record<
      string,
      {
        id: string;
        name: string;
        description: string;
        icon: string;
        website: string;
        features: string[];
        pricing: "free" | "freemium" | "paid";
        permanence: "permanent" | "pinned" | "temporary";
        supportsCustomDomains: boolean;
        supportsENS: boolean;
        supportsIPNS: boolean;
        requiresApiKey: boolean;
        chainSupport?: string[];
      }
    >
  > {
    return this.ipcRenderer.invoke("decentralized:get-platforms");
  }

  // --- Auto-Deploy (One-Click Deploy Pipeline) ---
  public async autoDeploy(params: {
    appId: number;
    target: "vercel" | "4everland" | "fleek" | "ipfs-pinata" | "ipfs-web3storage" | "arweave" | "spheron";
    skipCompletenessCheck?: boolean;
    buildCommand?: string;
    outputDir?: string;
  }): Promise<{
    success: boolean;
    steps: Array<{
      step: string;
      status: string;
      message: string;
      details?: string;
    }>;
    deploymentUrl?: string;
    error?: string;
    completenessReport?: {
      isComplete: boolean;
      issues: Array<{ file: string; line: number; type: string; message: string }>;
    };
  }> {
    return this.ipcRenderer.invoke("deploy:auto-deploy", params);
  }

  public async checkSiteCompleteness(appId: number): Promise<{
    isComplete: boolean;
    issues: Array<{ file: string; line: number; type: string; message: string }>;
    followUpPrompt: string | null;
  }> {
    return this.ipcRenderer.invoke("deploy:check-completeness", { appId });
  }

  public onAutoDeployProgress(
    handler: (data: {
      appId: number;
      steps: Array<{
        step: string;
        status: string;
        message: string;
        details?: string;
      }>;
    }) => void,
  ): () => void {
    return this.ipcRenderer.on("auto-deploy:progress", handler as any);
  }

  // Project Methods
  public async createProject(
    params: import("../types/project_types").CreateProjectParams
  ): Promise<import("../types/project_types").CreateProjectResult> {
    return this.ipcRenderer.invoke("project:create", params);
  }

  public async listProjects(): Promise<
    import("../types/project_types").ListProjectsResult
  > {
    return this.ipcRenderer.invoke("project:list");
  }

  public async getProject(
    projectId: number
  ): Promise<import("../types/project_types").GetProjectResult> {
    return this.ipcRenderer.invoke("project:get", projectId);
  }

  public async updateProject(
    params: import("../types/project_types").UpdateProjectParams
  ): Promise<import("../types/project_types").UpdateProjectResult> {
    return this.ipcRenderer.invoke("project:update", params);
  }

  public async deleteProject(
    params: import("../types/project_types").DeleteProjectParams
  ): Promise<import("../types/project_types").DeleteProjectResult> {
    return this.ipcRenderer.invoke("project:delete", params);
  }

  // ==========================================================================
  // Model Factory Methods (LoRA/QLoRA Training)
  // ==========================================================================

  public async getModelFactorySystemInfo(): Promise<
    import("./ipc_types").ModelFactorySystemInfo
  > {
    return this.ipcRenderer.invoke("model-factory:get-system-info");
  }

  public async createTrainingJob(
    params: import("./ipc_types").CreateTrainingJobParams
  ): Promise<import("./ipc_types").TrainingJobInfo> {
    return this.ipcRenderer.invoke("model-factory:create-job", params);
  }

  public async startTraining(jobId: string): Promise<void> {
    return this.ipcRenderer.invoke("model-factory:start-training", jobId);
  }

  public async cancelTraining(jobId: string): Promise<void> {
    return this.ipcRenderer.invoke("model-factory:cancel-training", jobId);
  }

  public async getTrainingJob(
    jobId: string
  ): Promise<import("./ipc_types").TrainingJobInfo | null> {
    return this.ipcRenderer.invoke("model-factory:get-job", jobId);
  }

  public async listTrainingJobs(): Promise<
    import("./ipc_types").TrainingJobInfo[]
  > {
    return this.ipcRenderer.invoke("model-factory:list-jobs");
  }

  public async exportTrainedModel(
    params: import("./ipc_types").ExportModelParams
  ): Promise<string> {
    return this.ipcRenderer.invoke("model-factory:export-model", params);
  }

  public async importAdapter(
    params: import("./ipc_types").ImportAdapterParams
  ): Promise<import("./ipc_types").AdapterInfo> {
    return this.ipcRenderer.invoke("model-factory:import-adapter", params);
  }

  public async listAdapters(): Promise<import("./ipc_types").AdapterInfo[]> {
    return this.ipcRenderer.invoke("model-factory:list-adapters");
  }

  public async deleteAdapter(adapterId: string): Promise<void> {
    return this.ipcRenderer.invoke("model-factory:delete-adapter", adapterId);
  }

  public onTrainingProgress(
    callback: (event: import("./ipc_types").TrainingProgressEvent) => void
  ): () => void {
    const handler = (_: unknown, event: import("./ipc_types").TrainingProgressEvent) => {
      callback(event);
    };
    this.ipcRenderer.on("model-factory:training-progress", handler);
    return () => {
      this.ipcRenderer.removeListener("model-factory:training-progress", handler);
    };
  }

  public onTrainingCompleted(
    callback: (event: { jobId: string; status: string; outputPath?: string; error?: string }) => void
  ): () => void {
    const handler = (_: unknown, event: { jobId: string; status: string; outputPath?: string; error?: string }) => {
      callback(event);
    };
    this.ipcRenderer.on("model-factory:training-completed", handler);
    return () => {
      this.ipcRenderer.removeListener("model-factory:training-completed", handler);
    };
  }

  // ==========================================================================
  // Dataset Training Center Methods
  // ==========================================================================

  public async trainOnDataset(
    params: import("./ipc_types").DatasetTrainingParams
  ): Promise<import("./ipc_types").DatasetTrainingStatus> {
    return this.ipcRenderer.invoke("training:train-on-dataset", params);
  }

  public async getDatasetTrainingStatus(
    jobId: string
  ): Promise<import("./ipc_types").DatasetTrainingStatus | null> {
    return this.ipcRenderer.invoke("training:get-status", jobId);
  }

  public async listDatasetTrainingJobs(): Promise<
    import("./ipc_types").DatasetTrainingStatus[]
  > {
    return this.ipcRenderer.invoke("training:list-jobs");
  }

  public async cancelDatasetTraining(jobId: string): Promise<void> {
    return this.ipcRenderer.invoke("training:cancel", jobId);
  }

  public async listTrainedModels(): Promise<
    import("./ipc_types").TrainedModelInfo[]
  > {
    return this.ipcRenderer.invoke("training:list-trained-models");
  }

  public async listBaseModelsForTraining(): Promise<
    import("./ipc_types").ListBaseModelsResult
  > {
    return this.ipcRenderer.invoke("training:list-base-models");
  }

  public async getTrainingSystemInfo(): Promise<
    import("./ipc_types").TrainingSystemInfo
  > {
    return this.ipcRenderer.invoke("training:get-system-info");
  }

  // ==========================================================================
  // HuggingFace Hub Methods
  // ==========================================================================

  public async hfSearchModels(
    params: import("./handlers/huggingface_handlers").HfSearchParams,
  ): Promise<import("./handlers/huggingface_handlers").HfModelInfo[]> {
    return this.ipcRenderer.invoke("hf:search-models", params);
  }

  public async hfSearchDatasets(
    params: import("./handlers/huggingface_handlers").HfSearchParams,
  ): Promise<import("./handlers/huggingface_handlers").HfDatasetInfo[]> {
    return this.ipcRenderer.invoke("hf:search-datasets", params);
  }

  public async hfModelInfo(
    modelId: string,
  ): Promise<import("./handlers/huggingface_handlers").HfModelInfo> {
    return this.ipcRenderer.invoke("hf:model-info", modelId);
  }

  public async hfDownloadModel(
    params: { modelId: string; files?: string[] },
  ): Promise<{ path: string; files: string[] }> {
    return this.ipcRenderer.invoke("hf:download-model", params);
  }

  public async hfDownloadDataset(
    params: { datasetId: string; split?: string },
  ): Promise<{ path: string }> {
    return this.ipcRenderer.invoke("hf:download-dataset", params);
  }

  public async hfPushAdapter(
    params: { adapterPath: string; repoId: string; commitMessage?: string },
  ): Promise<{ url: string }> {
    return this.ipcRenderer.invoke("hf:push-adapter", params);
  }

  public async hfAuthStatus(): Promise<{ authenticated: boolean; username?: string }> {
    return this.ipcRenderer.invoke("hf:auth-status");
  }

  public onHfDownloadProgress(
    callback: (event: import("./handlers/huggingface_handlers").HfDownloadProgress) => void,
  ): () => void {
    const handler = (_: unknown, event: import("./handlers/huggingface_handlers").HfDownloadProgress) => {
      callback(event);
    };
    this.ipcRenderer.on("hf:download-progress", handler);
    return () => {
      this.ipcRenderer.removeListener("hf:download-progress", handler);
    };
  }

  // ==========================================================================
  // Marketplace Methods
  // ==========================================================================

  public async publishModel(
    request: import("../types/marketplace_types").PublishModelRequest,
  ): Promise<import("../types/marketplace_types").PublishAppResponse> {
    return this.ipcRenderer.invoke("marketplace:publish-model", request);
  }

  // ==========================================================================
  // Agent Factory Methods (Custom AI Agents)
  // ==========================================================================

  public async createCustomAgent(
    params: import("./ipc_types").CreateCustomAgentParams
  ): Promise<import("./ipc_types").CustomAgentInfo> {
    return this.ipcRenderer.invoke("agent-factory:create", params);
  }

  public async getCustomAgent(
    agentId: string
  ): Promise<import("./ipc_types").CustomAgentInfo | null> {
    return this.ipcRenderer.invoke("agent-factory:get", agentId);
  }

  public async listCustomAgents(): Promise<
    import("./ipc_types").CustomAgentInfo[]
  > {
    return this.ipcRenderer.invoke("agent-factory:list");
  }

  public async updateCustomAgent(
    params: import("./ipc_types").UpdateCustomAgentParams
  ): Promise<import("./ipc_types").CustomAgentInfo> {
    return this.ipcRenderer.invoke("agent-factory:update", params);
  }

  public async deleteCustomAgent(agentId: string): Promise<void> {
    return this.ipcRenderer.invoke("agent-factory:delete", agentId);
  }

  public async duplicateCustomAgent(
    agentId: string
  ): Promise<import("./ipc_types").CustomAgentInfo> {
    return this.ipcRenderer.invoke("agent-factory:duplicate", agentId);
  }

  public async startAgentTraining(
    params: import("./ipc_types").StartAgentTrainingParams
  ): Promise<{ jobId: string }> {
    return this.ipcRenderer.invoke("agent-factory:start-training", params);
  }

  public async getAgentTrainingStatus(
    agentId: string
  ): Promise<{ status: string; progress: number; jobId?: string } | null> {
    return this.ipcRenderer.invoke("agent-factory:training-status", agentId);
  }

  public async cancelAgentTraining(agentId: string): Promise<void> {
    return this.ipcRenderer.invoke("agent-factory:cancel-training", agentId);
  }

  public async addAgentSkill(
    params: import("./ipc_types").AddAgentSkillParams
  ): Promise<{ skillId: string }> {
    return this.ipcRenderer.invoke("agent-factory:add-skill", params);
  }

  public async removeAgentSkill(
    agentId: string,
    skillId: string
  ): Promise<void> {
    return this.ipcRenderer.invoke("agent-factory:remove-skill", agentId, skillId);
  }

  public async listAgentSkills(agentId: string): Promise<unknown[]> {
    return this.ipcRenderer.invoke("agent-factory:list-skills", agentId);
  }

  public async addAgentTool(
    params: import("./ipc_types").AddAgentToolParams
  ): Promise<{ toolId: string }> {
    return this.ipcRenderer.invoke("agent-factory:add-tool", params);
  }

  public async removeAgentTool(agentId: string, toolId: string): Promise<void> {
    return this.ipcRenderer.invoke("agent-factory:remove-tool", agentId, toolId);
  }

  public async listAgentTools(agentId: string): Promise<unknown[]> {
    return this.ipcRenderer.invoke("agent-factory:list-tools", agentId);
  }

  public async testAgent(
    params: import("./ipc_types").TestAgentParams
  ): Promise<import("./ipc_types").TestAgentResult> {
    return this.ipcRenderer.invoke("agent-factory:test", params);
  }

  public async setAgentAdapter(
    agentId: string,
    adapterId: string | null
  ): Promise<void> {
    return this.ipcRenderer.invoke("agent-factory:set-adapter", agentId, adapterId);
  }

  public async listAgentTemplates(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      personality: string;
      systemPrompt: string;
      config: { temperature: number; maxTokens: number };
    }>
  > {
    return this.ipcRenderer.invoke("agent-factory:list-templates");
  }

  public async createAgentFromTemplate(
    templateId: string,
    params: { name: string; displayName: string; baseModelId: string }
  ): Promise<import("./ipc_types").CustomAgentInfo> {
    return this.ipcRenderer.invoke("agent-factory:create-from-template", templateId, params);
  }

  public async exportAgent(agentId: string): Promise<string> {
    return this.ipcRenderer.invoke("agent-factory:export", agentId);
  }

  public async importAgent(
    agentJson: string
  ): Promise<import("./ipc_types").CustomAgentInfo> {
    return this.ipcRenderer.invoke("agent-factory:import", agentJson);
  }

  // ===========================================================================
  // AGENT SHARING
  // ===========================================================================

  public async createAgentShareConfig(
    req: import("@/types/agent_builder").CreateShareConfigRequest,
  ): Promise<{ id: number; shareToken: string }> {
    return this.ipcRenderer.invoke("agent:share:create", req);
  }

  public async getAgentShareConfig(
    agentId: number,
  ): Promise<import("@/types/agent_builder").AgentShareConfig | null> {
    return this.ipcRenderer.invoke("agent:share:get", agentId);
  }

  public async updateAgentShareConfig(
    req: import("@/types/agent_builder").UpdateShareConfigRequest,
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("agent:share:update", req);
  }

  public async deleteAgentShareConfig(
    shareConfigId: number,
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("agent:share:delete", shareConfigId);
  }

  public async generateAgentShareCodes(
    agentId: number,
  ): Promise<import("@/types/agent_builder").ShareCodesResponse> {
    return this.ipcRenderer.invoke("agent:share:generate-codes", agentId);
  }

  public async saveAppAsAgentTemplate(
    req: import("@/types/agent_builder").SaveAppAsAgentTemplateRequest,
  ): Promise<{ agentId: number; shareToken: string }> {
    return this.ipcRenderer.invoke("agent:share:save-app-as-template", req);
  }

  // ===========================================================================
  // PRIVACY-PRESERVING INFERENCE BRIDGE
  // Local-first AI with federated fallback, no data harvesting
  // ===========================================================================

  public async initializeInferenceBridge(): Promise<
    import("../types/privacy_inference_types").InferenceBridgeState
  > {
    return this.ipcRenderer.invoke("privacy-inference:initialize");
  }

  public async getInferenceBridgeState(): Promise<
    import("../types/privacy_inference_types").InferenceBridgeState
  > {
    return this.ipcRenderer.invoke("privacy-inference:get-state");
  }

  public async updateInferenceBridgeConfig(
    config: Partial<import("../types/privacy_inference_types").InferenceBridgeConfig>
  ): Promise<import("../types/privacy_inference_types").InferenceBridgeConfig> {
    return this.ipcRenderer.invoke("privacy-inference:update-config", config);
  }

  public async getInferenceBridgeConfig(): Promise<
    import("../types/privacy_inference_types").InferenceBridgeConfig
  > {
    return this.ipcRenderer.invoke("privacy-inference:get-config");
  }

  public async privacyInfer(
    request: import("../types/privacy_inference_types").CreateInferenceRequest
  ): Promise<import("../types/privacy_inference_types").PrivacyPreservingInferenceResponse> {
    return this.ipcRenderer.invoke("privacy-inference:infer", request);
  }

  public async localComplete(
    prompt: string,
    modelId?: string
  ): Promise<import("../types/privacy_inference_types").PrivacyPreservingInferenceResponse> {
    return this.ipcRenderer.invoke("privacy-inference:local-complete", prompt, modelId);
  }

  public async agentTask(
    agentId: string,
    task: unknown
  ): Promise<import("../types/privacy_inference_types").PrivacyPreservingInferenceResponse> {
    return this.ipcRenderer.invoke("privacy-inference:agent-task", agentId, task);
  }

  public async getInferenceStats(): Promise<
    import("../types/privacy_inference_types").InferenceBridgeStats
  > {
    return this.ipcRenderer.invoke("privacy-inference:get-stats");
  }

  public async resetInferenceStats(): Promise<
    import("../types/privacy_inference_types").InferenceBridgeStats
  > {
    return this.ipcRenderer.invoke("privacy-inference:reset-stats");
  }

  public async registerInferenceAdapter(adapter: {
    id: string;
    name: string;
    baseModelId: string;
    method: string;
    path: string;
  }): Promise<boolean> {
    return this.ipcRenderer.invoke("privacy-inference:register-adapter", adapter);
  }

  public async registerInferenceAgent(agent: {
    id: string;
    name: string;
    type: string;
    modelId: string;
    adapterId?: string;
  }): Promise<boolean> {
    return this.ipcRenderer.invoke("privacy-inference:register-agent", agent);
  }

  public async addTrustedPeer(peerId: string): Promise<string[]> {
    return this.ipcRenderer.invoke("privacy-inference:add-trusted-peer", peerId);
  }

  public async removeTrustedPeer(peerId: string): Promise<string[]> {
    return this.ipcRenderer.invoke("privacy-inference:remove-trusted-peer", peerId);
  }

  public async getPrivacyProfiles(): Promise<Record<string, unknown>> {
    return this.ipcRenderer.invoke("privacy-inference:get-privacy-profiles");
  }

  public async getRoutingProfiles(): Promise<Record<string, unknown>> {
    return this.ipcRenderer.invoke("privacy-inference:get-routing-profiles");
  }

  // ===========================================================================
  // DEPLOYED CONTRACTS & NFT-GATED INFERENCE ACCESS
  // ===========================================================================

  public async configureContractClient(
    apiKey: string,
    publisherId?: string
  ): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("contracts:configure", apiKey, publisherId);
  }

  public async fetchDeployedContracts(
    query?: import("../types/deployed_contract_types").ContractQuery
  ): Promise<import("../types/deployed_contract_types").DeployedContract[]> {
    return this.ipcRenderer.invoke("contracts:fetch-deployed", query);
  }

  public async fetchInferenceAccessNFTs(
    query?: import("../types/deployed_contract_types").NFTAccessQuery
  ): Promise<import("../types/deployed_contract_types").InferenceAccessNFT[]> {
    return this.ipcRenderer.invoke("contracts:fetch-inference-nfts", query);
  }

  public async getOwnedInferenceNFTs(
    walletAddress: string
  ): Promise<import("../types/deployed_contract_types").InferenceAccessNFT[]> {
    return this.ipcRenderer.invoke("contracts:get-owned-nfts", walletAddress);
  }

  public async getContractForAsset(
    assetCid: string
  ): Promise<import("../types/deployed_contract_types").DeployedContract | null> {
    return this.ipcRenderer.invoke("contracts:get-for-asset", assetCid);
  }

  public async verifyInferenceAccess(
    request: import("../types/deployed_contract_types").InferenceAccessRequest
  ): Promise<import("../types/deployed_contract_types").InferenceAccessVerification> {
    return this.ipcRenderer.invoke("contracts:verify-access", request);
  }

  public async requestDecryptionKey(
    params: import("../types/deployed_contract_types").RequestDecryptionKeyParams
  ): Promise<import("../types/deployed_contract_types").DecryptionKeyResponse> {
    return this.ipcRenderer.invoke("contracts:request-decryption-key", params);
  }

  public async deployInferenceContract(
    request: import("../types/deployed_contract_types").DeployContractRequest
  ): Promise<import("../types/deployed_contract_types").DeployContractResult> {
    return this.ipcRenderer.invoke("contracts:deploy", request);
  }

  public async mintInferenceAccessNFT(
    request: import("../types/deployed_contract_types").MintInferenceNFTRequest
  ): Promise<import("../types/deployed_contract_types").MintInferenceNFTResult> {
    return this.ipcRenderer.invoke("contracts:mint-access-nft", request);
  }

  public async recordInferenceUsage(
    tokenId: string,
    contractAddress: string,
    usage: { inputTokens: number; outputTokens: number; computeMs: number }
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("contracts:record-usage", tokenId, contractAddress, usage);
  }

  public async getContractAuditLogs(
    contractAddress?: string,
    startDate?: string,
    endDate?: string
  ): Promise<import("../types/deployed_contract_types").ContractAuditEntry[]> {
    return this.ipcRenderer.invoke("contracts:get-audit-logs", contractAddress, startDate, endDate);
  }

  // ===========================================================================
  // HYPER LIQUID DATA PIPELINE (LOCAL → MARKETPLACE)
  // ===========================================================================

  public async getHyperLiquidPipelines(): Promise<import("../types/hyper_liquid_types").LiquidityPipelineConfig[]> {
    return this.ipcRenderer.invoke("hyper-liquid:get-pipelines");
  }

  public async getHyperLiquidPipeline(
    pipelineId: string
  ): Promise<import("../types/hyper_liquid_types").LiquidityPipelineConfig | null> {
    return this.ipcRenderer.invoke("hyper-liquid:get-pipeline", pipelineId);
  }

  public async createHyperLiquidPipeline(
    config: import("../types/hyper_liquid_types").LiquidityPipelineConfig
  ): Promise<import("../types/hyper_liquid_types").LiquidityPipelineConfig> {
    return this.ipcRenderer.invoke("hyper-liquid:create-pipeline", config);
  }

  public async updateHyperLiquidPipeline(
    config: import("../types/hyper_liquid_types").LiquidityPipelineConfig
  ): Promise<import("../types/hyper_liquid_types").LiquidityPipelineConfig> {
    return this.ipcRenderer.invoke("hyper-liquid:update-pipeline", config);
  }

  public async deleteHyperLiquidPipeline(pipelineId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:delete-pipeline", pipelineId);
  }

  public async startHyperLiquidPipeline(pipelineId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:start-pipeline", pipelineId);
  }

  public async stopHyperLiquidPipeline(
    pipelineId: string,
    graceful?: boolean
  ): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:stop-pipeline", pipelineId, graceful);
  }

  public async pauseHyperLiquidPipeline(pipelineId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:pause-pipeline", pipelineId);
  }

  public async resumeHyperLiquidPipeline(pipelineId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:resume-pipeline", pipelineId);
  }

  public async startHyperLiquidFlow(
    request: import("../types/hyper_liquid_types").StartFlowRequest
  ): Promise<import("../types/hyper_liquid_types").StartFlowResponse> {
    return this.ipcRenderer.invoke("hyper-liquid:start-flow", request);
  }

  public async batchHyperLiquidFlow(
    request: import("../types/hyper_liquid_types").BatchFlowRequest
  ): Promise<import("../types/hyper_liquid_types").BatchFlowResponse> {
    return this.ipcRenderer.invoke("hyper-liquid:batch-flow", request);
  }

  public async getHyperLiquidFlow(
    flowId: string
  ): Promise<import("../types/hyper_liquid_types").LiquidDataContainer | null> {
    return this.ipcRenderer.invoke("hyper-liquid:get-flow", flowId);
  }

  public async getHyperLiquidFlows(
    pipelineId?: string
  ): Promise<import("../types/hyper_liquid_types").LiquidDataContainer[]> {
    return this.ipcRenderer.invoke("hyper-liquid:get-flows", pipelineId);
  }

  public async cancelHyperLiquidFlow(flowId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:cancel-flow", flowId);
  }

  public async retryHyperLiquidFlow(flowId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hyper-liquid:retry-flow", flowId);
  }

  public async getHyperLiquidQueue(
    pipelineId: string
  ): Promise<import("../types/hyper_liquid_types").FlowQueue | null> {
    return this.ipcRenderer.invoke("hyper-liquid:get-queue", pipelineId);
  }

  public async getHyperLiquidQueues(): Promise<import("../types/hyper_liquid_types").FlowQueue[]> {
    return this.ipcRenderer.invoke("hyper-liquid:get-queues");
  }

  public async getHyperLiquidStats(
    period?: "hour" | "day" | "week" | "month" | "all"
  ): Promise<import("../types/hyper_liquid_types").LiquidityStats> {
    return this.ipcRenderer.invoke("hyper-liquid:get-stats", period);
  }

  public async resetHyperLiquidStats(): Promise<import("../types/hyper_liquid_types").LiquidityStats> {
    return this.ipcRenderer.invoke("hyper-liquid:reset-stats");
  }

  public async checkHyperLiquidDedup(
    dataId: string
  ): Promise<import("../types/hyper_liquid_types").ContentDeduplication> {
    return this.ipcRenderer.invoke("hyper-liquid:check-dedup", dataId);
  }

  public async getHyperLiquidCheckpoint(
    flowId: string
  ): Promise<import("../types/hyper_liquid_types").FlowCheckpoint | null> {
    return this.ipcRenderer.invoke("hyper-liquid:get-checkpoint", flowId);
  }

  public async resumeHyperLiquidFromCheckpoint(
    flowId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("hyper-liquid:resume-from-checkpoint", flowId);
  }

  public async getHyperLiquidStatus(): Promise<{
    running: boolean;
    activePipeline?: string;
    totalPipelines: number;
    totalFlows: number;
    activeFlows: number;
    stats: import("../types/hyper_liquid_types").LiquidityStats;
  }> {
    return this.ipcRenderer.invoke("hyper-liquid:status");
  }

  // =============================================================================
  // DATA VAULT
  // =============================================================================

  /**
   * Export vault entries (assets) to JSON file
   */
  public async exportDataVault(args: {
    outputPath: string;
    filter?: {
      status?: string;
      modality?: string;
      tags?: string[];
      collections?: string[];
    };
  }): Promise<{ path: string; count: number }> {
    return this.ipcRenderer.invoke("data-vault:export", args);
  }

  // =============================================================================
  // DATA SOVEREIGNTY & MONETIZATION (COMPLETE USER DATA PROTECTION)
  // =============================================================================

  /**
   * Create or get user's data sovereignty vault
   */
  public async getSovereigntyVault(
    owner: string
  ): Promise<import("../types/data_sovereignty_types").DataSovereigntyVault> {
    return this.ipcRenderer.invoke("sovereignty:get-vault", owner);
  }

  /**
   * Update vault settings
   */
  public async updateSovereigntyVault(
    vaultId: string,
    updates: Partial<import("../types/data_sovereignty_types").DataSovereigntyVault>
  ): Promise<import("../types/data_sovereignty_types").DataSovereigntyVault> {
    return this.ipcRenderer.invoke("sovereignty:update-vault", vaultId, updates);
  }

  /**
   * Protect data with encryption and access control
   */
  public async protectData(
    request: import("../types/data_sovereignty_types").ProtectDataRequest
  ): Promise<import("../types/data_sovereignty_types").ProtectDataResult> {
    return this.ipcRenderer.invoke("sovereignty:protect", request);
  }

  /**
   * Batch protect multiple files
   */
  public async batchProtectData(
    request: import("../types/data_sovereignty_types").BatchProtectRequest
  ): Promise<import("../types/data_sovereignty_types").BatchProtectResult> {
    return this.ipcRenderer.invoke("sovereignty:batch-protect", request);
  }

  /**
   * List all protected assets for an owner
   */
  public async listProtectedAssets(
    owner: string
  ): Promise<import("../types/data_sovereignty_types").ProtectedDataAsset[]> {
    return this.ipcRenderer.invoke("sovereignty:list-assets", owner);
  }

  /**
   * Get a single protected asset
   */
  public async getProtectedAsset(
    assetId: string
  ): Promise<import("../types/data_sovereignty_types").ProtectedDataAsset | null> {
    return this.ipcRenderer.invoke("sovereignty:get-asset", assetId);
  }

  /**
   * Delete a protected asset
   */
  public async deleteProtectedAsset(assetId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("sovereignty:delete-asset", assetId);
  }

  /**
   * Verify access to an asset
   */
  public async verifySovereigntyAccess(
    request: import("../types/data_sovereignty_types").VerifyAccessRequest
  ): Promise<import("../types/data_sovereignty_types").VerifyAccessResult> {
    return this.ipcRenderer.invoke("sovereignty:verify-access", request);
  }

  /**
   * Grant access to a wallet
   */
  public async grantSovereigntyAccess(
    assetId: string,
    wallet: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("sovereignty:grant-access", assetId, wallet);
  }

  /**
   * Revoke access to an asset
   */
  public async revokeSovereigntyAccess(
    request: import("../types/data_sovereignty_types").RevokeAccessRequest
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("sovereignty:revoke-access", request);
  }

  /**
   * Enable monetization on an asset
   */
  public async enableMonetization(
    assetId: string,
    config: Partial<import("../types/data_sovereignty_types").DataMonetization>
  ): Promise<{ success: boolean; asset?: import("../types/data_sovereignty_types").ProtectedDataAsset; error?: string }> {
    return this.ipcRenderer.invoke("sovereignty:enable-monetization", assetId, config);
  }

  /**
   * Update monetization settings
   */
  public async updateMonetization(
    request: import("../types/data_sovereignty_types").UpdateMonetizationRequest
  ): Promise<{ success: boolean; asset?: import("../types/data_sovereignty_types").ProtectedDataAsset; error?: string }> {
    return this.ipcRenderer.invoke("sovereignty:update-monetization", request);
  }

  /**
   * Update anti-harvesting settings
   */
  public async updateAntiHarvesting(
    vaultId: string,
    config: Partial<import("../types/data_sovereignty_types").AntiHarvestingConfig>
  ): Promise<import("../types/data_sovereignty_types").AntiHarvestingConfig> {
    return this.ipcRenderer.invoke("sovereignty:update-anti-harvesting", vaultId, config);
  }

  /**
   * Report a harvester
   */
  public async reportHarvester(identifier: string, reason: string): Promise<boolean> {
    return this.ipcRenderer.invoke("sovereignty:report-harvester", identifier, reason);
  }

  /**
   * Get blocked harvesters list
   */
  public async getHarvesterBlocklist(): Promise<string[]> {
    return this.ipcRenderer.invoke("sovereignty:get-blocklist");
  }

  /**
   * Get sovereignty analytics
   */
  public async getSovereigntyAnalytics(
    owner: string,
    period?: "day" | "week" | "month" | "year" | "all"
  ): Promise<import("../types/data_sovereignty_types").SovereigntyAnalytics> {
    return this.ipcRenderer.invoke("sovereignty:get-analytics", owner, period);
  }

  /**
   * Get access logs for an asset
   */
  public async getAccessLogs(
    assetId: string,
    limit?: number
  ): Promise<import("../types/data_sovereignty_types").AccessLogEntry[]> {
    return this.ipcRenderer.invoke("sovereignty:get-access-logs", assetId, limit);
  }

  // ─── Web Scraping ───────────────────────────────────────────────────────

  /** Initialize the scraping engine (call once) */
  public async scrapingInit(): Promise<void> {
    return this.ipcRenderer.invoke("scraping:init");
  }

  /** Get available scraping templates */
  public async scrapingTemplates(): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:templates");
  }

  /** Preview a URL before scraping */
  public async scrapingPreview(args: { url: string; templateId?: string; config?: any }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:preview", args);
  }

  /** Scrape a single URL */
  public async scrapingScrapeUrl(args: { url: string; templateId?: string; config?: any }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:scrape-url", args);
  }

  /** Create a scraping job */
  public async scrapingCreateJob(args: { name: string; config: any }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:create-job", args);
  }

  /** Start a scraping job */
  public async scrapingStartJob(jobId: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:start-job", jobId);
  }

  /** Stop a running scraping job */
  public async scrapingStopJob(jobId: string): Promise<void> {
    return this.ipcRenderer.invoke("scraping:stop-job", jobId);
  }

  /** List all scraping jobs */
  public async scrapingListJobs(): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:list-jobs");
  }

  /** Get a scraping job by ID */
  public async scrapingGetJob(jobId: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:get-job", jobId);
  }

  /** Delete a scraping job */
  public async scrapingDeleteJob(jobId: string): Promise<void> {
    return this.ipcRenderer.invoke("scraping:delete-job", jobId);
  }

  /** Parse NLP query into scraping config */
  public async scrapingNlpConfigure(args: { query: string }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:nlp-configure", args);
  }

  /** Parse an RSS/Atom feed */
  public async scrapingParseFeed(url: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:parse-feed", url);
  }

  /** Parse a sitemap */
  public async scrapingParseSitemap(url: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:parse-sitemap", url);
  }

  // ─── Scraping V3 (Orchestrator-backed) ────────────────────────────────

  /** Quick scrape a single URL with auto engine selection */
  public async scrapingV3QuickScrape(args: { url: string; engine?: string }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:quick-scrape", args);
  }

  /** Probe a URL to determine best engine */
  public async scrapingV3ProbeUrl(url: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:probe-url", url);
  }

  /** Create a persistent scraping job */
  public async scrapingV3CreateJob(args: {
    name: string;
    config: any;
    engine?: string;
    templateId?: string;
    datasetId?: string;
  }): Promise<{ jobId: string }> {
    return this.ipcRenderer.invoke("scraping:v3:create-job", args);
  }

  /** Run a queued/paused job */
  public async scrapingV3RunJob(jobId: string): Promise<{ jobId: string; status: string }> {
    return this.ipcRenderer.invoke("scraping:v3:run-job", jobId);
  }

  /** Pause a running job */
  public async scrapingV3PauseJob(jobId: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:pause-job", jobId);
  }

  /** Cancel a job */
  public async scrapingV3CancelJob(jobId: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:cancel-job", jobId);
  }

  /** Resume a paused job */
  public async scrapingV3ResumeJob(jobId: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:resume-job", jobId);
  }

  /** Delete a job and its results */
  public async scrapingV3DeleteJob(jobId: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:delete-job", jobId);
  }

  /** Get a job by ID */
  public async scrapingV3GetJob(jobId: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:get-job", jobId);
  }

  /** List all jobs, optionally filtered by status */
  public async scrapingV3ListJobs(args?: { status?: string }): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:v3:list-jobs", args);
  }

  /** Get extraction results for a job */
  public async scrapingV3GetResults(jobId: string): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:v3:get-results", jobId);
  }

  /** Export job results to file */
  public async scrapingV3Export(args: { jobId: string; format: string; stripPii?: boolean }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:export", args);
  }

  /** Detect PII in job results */
  public async scrapingV3DetectPii(jobId: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:detect-pii", jobId);
  }

  /** Create a scheduled scraping job */
  public async scrapingV3CreateSchedule(args: {
    name: string;
    jobConfig: any;
    cronExpression: string;
  }): Promise<{ id: string }> {
    return this.ipcRenderer.invoke("scraping:v3:create-schedule", args);
  }

  /** List all schedules */
  public async scrapingV3ListSchedules(): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:v3:list-schedules");
  }

  /** Toggle a schedule on/off */
  public async scrapingV3ToggleSchedule(args: { id: string; enabled: boolean }): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:toggle-schedule", args);
  }

  /** Delete a schedule */
  public async scrapingV3DeleteSchedule(id: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:delete-schedule", id);
  }

  /** Save a user template */
  public async scrapingV3CreateTemplate(args: {
    name: string;
    description: string;
    category: string;
    config: any;
  }): Promise<{ id: string }> {
    return this.ipcRenderer.invoke("scraping:v3:create-template", args);
  }

  /** List user templates */
  public async scrapingV3ListTemplates(): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:v3:list-templates");
  }

  /** Get a template by ID */
  public async scrapingV3GetTemplate(id: string): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:get-template", id);
  }

  /** Delete a user template */
  public async scrapingV3DeleteTemplate(id: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:delete-template", id);
  }

  /** List auth sessions */
  public async scrapingV3ListSessions(): Promise<any[]> {
    return this.ipcRenderer.invoke("scraping:v3:list-sessions");
  }

  /** Delete an auth session */
  public async scrapingV3DeleteSession(id: string): Promise<{ ok: boolean }> {
    return this.ipcRenderer.invoke("scraping:v3:delete-session", id);
  }

  /** Import cookies as a session */
  public async scrapingV3ImportCookies(args: {
    name: string;
    domain: string;
    cookieFileContent: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("scraping:v3:import-cookies", args);
  }

  /** Import scraped dataset items into the local vault */
  public async importDatasetItems(args: {
    datasetId: string;
    markReady?: boolean;
    tags?: string[];
  }): Promise<{ imported: number; skipped: number; assetIds: string[] }> {
    return this.ipcRenderer.invoke("local-vault:import:dataset-items", args);
  }

  // ===========================================================================
  // Vector Store (sqlite-vec)
  // ===========================================================================

  /** Initialize the vector store backend */
  public async vectorInit(): Promise<{ success: boolean; backend: string }> {
    return this.ipcRenderer.invoke("vector:init");
  }

  /** Create a new vector collection */
  public async vectorCreateCollection(params: {
    name: string;
    description?: string;
    embeddingModel?: string;
    dimension?: number;
    distanceMetric?: DistanceMetric;
    backend?: VectorBackend;
    chunkingConfig?: ChunkingConfig;
  }): Promise<VectorCollection> {
    return this.ipcRenderer.invoke("vector:create-collection", params);
  }

  /** List all vector collections */
  public async vectorListCollections(): Promise<VectorCollection[]> {
    return this.ipcRenderer.invoke("vector:list-collections");
  }

  /** Get a specific vector collection by ID */
  public async vectorGetCollection(id: string): Promise<VectorCollection | null> {
    return this.ipcRenderer.invoke("vector:get-collection", id);
  }

  /** Delete a vector collection */
  public async vectorDeleteCollection(id: string): Promise<void> {
    return this.ipcRenderer.invoke("vector:delete-collection", id);
  }

  /** Add documents to a vector collection */
  public async vectorAddDocuments(args: {
    collectionId: string;
    documents: Array<{
      content: string;
      title?: string;
      metadata?: Record<string, unknown>;
      source?: string;
    }>;
  }): Promise<{ added: number; documentIds: string[] }> {
    return this.ipcRenderer.invoke("vector:add-documents", args);
  }

  /** Delete a document from a vector collection */
  public async vectorDeleteDocument(args: {
    collectionId: string;
    documentId: string;
  }): Promise<void> {
    return this.ipcRenderer.invoke("vector:delete-document", args);
  }

  /** List documents in a vector collection */
  public async vectorListDocuments(collectionId: string): Promise<VectorDocument[]> {
    return this.ipcRenderer.invoke("vector:list-documents", collectionId);
  }

  /** Search vectors in a collection */
  public async vectorSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    return this.ipcRenderer.invoke("vector:search", request);
  }

  /** Perform RAG (Retrieval-Augmented Generation) */
  public async vectorRag(request: RAGRequest): Promise<RAGResponse> {
    return this.ipcRenderer.invoke("vector:rag", request);
  }

  /** Get stats for a vector collection */
  public async vectorGetStats(collectionId: string): Promise<{
    documentCount: number;
    chunkCount: number;
    vectorCount: number;
    totalSize: number;
    indexType: string;
    dimension: number;
  }> {
    return this.ipcRenderer.invoke("vector:get-stats", collectionId);
  }

  /** Set the embedding model for vector operations */
  public async vectorSetEmbeddingModel(modelId: string): Promise<void> {
    return this.ipcRenderer.invoke("vector:set-embedding-model", modelId);
  }

  // ===========================================================================
  // Embedding Pipeline
  // ===========================================================================

  /** Initialize the embedding pipeline (detect Ollama models, etc.) */
  public async embeddingInit(): Promise<{
    initialized: boolean;
    embeddingModel: { id: string; name: string; dimension: number; provider: string; available: boolean } | null;
    ollamaAvailable: boolean;
    collectionCount: number;
    totalDocuments: number;
    activeIngestions: number;
  }> {
    return this.ipcRenderer.invoke("embedding:init");
  }

  /** Detect available embedding models */
  public async embeddingDetectModels(): Promise<Array<{
    id: string;
    name: string;
    dimension: number;
    maxTokens: number;
    provider: string;
    available: boolean;
  }>> {
    return this.ipcRenderer.invoke("embedding:detect-models");
  }

  /** Set the embedding model */
  public async embeddingSetModel(modelId: string): Promise<{
    id: string;
    name: string;
    dimension: number;
    provider: string;
    available: boolean;
  }> {
    return this.ipcRenderer.invoke("embedding:set-model", modelId);
  }

  /** Get pipeline status */
  public async embeddingGetStatus(): Promise<{
    initialized: boolean;
    embeddingModel: { id: string; name: string; dimension: number; provider: string; available: boolean } | null;
    ollamaAvailable: boolean;
    collectionCount: number;
    totalDocuments: number;
    activeIngestions: number;
  }> {
    return this.ipcRenderer.invoke("embedding:get-status");
  }

  /** Ingest a single document (chunk → embed → store) */
  public async embeddingIngestDocument(request: {
    collectionId: string;
    content: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    chunkingConfig?: ChunkingConfig;
  }): Promise<{ documentId: string; chunkCount: number; embeddingDimension: number; durationMs: number }> {
    return this.ipcRenderer.invoke("embedding:ingest-document", request);
  }

  /** Ingest a local file */
  public async embeddingIngestFile(request: {
    collectionId: string;
    filePath: string;
    metadata?: Record<string, unknown>;
    chunkingConfig?: ChunkingConfig;
  }): Promise<{ documentId: string; chunkCount: number; embeddingDimension: number; durationMs: number }> {
    return this.ipcRenderer.invoke("embedding:ingest-file", request);
  }

  /** Ingest a URL */
  public async embeddingIngestUrl(request: {
    collectionId: string;
    url: string;
    metadata?: Record<string, unknown>;
    chunkingConfig?: ChunkingConfig;
    extractText?: boolean;
  }): Promise<{ documentId: string; chunkCount: number; embeddingDimension: number; durationMs: number }> {
    return this.ipcRenderer.invoke("embedding:ingest-url", request);
  }

  /** Batch ingest multiple documents */
  public async embeddingIngestBatch(request: {
    collectionId: string;
    documents: Array<{
      content: string;
      title?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    }>;
    chunkingConfig?: ChunkingConfig;
    concurrency?: number;
  }): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{ documentId: string; chunkCount: number; embeddingDimension: number; durationMs: number }>;
    errors: Array<{ index: number; error: string }>;
    durationMs: number;
  }> {
    return this.ipcRenderer.invoke("embedding:ingest-batch", request);
  }

  /** Retrieve relevant chunks for a query */
  public async embeddingRetrieve(request: {
    collectionIds: string[];
    query: string;
    topK?: number;
    minScore?: number;
    queryEmbedding?: number[];
  }): Promise<{
    chunks: Array<{
      content: string;
      score: number;
      documentId: string;
      documentTitle?: string;
      source?: string;
      chunkIndex: number;
      metadata?: Record<string, unknown>;
    }>;
    contextString: string;
    totalChunks: number;
    queryDurationMs: number;
  }> {
    return this.ipcRenderer.invoke("embedding:retrieve", request);
  }

  /** Retrieve formatted context for chat injection */
  public async embeddingRetrieveForChat(args: {
    query: string;
    collectionIds: string[];
    topK?: number;
    minScore?: number;
  }): Promise<string> {
    return this.ipcRenderer.invoke("embedding:retrieve-for-chat", args);
  }

  /** Generate embedding for a single query */
  public async embeddingEmbedQuery(query: string): Promise<number[]> {
    return this.ipcRenderer.invoke("embedding:embed-query", query);
  }

  /** Cancel all active ingestion operations */
  public async embeddingCancelAll(): Promise<{ cancelled: boolean }> {
    return this.ipcRenderer.invoke("embedding:cancel-all");
  }

  // ===== Model Download Manager =====

  /** Detect system hardware (GPU, RAM, CPU) */
  public async modelManagerDetectHardware(): Promise<any> {
    return this.ipcRenderer.invoke("model-manager:detect-hardware");
  }

  /** Get full model catalog */
  public async modelManagerGetCatalog(): Promise<any[]> {
    return this.ipcRenderer.invoke("model-manager:get-catalog");
  }

  /** Get model catalog filtered by detected hardware */
  public async modelManagerGetFilteredCatalog(): Promise<any[]> {
    return this.ipcRenderer.invoke("model-manager:get-filtered-catalog");
  }

  /** Pull a model from Ollama (streams progress via model-manager:pull-progress) */
  public async modelManagerPullModel(
    modelId: string,
  ): Promise<{ success: boolean; modelId: string }> {
    return this.ipcRenderer.invoke("model-manager:pull-model", modelId);
  }

  /** Delete a model from Ollama */
  public async modelManagerDeleteModel(
    modelId: string,
  ): Promise<{ success: boolean; modelId: string }> {
    return this.ipcRenderer.invoke("model-manager:delete-model", modelId);
  }

  /** List installed Ollama models */
  public async modelManagerListInstalled(): Promise<any[]> {
    return this.ipcRenderer.invoke("model-manager:list-installed");
  }

  /** Get current pull status for all active downloads */
  public async modelManagerGetPullStatus(): Promise<
    Record<string, { progress: number; status: string; durationMs: number }>
  > {
    return this.ipcRenderer.invoke("model-manager:get-pull-status");
  }

  /** Listen for model pull progress events */
  public onModelPullProgress(
    callback: (data: {
      modelId: string;
      progress: number;
      status: string;
      total?: number;
      completed?: number;
    }) => void,
  ): () => void {
    const handler = (_event: any, data: any) => callback(data);
    this.ipcRenderer.on("model-manager:pull-progress", handler);
    return () =>
      this.ipcRenderer.removeListener("model-manager:pull-progress", handler);
  }

  /** Listen for model pull completion events */
  public onModelPullComplete(
    callback: (data: { modelId: string }) => void,
  ): () => void {
    const handler = (_event: any, data: any) => callback(data);
    this.ipcRenderer.on("model-manager:pull-complete", handler);
    return () =>
      this.ipcRenderer.removeListener("model-manager:pull-complete", handler);
  }

  // ===== Agent UI Builder =====

  /** Get available UI templates for an agent type */
  public async getAgentUITemplates(agentType?: string): Promise<any[]> {
    return this.ipcRenderer.invoke("agent:ui:templates", agentType);
  }

  /** Get available color themes */
  public async getAgentUIThemes(): Promise<
    Array<{ id: string; name: string; colors: any }>
  > {
    return this.ipcRenderer.invoke("agent:ui:themes");
  }

  /** Get recommended UI config for an agent */
  public async getRecommendedUIConfig(args: {
    agentType: string;
    hasTools: boolean;
    hasKnowledge: boolean;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent:ui:recommend-config", args);
  }

  /** Generate agent UI from configuration */
  public async generateAgentUI(request: {
    agentId: string;
    agentType: string;
    templateId?: string;
    theme?: string;
    customConfig?: any;
    tools?: Array<{ id: string; name: string }>;
    knowledgeSources?: Array<{ id: string; name: string; type: string }>;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent:ui:generate", request);
  }

  /** Export generated UI to code */
  public async exportAgentUI(request: {
    generatedUI: any;
    format: "react" | "vue" | "html";
  }): Promise<{ code: string; format: string }> {
    return this.ipcRenderer.invoke("agent:ui:export", request);
  }

  /** Preview a template without generating for an agent */
  public async previewUITemplate(
    templateId: string,
  ): Promise<{ template: any; preview: any }> {
    return this.ipcRenderer.invoke("agent:ui:preview-template", templateId);
  }

  /** Create config from template with custom overrides */
  public async createUIConfigFromTemplate(args: {
    templateId: string;
    overrides?: any;
  }): Promise<any> {
    return this.ipcRenderer.invoke("agent:ui:create-config", args);
  }

  // =========================================================================
  // OpenClaw Kanban
  // =========================================================================

  /** List kanban tasks with optional filters */
  public async listKanbanTasks(filters?: {
    status?: string | string[];
    taskType?: string;
    priority?: string;
    assignee?: string;
    label?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:list", filters);
  }

  /** Get a single kanban task */
  public async getKanbanTask(taskId: string): Promise<any> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:get", taskId);
  }

  /** Create a new kanban task */
  public async createKanbanTask(params: {
    title: string;
    description?: string;
    status?: string;
    taskType?: string;
    priority?: string;
    provider?: string;
    model?: string;
    agentId?: string;
    workflowId?: string;
    parentTaskId?: string;
    labels?: string[];
    assignee?: string;
  }): Promise<any> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:create", params);
  }

  /** Update an existing kanban task */
  public async updateKanbanTask(params: {
    id: string;
    [key: string]: any;
  }): Promise<any> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:update", params);
  }

  /** Delete a kanban task */
  public async deleteKanbanTask(taskId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:delete", taskId);
  }

  /** Move a task to a new column/status */
  public async moveKanbanTask(params: {
    taskId: string;
    status: string;
    sortOrder: number;
  }): Promise<any> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:move", params);
  }

  /** List activity log entries */
  public async listKanbanActivity(params: {
    taskId?: string;
    limit?: number;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("openclaw:kanban:activity:list", params);
  }

  /** Get kanban analytics & metrics */
  public async getKanbanAnalytics(): Promise<any> {
    return this.ipcRenderer.invoke("openclaw:kanban:analytics");
  }

  /** List available models from registry + local Ollama */
  public async listAvailableModels(filters?: {
    taskType?: string;
    source?: string;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("openclaw:kanban:models:list", filters);
  }

  /** Rate a completed kanban task (1-5 scale, feeds MAB + flywheel) */
  public async rateKanbanTask(params: {
    taskId: string;
    rating: number;
    feedback?: string;
  }): Promise<{ success: boolean; rating: number }> {
    return this.ipcRenderer.invoke("openclaw:kanban:tasks:rate", params);
  }

  // ── OpenClaw Activity Log ──

  /** Log a single activity event */
  public async logActivity(params: {
    eventType: string;
    channel?: string;
    channelMessageId?: string;
    actor?: string;
    actorDisplayName?: string;
    content?: string;
    contentType?: string;
    provider?: string;
    model?: string;
    agentId?: string;
    taskId?: string;
    workflowId?: string;
    tokensUsed?: number;
    durationMs?: number;
    localProcessed?: boolean;
    direction?: "inbound" | "outbound" | "internal";
    metadataJson?: Record<string, unknown>;
    externalEventId?: string;
  }): Promise<{ id: string }> {
    return this.ipcRenderer.invoke("openclaw:activity:log", params);
  }

  /** Log a batch of activity events (for syncing historical data) */
  public async logActivityBatch(entries: Array<{
    eventType: string;
    channel?: string;
    actor?: string;
    content?: string;
    direction?: "inbound" | "outbound" | "internal";
    externalEventId?: string;
    metadataJson?: Record<string, unknown>;
    [key: string]: unknown;
  }>): Promise<{ inserted: number }> {
    return this.ipcRenderer.invoke("openclaw:activity:log-batch", entries);
  }

  /** List activity log entries with filtering */
  public async listActivity(filters?: {
    eventType?: string | string[];
    channel?: string | string[];
    actor?: string;
    direction?: "inbound" | "outbound" | "internal";
    search?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("openclaw:activity:list", filters);
  }

  /** Get activity statistics */
  public async getActivityStats(since?: number): Promise<{
    totalEvents: number;
    byType: Record<string, number>;
    byChannel: Record<string, number>;
    totalTokens: number;
    totalMessages: number;
  }> {
    return this.ipcRenderer.invoke("openclaw:activity:stats", since);
  }

  /** Save a channel message (Discord, Telegram, etc.) */
  public async saveChannelMessage(params: {
    channel: string;
    channelMessageId?: string;
    channelId?: string;
    channelName?: string;
    senderId: string;
    senderName: string;
    senderAvatar?: string;
    isBot?: boolean;
    content: string;
    contentType?: string;
    attachmentsJson?: Array<{ type: string; url: string; name?: string; size?: number }>;
    replyToMessageId?: string;
    replyToContent?: string;
    botResponseId?: string;
    provider?: string;
    model?: string;
    tokensUsed?: number;
    durationMs?: number;
    platformTimestamp?: number;
  }): Promise<{ id: string }> {
    return this.ipcRenderer.invoke("openclaw:activity:message:save", params);
  }

  /** List channel messages with filtering */
  public async listChannelMessages(filters?: {
    channel?: string | string[];
    channelId?: string;
    senderId?: string;
    isBot?: boolean;
    search?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("openclaw:activity:messages:list", filters);
  }

  // ── Task Executor ──

  public async getTaskExecutorStatus(): Promise<any> {
    return this.ipcRenderer.invoke("task-executor:status");
  }

  // ── Skill System ──

  public async createSkill(
    params: import("@/types/skill_types").CreateSkillParams
  ): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:create", params);
  }

  public async getSkill(id: number): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:get", id);
  }

  public async listSkills(
    params?: import("@/types/skill_types").SkillSearchParams
  ): Promise<import("@/types/skill_types").Skill[]> {
    return this.ipcRenderer.invoke("skill:list", params);
  }

  public async updateSkill(
    params: import("@/types/skill_types").UpdateSkillParams
  ): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:update", params);
  }

  public async deleteSkill(id: number): Promise<void> {
    return this.ipcRenderer.invoke("skill:delete", id);
  }

  public async searchSkills(
    params: import("@/types/skill_types").SkillSearchParams
  ): Promise<import("@/types/skill_types").Skill[]> {
    return this.ipcRenderer.invoke("skill:search", params);
  }

  public async matchSkill(
    text: string,
    agentId?: number
  ): Promise<import("@/types/skill_types").SkillTriggerMatch | null> {
    return this.ipcRenderer.invoke("skill:match", text, agentId);
  }

  public async executeSkill(
    params: import("@/types/skill_types").ExecuteSkillParams
  ): Promise<import("@/types/skill_types").SkillExecutionResult> {
    return this.ipcRenderer.invoke("skill:execute", params);
  }

  public async generateSkill(
    request: import("@/types/skill_types").SkillGenerationRequest
  ): Promise<import("@/types/skill_types").SkillGenerationResult> {
    return this.ipcRenderer.invoke("skill:generate", request);
  }

  public async autoGenerateSkills(params: {
    agentId: number;
    conversationHistory: Array<{ role: string; content: string }>;
  }): Promise<import("@/types/skill_types").Skill[]> {
    return this.ipcRenderer.invoke("skill:auto-generate", params);
  }

  public async attachSkillToAgent(
    params: import("@/types/skill_types").AttachSkillParams
  ): Promise<void> {
    return this.ipcRenderer.invoke("skill:attach-to-agent", params);
  }

  public async detachSkillFromAgent(
    params: import("@/types/skill_types").DetachSkillParams
  ): Promise<void> {
    return this.ipcRenderer.invoke("skill:detach-from-agent", params);
  }

  public async listSkillsForAgent(
    agentId: number
  ): Promise<import("@/types/skill_types").Skill[]> {
    return this.ipcRenderer.invoke("skill:list-for-agent", agentId);
  }

  public async publishSkill(
    params: import("@/types/skill_types").SkillPublishRequest
  ): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:publish", params);
  }

  public async unpublishSkill(skillId: number): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:unpublish", skillId);
  }

  public async exportSkill(skillId: number): Promise<string> {
    return this.ipcRenderer.invoke("skill:export", skillId);
  }

  public async importSkill(
    json: string
  ): Promise<import("@/types/skill_types").Skill> {
    return this.ipcRenderer.invoke("skill:import", json);
  }

  public async exportSkillsMd(): Promise<string> {
    return this.ipcRenderer.invoke("skill:export-md");
  }

  public async bootstrapSkills(): Promise<number> {
    return this.ipcRenderer.invoke("skill:bootstrap");
  }

  public async learnSkill(
    message: string,
    agentId?: number,
  ): Promise<import("@/types/skill_types").Skill | null> {
    return this.ipcRenderer.invoke("skill:learn", { message, agentId });
  }

  public async startTaskExecutor(): Promise<any> {
    return this.ipcRenderer.invoke("task-executor:start");
  }

  public async stopTaskExecutor(): Promise<any> {
    return this.ipcRenderer.invoke("task-executor:stop");
  }

  // ── System Services Health ──

  public async getSystemServicesHealth(): Promise<any> {
    return this.ipcRenderer.invoke("system:services-health");
  }

  // ── Celestia Node Management ──

  public async startCelestiaNode(): Promise<{ success: boolean; message: string }> {
    return this.ipcRenderer.invoke("system:celestia:start");
  }

  public async stopCelestiaNode(): Promise<{ success: boolean; message: string }> {
    return this.ipcRenderer.invoke("system:celestia:stop");
  }

  public async getCelestiaNodeStatus(): Promise<{ running: boolean; wslAvailable: boolean; details: string }> {
    return this.ipcRenderer.invoke("system:celestia:status");
  }

  // ── n8n + Ollama ──

  public async setupN8nOllama(): Promise<any> {
    return this.ipcRenderer.invoke("n8n:setup-ollama");
  }

  public async generateN8nWorkflow(request: { prompt: string; model?: string; constraints?: any }): Promise<any> {
    return this.ipcRenderer.invoke("n8n:workflow:generate", request);
  }

  public async createN8nWorkflow(workflow: any): Promise<any> {
    return this.ipcRenderer.invoke("n8n:workflow:create", workflow);
  }

  public async listN8nWorkflows(): Promise<any> {
    return this.ipcRenderer.invoke("n8n:workflow:list");
  }

  public async createMetaWorkflowBuilder(): Promise<any> {
    return this.ipcRenderer.invoke("n8n:meta-builder:create");
  }

  // ── Background Missions ──────────────────────────────────────

  public async startMission(params: {
    appId?: number;
    agentId?: string;
    title: string;
    description?: string;
    targetAppPath?: string;
    phases?: { name: string }[];
  }): Promise<any> {
    return this.ipcRenderer.invoke("mission:start", params);
  }

  public async getMission(id: string): Promise<any> {
    return this.ipcRenderer.invoke("mission:get", id);
  }

  public async listMissions(filter?: {
    status?: string | string[];
    appId?: number;
  }): Promise<any[]> {
    return this.ipcRenderer.invoke("mission:list", filter);
  }

  public async pauseMission(id: string): Promise<void> {
    return this.ipcRenderer.invoke("mission:pause", id);
  }

  public async resumeMission(id: string): Promise<void> {
    return this.ipcRenderer.invoke("mission:resume", id);
  }

  public async cancelMission(id: string): Promise<void> {
    return this.ipcRenderer.invoke("mission:cancel", id);
  }

  public async deleteMission(id: string): Promise<void> {
    return this.ipcRenderer.invoke("mission:delete", id);
  }

  public async updateMission(params: { id: string; title?: string; description?: string }): Promise<unknown> {
    return this.ipcRenderer.invoke("mission:update", params);
  }

  // ── LibreOffice ──────────────────────────────────────────────

  public async getLibreOfficeStatus(): Promise<{ installed: boolean; version?: string; message?: string }> {
    return this.ipcRenderer.invoke("libreoffice:status");
  }

  // ── Image Studio ────────────────────────────────────────────────────────────

  public async generateImage(params: {
    provider: string;
    model: string;
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    style?: string;
    seed?: string;
    batchCount?: number;
    referenceImageBase64?: string;
    strength?: number;
    steps?: number;
    cfgScale?: number;
    sampler?: string;
  }): Promise<ImageStudioImage[]> {
    return this.ipcRenderer.invoke("image-studio:generate", params);
  }

  public async editImage(params: {
    imageId: number;
    maskBase64: string;
    prompt: string;
    provider: string;
    model: string;
  }): Promise<ImageStudioImage> {
    return this.ipcRenderer.invoke("image-studio:edit", params);
  }

  public async listImages(params?: {
    limit?: number;
    offset?: number;
    search?: string;
    provider?: string;
  }): Promise<ImageStudioImage[]> {
    return this.ipcRenderer.invoke("image-studio:list", params);
  }

  public async getImage(id: number): Promise<ImageStudioImage> {
    return this.ipcRenderer.invoke("image-studio:get", id);
  }

  public async deleteImage(id: number): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("image-studio:delete", id);
  }

  public async saveImageToDisk(id: number): Promise<{ saved: boolean; dest?: string }> {
    return this.ipcRenderer.invoke("image-studio:save-to-disk", id);
  }

  public async openImageInFolder(id: number): Promise<void> {
    return this.ipcRenderer.invoke("image-studio:open-in-folder", id);
  }

  public async getAvailableImageProviders(): Promise<ImageStudioProvider[]> {
    return this.ipcRenderer.invoke("image-studio:available-providers");
  }

  public async readImageAsBase64(id: number): Promise<string> {
    return this.ipcRenderer.invoke("image-studio:read-image", id);
  }

  public async enhanceImagePrompt(prompt: string): Promise<string> {
    return this.ipcRenderer.invoke("image-studio:enhance-prompt", prompt);
  }

  public async upscaleImage(params: {
    imageId: number;
    scale?: number;
    provider: string;
  }): Promise<ImageStudioImage> {
    return this.ipcRenderer.invoke("image-studio:upscale", params);
  }

  public async generateVariations(params: {
    imageId: number;
    count?: number;
  }): Promise<ImageStudioImage[]> {
    return this.ipcRenderer.invoke("image-studio:variations", params);
  }

  // ── Video Studio ──────────────────────────────────────────────────────────

  public async generateVideo(params: {
    provider: string;
    model: string;
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    duration?: number;
    fps?: number;
    seed?: string;
    style?: string;
    sourceType?: string;
    referenceImageBase64?: string;
    referenceVideoId?: number;
    strength?: number;
    motionAmount?: number;
  }): Promise<VideoStudioVideo> {
    return this.ipcRenderer.invoke("video-studio:generate", params);
  }

  public async listVideos(params?: {
    limit?: number;
    offset?: number;
    search?: string;
    provider?: string;
  }): Promise<VideoStudioVideo[]> {
    return this.ipcRenderer.invoke("video-studio:list", params);
  }

  public async getVideo(id: number): Promise<VideoStudioVideo> {
    return this.ipcRenderer.invoke("video-studio:get", id);
  }

  public async deleteVideo(id: number): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("video-studio:delete", id);
  }

  public async saveVideoToDisk(id: number): Promise<{ saved: boolean; dest?: string }> {
    return this.ipcRenderer.invoke("video-studio:save-to-disk", id);
  }

  public async openVideoInFolder(id: number): Promise<void> {
    return this.ipcRenderer.invoke("video-studio:open-in-folder", id);
  }

  public async getAvailableVideoProviders(): Promise<VideoStudioProvider[]> {
    return this.ipcRenderer.invoke("video-studio:available-providers");
  }

  public async readVideo(id: number): Promise<string> {
    return this.ipcRenderer.invoke("video-studio:read-video", id);
  }

  public async readVideoThumbnail(id: number): Promise<string> {
    return this.ipcRenderer.invoke("video-studio:read-thumbnail", id);
  }

  public async enhanceVideoPrompt(prompt: string): Promise<string> {
    return this.ipcRenderer.invoke("video-studio:enhance-prompt", prompt);
  }

  public async extractVideoFrames(params: {
    videoId: number;
    count?: number;
  }): Promise<{ videoDataUrl: string; duration: number | null; fps: number | null; requestedFrames: number }> {
    return this.ipcRenderer.invoke("video-studio:extract-frames", params);
  }

  // ── Marketplace Browse ──────────────────────────────────────────────────

  public async marketplaceBrowse(params: MarketplaceBrowseParams): Promise<MarketplaceBrowseResult> {
    return this.ipcRenderer.invoke("marketplace:browse", params);
  }

  public async marketplaceAssetDetail(assetId: string): Promise<MarketplaceAssetDetail> {
    return this.ipcRenderer.invoke("marketplace:asset-detail", assetId);
  }

  public async marketplaceInstallAsset(request: InstallAssetRequest): Promise<InstallAssetResult> {
    return this.ipcRenderer.invoke("marketplace:install-asset", request);
  }

  public async marketplaceFeatured(): Promise<MarketplaceBrowseResult> {
    return this.ipcRenderer.invoke("marketplace:featured");
  }

  public async marketplaceCategories(): Promise<{ category: string; count: number }[]> {
    return this.ipcRenderer.invoke("marketplace:categories");
  }

  // ── Creator Dashboard ─────────────────────────────────────────────────

  public async creatorGetOverview(): Promise<CreatorOverview> {
    return this.ipcRenderer.invoke("creator:get-overview");
  }

  public async creatorGetAllAssets(): Promise<CreatorAssetRecord[]> {
    return this.ipcRenderer.invoke("creator:get-all-assets");
  }

  public async creatorGetEarningsBreakdown(): Promise<EarningsBreakdown> {
    return this.ipcRenderer.invoke("creator:get-earnings-breakdown");
  }

  public async creatorGetAnalytics(): Promise<CreatorAnalytics> {
    return this.ipcRenderer.invoke("creator:get-analytics");
  }

  // ── Agent Marketplace ─────────────────────────────────────────────────

  public async agentPublishToMarketplace(payload: UnifiedPublishPayload): Promise<PublishResult> {
    return this.ipcRenderer.invoke("agent:publish-to-marketplace", payload);
  }

  public async agentUnpublish(agentId: number): Promise<void> {
    return this.ipcRenderer.invoke("agent:unpublish", agentId);
  }

  public async agentUpdateListing(params: { agentId: number; updates: Partial<UnifiedPublishPayload> }): Promise<unknown> {
    return this.ipcRenderer.invoke("agent:update-listing", params);
  }

  // ── Workflow Marketplace ───────────────────────────────────────────────

  public async workflowPublishToMarketplace(payload: UnifiedPublishPayload): Promise<PublishResult> {
    return this.ipcRenderer.invoke("workflow:publish-to-marketplace", payload);
  }

  public async workflowInstallFromMarketplace(assetId: string): Promise<{ workflowId: string }> {
    return this.ipcRenderer.invoke("workflow:install-from-marketplace", assetId);
  }

  public async workflowUnpublish(workflowId: string): Promise<void> {
    return this.ipcRenderer.invoke("workflow:unpublish", workflowId);
  }

  public async workflowListPublished(): Promise<unknown[]> {
    return this.ipcRenderer.invoke("workflow:list-published");
  }

  // ── MCP Server ─────────────────────────────────────────────────

  public async mcpServerStart(port?: number): Promise<{ port: number }> {
    return this.ipcRenderer.invoke("mcp-server:start", { port });
  }

  public async mcpServerStop(): Promise<void> {
    return this.ipcRenderer.invoke("mcp-server:stop");
  }

  public async mcpServerStatus(): Promise<{ running: boolean; port: number; url: string | null }> {
    return this.ipcRenderer.invoke("mcp-server:status");
  }

  public async mcpServerGetConfig(): Promise<{ defaultPort: number; currentPort: number; running: boolean; url: string | null }> {
    return this.ipcRenderer.invoke("mcp-server:get-config");
  }

  // ── Calendar ────────────────────────────────────────────────────────────

  public async calendarListSources(): Promise<unknown[]> {
    return this.ipcRenderer.invoke("calendar:list-sources");
  }

  public async calendarAddSource(params: {
    name: string;
    type: string;
    color?: string;
    configJson?: Record<string, unknown>;
    authJson?: Record<string, unknown>;
    syncIntervalMinutes?: number;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:add-source", params);
  }

  public async calendarUpdateSource(params: {
    id: string;
    name?: string;
    color?: string;
    enabled?: boolean;
    configJson?: Record<string, unknown>;
    authJson?: Record<string, unknown>;
    syncIntervalMinutes?: number;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:update-source", params);
  }

  public async calendarRemoveSource(params: { id: string }): Promise<{ deleted: boolean }> {
    return this.ipcRenderer.invoke("calendar:remove-source", params);
  }

  public async calendarTestSource(params: { id: string }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("calendar:test-source", params);
  }

  public async calendarSyncSource(params: { id: string }): Promise<{ synced: number; errors: number }> {
    return this.ipcRenderer.invoke("calendar:sync-source", params);
  }

  public async calendarSyncAll(): Promise<{ done: boolean }> {
    return this.ipcRenderer.invoke("calendar:sync-all");
  }

  public async calendarListCalendars(params: { sourceId: string }): Promise<unknown[]> {
    return this.ipcRenderer.invoke("calendar:list-calendars", params);
  }

  public async calendarListEvents(params: {
    startAt: number;
    endAt: number;
    sourceIds?: string[];
    types?: string[];
    includeAgentActivity?: boolean;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke("calendar:list-events", params);
  }

  public async calendarGetEvent(params: { id: string }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:get-event", params);
  }

  public async calendarCreateEvent(params: {
    sourceId: string;
    event: { title: string; description?: string; startAt: number; endAt?: number; isAllDay?: boolean; location?: string; status?: string; recurrenceRule?: string; attendees?: Array<{ name?: string; email: string }> };
    type?: string;
    agentId?: string;
    agentName?: string;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:create-event", params);
  }

  public async calendarUpdateEvent(params: {
    id: string;
    updates: Record<string, unknown>;
    type?: string;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:update-event", params);
  }

  public async calendarDeleteEvent(params: { id: string }): Promise<{ deleted: boolean }> {
    return this.ipcRenderer.invoke("calendar:delete-event", params);
  }

  public async calendarScheduleAgentEvent(params: {
    title: string;
    description?: string;
    startAt: number;
    endAt?: number;
    type: "agent_run" | "agent_post" | "agent_task";
    agentId: string;
    agentName: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("calendar:schedule-agent-event", params);
  }

  public async calendarListAgentEvents(params: {
    agentId?: string;
    startAt?: number;
    endAt?: number;
  }): Promise<unknown[]> {
    return this.ipcRenderer.invoke("calendar:list-agent-events", params);
  }

  public async calendarExportIcs(params: { eventId: string }): Promise<string> {
    return this.ipcRenderer.invoke("calendar:export-ics", params);
  }

  // ── Telegram Bot ──

  public async telegramConfigure(config: {
    token?: string;
    enabled?: boolean;
    allowedChatIds?: string[];
  }): Promise<{ success: boolean; status: unknown }> {
    return this.ipcRenderer.invoke("telegram:configure", config);
  }

  public async telegramValidateToken(token: string): Promise<{ valid: boolean; bot: unknown }> {
    return this.ipcRenderer.invoke("telegram:validate-token", token);
  }

  public async telegramStart(): Promise<unknown> {
    return this.ipcRenderer.invoke("telegram:start");
  }

  public async telegramStop(): Promise<{ running: boolean }> {
    return this.ipcRenderer.invoke("telegram:stop");
  }

  public async telegramStatus(): Promise<{
    running: boolean;
    botUsername?: string;
    botId?: number;
    lastPollAt?: number;
    totalMessagesReceived: number;
    totalMessagesSent: number;
    error?: string;
  }> {
    return this.ipcRenderer.invoke("telegram:status");
  }

  public async telegramConfig(): Promise<unknown> {
    return this.ipcRenderer.invoke("telegram:config");
  }

  public async telegramSendMessage(params: {
    chatId: string;
    text: string;
    parseMode?: "HTML" | "Markdown" | "MarkdownV2";
    replyToMessageId?: number;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("telegram:send-message", params);
  }

  // ── Discord Bot ──

  public async discordConfigure(config: {
    token?: string;
    enabled?: boolean;
    allowedGuildIds?: string[];
    allowedChannelIds?: string[];
  }): Promise<{ success: boolean; status: unknown }> {
    return this.ipcRenderer.invoke("discord:configure", config);
  }

  public async discordValidateToken(token: string): Promise<{ valid: boolean; bot: unknown }> {
    return this.ipcRenderer.invoke("discord:validate-token", token);
  }

  public async discordStart(): Promise<unknown> {
    return this.ipcRenderer.invoke("discord:start");
  }

  public async discordStop(): Promise<{ running: boolean }> {
    return this.ipcRenderer.invoke("discord:stop");
  }

  public async discordStatus(): Promise<{
    running: boolean;
    botUsername?: string;
    botId?: string;
    guildCount: number;
    lastMessageAt?: number;
    totalMessagesReceived: number;
    totalMessagesSent: number;
    error?: string;
  }> {
    return this.ipcRenderer.invoke("discord:status");
  }

  public async discordConfig(): Promise<unknown> {
    return this.ipcRenderer.invoke("discord:config");
  }

  public async discordSendMessage(params: {
    channelId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<unknown> {
    return this.ipcRenderer.invoke("discord:send-message", params);
  }
}
