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
} from "./ipc_types";
import type { Template } from "../shared/templates";
import type {
  AppChatContext,
  AppSearchResult,
  ChatSearchResult,
  ProposalResult,
} from "@/lib/schemas";
import { showError } from "@/lib/toast";

/**
 * Callbacks for chat stream events.
 * @interface
 */
export interface ChatStreamCallbacks {
  /**
   * Called when the chat stream receives an update.
   * @param {Message[]} messages - The updated list of messages.
   */
  onUpdate: (messages: Message[]) => void;
  /**
   * Called when the chat stream ends.
   * @param {ChatResponseEnd} response - The final response from the stream.
   */
  onEnd: (response: ChatResponseEnd) => void;
  /**
   * Called when an error occurs in the chat stream.
   * @param {string} error - The error message.
   */
  onError: (error: string) => void;
}

/**
 * Callbacks for app stream events.
 * @interface
 */
export interface AppStreamCallbacks {
  /**
   * Called when the app stream receives output.
   * @param {AppOutput} output - The output from the app.
   */
  onOutput: (output: AppOutput) => void;
}

/**
 * Data for GitHub device flow updates.
 * @interface
 */
export interface GitHubDeviceFlowUpdateData {
  /** The user code for the device flow. */
  userCode?: string;
  /** The verification URI for the device flow. */
  verificationUri?: string;
  /** A message related to the device flow update. */
  message?: string;
}

/**
 * Data for successful GitHub device flow authentication.
 * @interface
 */
export interface GitHubDeviceFlowSuccessData {
  /** A success message. */
  message?: string;
}

/**
 * Data for a GitHub device flow error.
 * @interface
 */
export interface GitHubDeviceFlowErrorData {
  /** The error message. */
  error: string;
}

/**
 * Data for a deep link event.
 * @interface
 */
export interface DeepLinkData {
  /** The type of the deep link. */
  type: string;
}

/**
 * Parameters for deleting a custom model.
 * @interface
 */
interface DeleteCustomModelParams {
  /** The ID of the provider. */
  providerId: string;
  /** The API name of the model. */
  modelApiName: string;
}

/**
 * The IpcClient class provides a singleton interface for communicating with the main process via IPC.
 * It handles sending requests and managing stream callbacks.
 */
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
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.chatStreams = new Map();
    this.appStreams = new Map();
    this.helpStreams = new Map();
    this.mcpConsentHandlers = new Map();
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

  /**
   * Gets the singleton instance of the IpcClient.
   * @returns {IpcClient} The singleton instance.
   */
  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  /**
   * Restarts the Dyad application.
   * @returns {Promise<void>}
   */
  public async restartDyad(): Promise<void> {
    await this.ipcRenderer.invoke("restart-dyad");
  }

  /**
   * Reloads the environment path.
   * @returns {Promise<void>}
   */
  public async reloadEnvPath(): Promise<void> {
    await this.ipcRenderer.invoke("reload-env-path");
  }

  /**
   * Creates a new app with an initial chat.
   * @param {CreateAppParams} params - The parameters for creating the app.
   * @returns {Promise<CreateAppResult>} The result of the app creation.
   */
  public async createApp(params: CreateAppParams): Promise<CreateAppResult> {
    return this.ipcRenderer.invoke("create-app", params);
  }

  /**
   * Gets an app by its ID.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<App>} The app object.
   */
  public async getApp(appId: number): Promise<App> {
    return this.ipcRenderer.invoke("get-app", appId);
  }

  /**
   * Adds an app to favorites.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<{ isFavorite: boolean }>} The favorite status.
   */
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

  /**
   * Gets the environment variables for an app.
   * @param {GetAppEnvVarsParams} params - The parameters for getting the environment variables.
   * @returns {Promise<{ key: string; value: string }[]>} The environment variables.
   */
  public async getAppEnvVars(
    params: GetAppEnvVarsParams,
  ): Promise<{ key: string; value: string }[]> {
    return this.ipcRenderer.invoke("get-app-env-vars", params);
  }

  /**
   * Sets the environment variables for an app.
   * @param {SetAppEnvVarsParams} params - The parameters for setting the environment variables.
   * @returns {Promise<void>}
   */
  public async setAppEnvVars(params: SetAppEnvVarsParams): Promise<void> {
    return this.ipcRenderer.invoke("set-app-env-vars", params);
  }

  /**
   * Gets a chat by its ID.
   * @param {number} chatId - The ID of the chat.
   * @returns {Promise<Chat>} The chat object.
   */
  public async getChat(chatId: number): Promise<Chat> {
    try {
      const data = await this.ipcRenderer.invoke("get-chat", chatId);
      return data;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Gets all chats for a given app.
   * @param {number} [appId] - The ID of the app.
   * @returns {Promise<ChatSummary[]>} A list of chat summaries.
   */
  public async getChats(appId?: number): Promise<ChatSummary[]> {
    try {
      const data = await this.ipcRenderer.invoke("get-chats", appId);
      return ChatSummariesSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Searches for chats within an app.
   * @param {number} appId - The ID of the app.
   * @param {string} query - The search query.
   * @returns {Promise<ChatSearchResult[]>} A list of chat search results.
   */
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

  /**
   * Lists all apps.
   * @returns {Promise<ListAppsResponse>} A list of apps.
   */
  public async listApps(): Promise<ListAppsResponse> {
    return this.ipcRenderer.invoke("list-apps");
  }

  /**
   * Searches for apps by name.
   * @param {string} searchQuery - The search query.
   * @returns {Promise<AppSearchResult[]>} A list of app search results.
   */
  public async searchApps(searchQuery: string): Promise<AppSearchResult[]> {
    try {
      const data = await this.ipcRenderer.invoke("search-app", searchQuery);
      return AppSearchResultsSchema.parse(data);
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Reads the content of a file in an app's directory.
   * @param {number} appId - The ID of the app.
   * @param {string} filePath - The path to the file.
   * @returns {Promise<string>} The content of the file.
   */
  public async readAppFile(appId: number, filePath: string): Promise<string> {
    return this.ipcRenderer.invoke("read-app-file", {
      appId,
      filePath,
    });
  }

  /**
   * Edits a file in an app's directory.
   * @param {number} appId - The ID of the app.
   * @param {string} filePath - The path to the file.
   * @param {string} content - The new content of the file.
   * @returns {Promise<EditAppFileReturnType>} The result of the file edit.
   */
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

  /**
   * Streams a message to the main process and handles the response.
   * @param {string} prompt - The prompt for the message.
   * @param {object} options - The options for the message stream.
   * @param {ComponentSelection | null} options.selectedComponent - The selected component.
   * @param {number} options.chatId - The ID of the chat.
   * @param {boolean} [options.redo] - Whether to redo the message.
   * @param {FileAttachment[]} [options.attachments] - The file attachments for the message.
   * @param {(messages: Message[]) => void} options.onUpdate - The callback for stream updates.
   * @param {(response: ChatResponseEnd) => void} options.onEnd - The callback for stream end.
   * @param {(error: string) => void} options.onError - The callback for stream errors.
   * @param {(problems: ChatProblemsEvent) => void} [options.onProblems] - The callback for chat problems.
   */
  public streamMessage(
    prompt: string,
    options: {
      selectedComponent: ComponentSelection | null;
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
      selectedComponent,
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
              selectedComponent,
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
          selectedComponent,
        })
        .catch((err) => {
          showError(err);
          onError(String(err));
          this.chatStreams.delete(chatId);
        });
    }
  }

  /**
   * Cancels an ongoing chat stream.
   * @param {number} chatId - The ID of the chat to cancel.
   */
  public cancelChatStream(chatId: number): void {
    this.ipcRenderer.invoke("chat:cancel", chatId);
    const callbacks = this.chatStreams.get(chatId);
    if (callbacks) {
      this.chatStreams.delete(chatId);
    } else {
      console.error("Tried canceling chat that doesn't exist");
    }
  }

  /**
   * Creates a new chat for an app.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<number>} The ID of the new chat.
   */
  public async createChat(appId: number): Promise<number> {
    return this.ipcRenderer.invoke("create-chat", appId);
  }

  /**
   * Updates a chat.
   * @param {UpdateChatParams} params - The parameters for updating the chat.
   * @returns {Promise<void>}
   */
  public async updateChat(params: UpdateChatParams): Promise<void> {
    return this.ipcRenderer.invoke("update-chat", params);
  }

  /**
   * Deletes a chat.
   * @param {number} chatId - The ID of the chat to delete.
   * @returns {Promise<void>}
   */
  public async deleteChat(chatId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-chat", chatId);
  }

  /**
   * Deletes all messages in a chat.
   * @param {number} chatId - The ID of the chat.
   * @returns {Promise<void>}
   */
  public async deleteMessages(chatId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-messages", chatId);
  }

  /**
   * Opens an external URL in the default browser.
   * @param {string} url - The URL to open.
   * @returns {Promise<void>}
   */
  public async openExternalUrl(url: string): Promise<void> {
    await this.ipcRenderer.invoke("open-external-url", url);
  }

  /**
   * Shows an item in the folder.
   * @param {string} fullPath - The full path to the item.
   * @returns {Promise<void>}
   */
  public async showItemInFolder(fullPath: string): Promise<void> {
    await this.ipcRenderer.invoke("show-item-in-folder", fullPath);
  }

  /**
   * Runs an app.
   * @param {number} appId - The ID of the app to run.
   * @param {(output: AppOutput) => void} onOutput - The callback for app output.
   * @returns {Promise<void>}
   */
  public async runApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
  ): Promise<void> {
    await this.ipcRenderer.invoke("run-app", { appId });
    this.appStreams.set(appId, { onOutput });
  }

  /**
   * Stops a running app.
   * @param {number} appId - The ID of the app to stop.
   * @returns {Promise<void>}
   */
  public async stopApp(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("stop-app", { appId });
  }

  /**
   * Restarts a running app.
   * @param {number} appId - The ID of the app to restart.
   * @param {(output: AppOutput) => void} onOutput - The callback for app output.
   * @param {boolean} [removeNodeModules] - Whether to remove node_modules before restarting.
   * @returns {Promise<{ success: boolean }>} The result of the restart.
   */
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

  /**
   * Responds to an app input request (e.g., y/n prompts).
   * @param {RespondToAppInputParams} params - The parameters for responding to the input request.
   * @returns {Promise<void>}
   */
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

  /**
   * Gets the allow-listed environment variables.
   * @returns {Promise<Record<string, string | undefined>>} A record of environment variables.
   */
  public async getEnvVars(): Promise<Record<string, string | undefined>> {
    try {
      const envVars = await this.ipcRenderer.invoke("get-env-vars");
      return envVars as Record<string, string | undefined>;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Lists all versions (commits) of an app.
   * @param {object} params - The parameters for listing versions.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<Version[]>} A list of versions.
   */
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

  /**
   * Reverts to a specific version.
   * @param {RevertVersionParams} params - The parameters for reverting to a version.
   * @returns {Promise<RevertVersionResponse>} The response from the revert operation.
   */
  public async revertVersion(
    params: RevertVersionParams,
  ): Promise<RevertVersionResponse> {
    return this.ipcRenderer.invoke("revert-version", params);
  }

  /**
   * Checks out a specific version without creating a revert commit.
   * @param {object} params - The parameters for checking out a version.
   * @param {number} params.appId - The ID of the app.
   * @param {string} params.versionId - The ID of the version to checkout.
   * @returns {Promise<void>}
   */
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

  /**
   * Gets the current branch of an app.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<BranchResult>} The current branch of the app.
   */
  public async getCurrentBranch(appId: number): Promise<BranchResult> {
    return this.ipcRenderer.invoke("get-current-branch", {
      appId,
    });
  }

  /**
   * Gets the user settings.
   * @returns {Promise<UserSettings>} The user settings.
   */
  public async getUserSettings(): Promise<UserSettings> {
    try {
      const settings = await this.ipcRenderer.invoke("get-user-settings");
      return settings;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Sets the user settings.
   * @param {Partial<UserSettings>} settings - The settings to update.
   * @returns {Promise<UserSettings>} The updated user settings.
   */
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

  /**
   * Deletes an app and all its files.
   * @param {number} appId - The ID of the app to delete.
   * @returns {Promise<void>}
   */
  public async deleteApp(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("delete-app", { appId });
  }

  /**
   * Renames an app.
   * @param {object} params - The parameters for renaming the app.
   * @param {number} params.appId - The ID of the app.
   * @param {string} params.appName - The new name of the app.
   * @param {string} params.appPath - The new path of the app.
   * @returns {Promise<void>}
   */
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

  /**
   * Copies an app.
   * @param {CopyAppParams} params - The parameters for copying the app.
   * @returns {Promise<{ app: App }>} The copied app.
   */
  public async copyApp(params: CopyAppParams): Promise<{ app: App }> {
    return this.ipcRenderer.invoke("copy-app", params);
  }

  /**
   * Resets all data, including app files, settings, and the database.
   * @returns {Promise<void>}
   */
  public async resetAll(): Promise<void> {
    await this.ipcRenderer.invoke("reset-all");
  }

  /**
   * Adds a dependency to a chat.
   * @param {object} params - The parameters for adding the dependency.
   * @param {number} params.chatId - The ID of the chat.
   * @param {string[]} params.packages - The packages to add.
   * @returns {Promise<void>}
   */
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

  /**
   * Checks the status of Node.js and npm.
   * @returns {Promise<NodeSystemInfo>} The system info for Node.js.
   */
  public async getNodejsStatus(): Promise<NodeSystemInfo> {
    return this.ipcRenderer.invoke("nodejs-status");
  }

  /**
   * Starts the GitHub device flow.
   * @param {number | null} appId - The ID of the app, or null.
   */
  public startGithubDeviceFlow(appId: number | null): void {
    this.ipcRenderer.invoke("github:start-flow", { appId });
  }

  /**
   * Registers a callback for GitHub device flow updates.
   * @param {(data: GitHubDeviceFlowUpdateData) => void} callback - The callback to register.
   * @returns {() => void} A function to remove the listener.
   */
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

  /**
   * Registers a callback for successful GitHub device flow authentication.
   * @param {(data: GitHubDeviceFlowSuccessData) => void} callback - The callback to register.
   * @returns {() => void} A function to remove the listener.
   */
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

  /**
   * Registers a callback for GitHub device flow errors.
   * @param {(data: GitHubDeviceFlowErrorData) => void} callback - The callback to register.
   * @returns {() => void} A function to remove the listener.
   */
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

  /**
   * Lists the user's GitHub repositories.
   * @returns {Promise<{ name: string; full_name: string; private: boolean }[]>} A list of repositories.
   */
  public async listGithubRepos(): Promise<
    { name: string; full_name: string; private: boolean }[]
  > {
    return this.ipcRenderer.invoke("github:list-repos");
  }

  /**
   * Gets the branches of a GitHub repository.
   * @param {string} owner - The owner of the repository.
   * @param {string} repo - The name of the repository.
   * @returns {Promise<{ name: string; commit: { sha: string } }[]>} A list of branches.
   */
  public async getGithubRepoBranches(
    owner: string,
    repo: string,
  ): Promise<{ name: string; commit: { sha: string } }[]> {
    return this.ipcRenderer.invoke("github:get-repo-branches", {
      owner,
      repo,
    });
  }

  /**
   * Connects an app to an existing GitHub repository.
   * @param {string} owner - The owner of the repository.
   * @param {string} repo - The name of the repository.
   * @param {string} branch - The branch to connect to.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<void>}
   */
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

  /**
   * Checks if a GitHub repository is available.
   * @param {string} org - The organization or owner of the repository.
   * @param {string} repo - The name of the repository.
   * @returns {Promise<{ available: boolean; error?: string }>} The availability of the repository.
   */
  public async checkGithubRepoAvailable(
    org: string,
    repo: string,
  ): Promise<{ available: boolean; error?: string }> {
    return this.ipcRenderer.invoke("github:is-repo-available", {
      org,
      repo,
    });
  }

  /**
   * Creates a new GitHub repository.
   * @param {string} org - The organization or owner of the repository.
   * @param {string} repo - The name of the repository.
   * @param {number} appId - The ID of the app.
   * @param {string} [branch] - The branch to create.
   * @returns {Promise<void>}
   */
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

  /**
   * Syncs (pushes) the local repository to GitHub.
   * @param {number} appId - The ID of the app.
   * @param {boolean} [force] - Whether to force the push.
   * @returns {Promise<{ success: boolean; error?: string }>} The result of the sync.
   */
  public async syncGithubRepo(
    appId: number,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("github:push", {
      appId,
      force,
    });
  }

  /**
   * Disconnects an app from a GitHub repository.
   * @param {number} appId - The ID of the app.
   * @returns {Promise<void>}
   */
  public async disconnectGithubRepo(appId: number): Promise<void> {
    await this.ipcRenderer.invoke("github:disconnect", {
      appId,
    });
  }
  // --- End GitHub Repo Management ---

  /**
   * Saves a Vercel access token.
   * @param {SaveVercelAccessTokenParams} params - The parameters for saving the token.
   * @returns {Promise<void>}
   */
  public async saveVercelAccessToken(
    params: SaveVercelAccessTokenParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:save-token", params);
  }

  /**
   * Lists the user's Vercel projects.
   * @returns {Promise<VercelProject[]>} A list of Vercel projects.
   */
  public async listVercelProjects(): Promise<VercelProject[]> {
    return this.ipcRenderer.invoke("vercel:list-projects", undefined);
  }

  /**
   * Connects an app to an existing Vercel project.
   * @param {ConnectToExistingVercelProjectParams} params - The parameters for connecting to the project.
   * @returns {Promise<void>}
   */
  public async connectToExistingVercelProject(
    params: ConnectToExistingVercelProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:connect-existing-project", params);
  }

  /**
   * Checks if a Vercel project is available.
   * @param {IsVercelProjectAvailableParams} params - The parameters for checking the project's availability.
   * @returns {Promise<IsVercelProjectAvailableResponse>} The availability of the project.
   */
  public async isVercelProjectAvailable(
    params: IsVercelProjectAvailableParams,
  ): Promise<IsVercelProjectAvailableResponse> {
    return this.ipcRenderer.invoke("vercel:is-project-available", params);
  }

  /**
   * Creates a new Vercel project.
   * @param {CreateVercelProjectParams} params - The parameters for creating the project.
   * @returns {Promise<void>}
   */
  public async createVercelProject(
    params: CreateVercelProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:create-project", params);
  }

  /**
   * Gets the deployments of a Vercel project.
   * @param {GetVercelDeploymentsParams} params - The parameters for getting the deployments.
   * @returns {Promise<VercelDeployment[]>} A list of deployments.
   */
  public async getVercelDeployments(
    params: GetVercelDeploymentsParams,
  ): Promise<VercelDeployment[]> {
    return this.ipcRenderer.invoke("vercel:get-deployments", params);
  }

  /**
   * Disconnects an app from a Vercel project.
   * @param {DisconnectVercelProjectParams} params - The parameters for disconnecting the project.
   * @returns {Promise<void>}
   */
  public async disconnectVercelProject(
    params: DisconnectVercelProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("vercel:disconnect", params);
  }
  // --- End Vercel Project Management ---

  /**
   * Gets the main application version.
   * @returns {Promise<string>} The application version.
   */
  public async getAppVersion(): Promise<string> {
    const result = await this.ipcRenderer.invoke("get-app-version");
    return result.version as string;
  }

  /**
   * Lists all MCP servers.
   * @returns {Promise<any>} A list of MCP servers.
   */
  public async listMcpServers() {
    return this.ipcRenderer.invoke("mcp:list-servers");
  }

  /**
   * Creates a new MCP server.
   * @param {CreateMcpServer} params - The parameters for creating the server.
   * @returns {Promise<any>} The created server.
   */
  public async createMcpServer(params: CreateMcpServer) {
    return this.ipcRenderer.invoke("mcp:create-server", params);
  }

  /**
   * Updates an MCP server.
   * @param {McpServerUpdate} params - The parameters for updating the server.
   * @returns {Promise<any>} The updated server.
   */
  public async updateMcpServer(params: McpServerUpdate) {
    return this.ipcRenderer.invoke("mcp:update-server", params);
  }

  /**
   * Deletes an MCP server.
   * @param {number} id - The ID of the server to delete.
   * @returns {Promise<any>} The result of the deletion.
   */
  public async deleteMcpServer(id: number) {
    return this.ipcRenderer.invoke("mcp:delete-server", id);
  }

  /**
   * Lists the tools of an MCP server.
   * @param {number} serverId - The ID of the server.
   * @returns {Promise<any>} A list of tools.
   */
  public async listMcpTools(serverId: number) {
    return this.ipcRenderer.invoke("mcp:list-tools", serverId);
  }

  /**
   * Gets the tool consents for MCP.
   * @returns {Promise<any>} The tool consents.
   */
  public async getMcpToolConsents() {
    return this.ipcRenderer.invoke("mcp:get-tool-consents");
  }

  /**
   * Sets the tool consent for an MCP tool.
   * @param {object} params - The parameters for setting the consent.
   * @param {number} params.serverId - The ID of the server.
   * @param {string} params.toolName - The name of the tool.
   * @param {"ask" | "always" | "denied"} params.consent - The consent level.
   * @returns {Promise<any>} The result of setting the consent.
   */
  public async setMcpToolConsent(params: {
    serverId: number;
    toolName: string;
    consent: "ask" | "always" | "denied";
  }) {
    return this.ipcRenderer.invoke("mcp:set-tool-consent", params);
  }

  /**
   * Registers a handler for MCP tool consent requests.
   * @param {Function} handler - The handler for the consent request.
   * @returns {() => void} A function to remove the handler.
   */
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

  /**
   * Responds to an MCP tool consent request.
   * @param {string} requestId - The ID of the request.
   * @param {"accept-once" | "accept-always" | "decline"} decision - The decision for the consent request.
   */
  public respondToMcpConsentRequest(
    requestId: string,
    decision: "accept-once" | "accept-always" | "decline",
  ) {
    this.ipcRenderer.invoke("mcp:tool-consent-response", {
      requestId,
      decision,
    });
  }

  /**
   * Gets the proposal details for a chat.
   * @param {number} chatId - The ID of the chat.
   * @returns {Promise<ProposalResult | null>} The proposal result, or null if not found.
   */
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

  /**
   * Approves a proposal.
   * @param {object} params - The parameters for approving the proposal.
   * @param {number} params.chatId - The ID of the chat.
   * @param {number} params.messageId - The ID of the message.
   * @returns {Promise<ApproveProposalResult>} The result of the approval.
   */
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

  /**
   * Rejects a proposal.
   * @param {object} params - The parameters for rejecting the proposal.
   * @param {number} params.chatId - The ID of the chat.
   * @param {number} params.messageId - The ID of the message.
   * @returns {Promise<void>}
   */
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
  /**
   * Lists the user's Supabase projects.
   * @returns {Promise<any[]>} A list of Supabase projects.
   */
  public async listSupabaseProjects(): Promise<any[]> {
    return this.ipcRenderer.invoke("supabase:list-projects");
  }

  /**
   * Lists the branches of a Supabase project.
   * @param {object} params - The parameters for listing the branches.
   * @param {string} params.projectId - The ID of the project.
   * @returns {Promise<SupabaseBranch[]>} A list of branches.
   */
  public async listSupabaseBranches(params: {
    projectId: string;
  }): Promise<SupabaseBranch[]> {
    return this.ipcRenderer.invoke("supabase:list-branches", params);
  }

  /**
   * Sets the Supabase project for an app.
   * @param {SetSupabaseAppProjectParams} params - The parameters for setting the project.
   * @returns {Promise<void>}
   */
  public async setSupabaseAppProject(
    params: SetSupabaseAppProjectParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("supabase:set-app-project", params);
  }

  /**
   * Unsets the Supabase project for an app.
   * @param {number} app - The ID of the app.
   * @returns {Promise<void>}
   */
  public async unsetSupabaseAppProject(app: number): Promise<void> {
    await this.ipcRenderer.invoke("supabase:unset-app-project", {
      app,
    });
  }

  /**
   * Fakes a Supabase connection for testing purposes.
   * @param {object} params - The parameters for the fake connection.
   * @param {number} params.appId - The ID of the app.
   * @param {string} params.fakeProjectId - The fake project ID.
   * @returns {Promise<void>}
   */
  public async fakeHandleSupabaseConnect(params: {
    appId: number;
    fakeProjectId: string;
  }): Promise<void> {
    await this.ipcRenderer.invoke(
      "supabase:fake-connect-and-set-project",
      params,
    );
  }

  /**
   * Fakes a Neon connection for testing purposes.
   * @returns {Promise<void>}
   */
  public async fakeHandleNeonConnect(): Promise<void> {
    await this.ipcRenderer.invoke("neon:fake-connect");
  }

  /**
   * Creates a new Neon project.
   * @param {CreateNeonProjectParams} params - The parameters for creating the project.
   * @returns {Promise<NeonProject>} The created Neon project.
   */
  public async createNeonProject(
    params: CreateNeonProjectParams,
  ): Promise<NeonProject> {
    return this.ipcRenderer.invoke("neon:create-project", params);
  }

  /**
   * Gets a Neon project.
   * @param {GetNeonProjectParams} params - The parameters for getting the project.
   * @returns {Promise<GetNeonProjectResponse>} The Neon project.
   */
  public async getNeonProject(
    params: GetNeonProjectParams,
  ): Promise<GetNeonProjectResponse> {
    return this.ipcRenderer.invoke("neon:get-project", params);
  }

  /**
   * Creates a portal migration.
   * @param {object} params - The parameters for creating the migration.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<{ output: string }>} The output of the migration.
   */
  public async portalMigrateCreate(params: {
    appId: number;
  }): Promise<{ output: string }> {
    return this.ipcRenderer.invoke("portal:migrate-create", params);
  }

  /**
   * Gets the system debug information.
   * @returns {Promise<SystemDebugInfo>} The system debug information.
   */
  public async getSystemDebugInfo(): Promise<SystemDebugInfo> {
    return this.ipcRenderer.invoke("get-system-debug-info");
  }

  /**
   * Gets the chat logs for a chat.
   * @param {number} chatId - The ID of the chat.
   * @returns {Promise<ChatLogsData>} The chat logs.
   */
  public async getChatLogs(chatId: number): Promise<ChatLogsData> {
    return this.ipcRenderer.invoke("get-chat-logs", chatId);
  }

  /**
   * Uploads data to a signed URL.
   * @param {string} url - The signed URL.
   * @param {string} contentType - The content type of the data.
   * @param {any} data - The data to upload.
   * @returns {Promise<void>}
   */
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

  /**
   * Lists the local Ollama models.
   * @returns {Promise<LocalModel[]>} A list of local models.
   */
  public async listLocalOllamaModels(): Promise<LocalModel[]> {
    const response = await this.ipcRenderer.invoke("local-models:list-ollama");
    return response?.models || [];
  }

  /**
   * Lists the local LMStudio models.
   * @returns {Promise<LocalModel[]>} A list of local models.
   */
  public async listLocalLMStudioModels(): Promise<LocalModel[]> {
    const response = await this.ipcRenderer.invoke(
      "local-models:list-lmstudio",
    );
    return response?.models || [];
  }

  /**
   * Registers a callback for deep link events.
   * @param {(data: DeepLinkData) => void} callback - The callback to register.
   * @returns {() => void} A function to remove the listener.
   */
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

  /**
   * Counts the tokens for a chat and input.
   * @param {TokenCountParams} params - The parameters for counting tokens.
   * @returns {Promise<TokenCountResult>} The result of the token count.
   */
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

  /**
   * Minimizes the window.
   * @returns {Promise<void>}
   */
  public async minimizeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:minimize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Maximizes the window.
   * @returns {Promise<void>}
   */
  public async maximizeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:maximize");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Closes the window.
   * @returns {Promise<void>}
   */
  public async closeWindow(): Promise<void> {
    try {
      await this.ipcRenderer.invoke("window:close");
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  /**
   * Gets the system platform (e.g., win32, darwin, linux).
   * @returns {Promise<string>} The system platform.
   */
  public async getSystemPlatform(): Promise<string> {
    return this.ipcRenderer.invoke("get-system-platform");
  }

  /**
   * Checks if a release note exists for a given version.
   * @param {DoesReleaseNoteExistParams} params - The parameters for checking the release note.
   * @returns {Promise<{ exists: boolean; url?: string }>} The result of the check.
   */
  public async doesReleaseNoteExist(
    params: DoesReleaseNoteExistParams,
  ): Promise<{ exists: boolean; url?: string }> {
    return this.ipcRenderer.invoke("does-release-note-exist", params);
  }

  /**
   * Gets the available language model providers.
   * @returns {Promise<LanguageModelProvider[]>} A list of language model providers.
   */
  public async getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
    return this.ipcRenderer.invoke("get-language-model-providers");
  }

  /**
   * Gets the language models for a given provider.
   * @param {object} params - The parameters for getting the language models.
   * @param {string} params.providerId - The ID of the provider.
   * @returns {Promise<LanguageModel[]>} A list of language models.
   */
  public async getLanguageModels(params: {
    providerId: string;
  }): Promise<LanguageModel[]> {
    return this.ipcRenderer.invoke("get-language-models", params);
  }

  /**
   * Gets the language models grouped by providers.
   * @returns {Promise<Record<string, LanguageModel[]>>} A record of language models by provider.
   */
  public async getLanguageModelsByProviders(): Promise<
    Record<string, LanguageModel[]>
  > {
    return this.ipcRenderer.invoke("get-language-models-by-providers");
  }

  /**
   * Creates a custom language model provider.
   * @param {CreateCustomLanguageModelProviderParams} params - The parameters for creating the provider.
   * @returns {Promise<LanguageModelProvider>} The created language model provider.
   */
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

  /**
   * Edits a custom language model provider.
   * @param {CreateCustomLanguageModelProviderParams} params - The parameters for editing the provider.
   * @returns {Promise<LanguageModelProvider>} The edited language model provider.
   */
  public async editCustomLanguageModelProvider(
    params: CreateCustomLanguageModelProviderParams,
  ): Promise<LanguageModelProvider> {
    return this.ipcRenderer.invoke(
      "edit-custom-language-model-provider",
      params,
    );
  }

  /**
   * Creates a custom language model.
   * @param {CreateCustomLanguageModelParams} params - The parameters for creating the model.
   * @returns {Promise<void>}
   */
  public async createCustomLanguageModel(
    params: CreateCustomLanguageModelParams,
  ): Promise<void> {
    await this.ipcRenderer.invoke("create-custom-language-model", params);
  }

  /**
   * Deletes a custom language model.
   * @param {string} modelId - The ID of the model to delete.
   * @returns {Promise<void>}
   */
  public async deleteCustomLanguageModel(modelId: string): Promise<void> {
    return this.ipcRenderer.invoke("delete-custom-language-model", modelId);
  }

  /**
   * Deletes a custom model.
   * @param {DeleteCustomModelParams} params - The parameters for deleting the model.
   * @returns {Promise<void>}
   */
  async deleteCustomModel(params: DeleteCustomModelParams): Promise<void> {
    return this.ipcRenderer.invoke("delete-custom-model", params);
  }

  /**
   * Deletes a custom language model provider.
   * @param {string} providerId - The ID of the provider to delete.
   * @returns {Promise<void>}
   */
  async deleteCustomLanguageModelProvider(providerId: string): Promise<void> {
    return this.ipcRenderer.invoke("delete-custom-language-model-provider", {
      providerId,
    });
  }

  /**
   * Opens a dialog to select an app folder.
   * @returns {Promise<{ path: string | null; name: string | null }>} The selected path and name.
   */
  public async selectAppFolder(): Promise<{
    path: string | null;
    name: string | null;
  }> {
    return this.ipcRenderer.invoke("select-app-folder");
  }

  /**
   * Checks for AI rules in a given path.
   * @param {object} params - The parameters for checking AI rules.
   * @param {string} params.path - The path to check.
   * @returns {Promise<{ exists: boolean }>} Whether AI rules exist.
   */
  public async checkAiRules(params: {
    path: string;
  }): Promise<{ exists: boolean }> {
    return this.ipcRenderer.invoke("check-ai-rules", params);
  }

  /**
   * Imports an app from a given path.
   * @param {ImportAppParams} params - The parameters for importing the app.
   * @returns {Promise<ImportAppResult>} The result of the import.
   */
  public async importApp(params: ImportAppParams): Promise<ImportAppResult> {
    return this.ipcRenderer.invoke("import-app", params);
  }

  /**
   * Checks if an app name already exists.
   * @param {object} params - The parameters for checking the app name.
   * @param {string} params.appName - The name of the app.
   * @returns {Promise<{ exists: boolean }>} Whether the app name exists.
   */
  async checkAppName(params: {
    appName: string;
  }): Promise<{ exists: boolean }> {
    return this.ipcRenderer.invoke("check-app-name", params);
  }

  /**
   * Renames a branch.
   * @param {RenameBranchParams} params - The parameters for renaming the branch.
   * @returns {Promise<void>}
   */
  public async renameBranch(params: RenameBranchParams): Promise<void> {
    await this.ipcRenderer.invoke("rename-branch", params);
  }

  /**
   * Clears the session data.
   * @returns {Promise<void>}
   */
  async clearSessionData(): Promise<void> {
    return this.ipcRenderer.invoke("clear-session-data");
  }

  /**
   * Gets the user's budget information.
   * @returns {Promise<UserBudgetInfo | null>} The user's budget information.
   */
  public async getUserBudget(): Promise<UserBudgetInfo | null> {
    return this.ipcRenderer.invoke("get-user-budget");
  }

  /**
   * Gets the chat context results for an app.
   * @param {object} params - The parameters for getting the chat context.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<ContextPathResults>} The chat context results.
   */
  public async getChatContextResults(params: {
    appId: number;
  }): Promise<ContextPathResults> {
    return this.ipcRenderer.invoke("get-context-paths", params);
  }

  /**
   * Sets the chat context for an app.
   * @param {object} params - The parameters for setting the chat context.
   * @param {number} params.appId - The ID of the app.
   * @param {AppChatContext} params.chatContext - The chat context to set.
   * @returns {Promise<void>}
   */
  public async setChatContext(params: {
    appId: number;
    chatContext: AppChatContext;
  }): Promise<void> {
    await this.ipcRenderer.invoke("set-context-paths", params);
  }

  /**
   * Gets the available upgrades for an app.
   * @param {object} params - The parameters for getting the upgrades.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<AppUpgrade[]>} A list of available upgrades.
   */
  public async getAppUpgrades(params: {
    appId: number;
  }): Promise<AppUpgrade[]> {
    return this.ipcRenderer.invoke("get-app-upgrades", params);
  }

  /**
   * Executes an app upgrade.
   * @param {object} params - The parameters for executing the upgrade.
   * @param {number} params.appId - The ID of the app.
   * @param {string} params.upgradeId - The ID of the upgrade.
   * @returns {Promise<void>}
   */
  public async executeAppUpgrade(params: {
    appId: number;
    upgradeId: string;
  }): Promise<void> {
    return this.ipcRenderer.invoke("execute-app-upgrade", params);
  }

  /**
   * Checks if an app is a Capacitor app.
   * @param {object} params - The parameters for the check.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<boolean>} Whether the app is a Capacitor app.
   */
  public async isCapacitor(params: { appId: number }): Promise<boolean> {
    return this.ipcRenderer.invoke("is-capacitor", params);
  }

  /**
   * Syncs a Capacitor app.
   * @param {object} params - The parameters for the sync.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<void>}
   */
  public async syncCapacitor(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("sync-capacitor", params);
  }

  /**
   * Opens the iOS project for a Capacitor app.
   * @param {object} params - The parameters for opening the project.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<void>}
   */
  public async openIos(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("open-ios", params);
  }

  /**
   * Opens the Android project for a Capacitor app.
   * @param {object} params - The parameters for opening the project.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<void>}
   */
  public async openAndroid(params: { appId: number }): Promise<void> {
    return this.ipcRenderer.invoke("open-android", params);
  }

  /**
   * Checks for problems in an app.
   * @param {object} params - The parameters for the check.
   * @param {number} params.appId - The ID of the app.
   * @returns {Promise<ProblemReport>} A report of the problems found.
   */
  public async checkProblems(params: {
    appId: number;
  }): Promise<ProblemReport> {
    return this.ipcRenderer.invoke("check-problems", params);
  }

  /**
   * Gets the available templates.
   * @returns {Promise<Template[]>} A list of templates.
   */
  public async getTemplates(): Promise<Template[]> {
    return this.ipcRenderer.invoke("get-templates");
  }

  /**
   * Lists all prompts.
   * @returns {Promise<PromptDto[]>} A list of prompts.
   */
  public async listPrompts(): Promise<PromptDto[]> {
    return this.ipcRenderer.invoke("prompts:list");
  }

  /**
   * Creates a new prompt.
   * @param {CreatePromptParamsDto} params - The parameters for creating the prompt.
   * @returns {Promise<PromptDto>} The created prompt.
   */
  public async createPrompt(params: CreatePromptParamsDto): Promise<PromptDto> {
    return this.ipcRenderer.invoke("prompts:create", params);
  }

  /**
   * Updates a prompt.
   * @param {UpdatePromptParamsDto} params - The parameters for updating the prompt.
   * @returns {Promise<void>}
   */
  public async updatePrompt(params: UpdatePromptParamsDto): Promise<void> {
    await this.ipcRenderer.invoke("prompts:update", params);
  }

  /**
   * Deletes a prompt.
   * @param {number} id - The ID of the prompt to delete.
   * @returns {Promise<void>}
   */
  public async deletePrompt(id: number): Promise<void> {
    await this.ipcRenderer.invoke("prompts:delete", id);
  }

  /**
   * Clones a repository from a URL.
   * @param {CloneRepoParams} params - The parameters for cloning the repository.
   * @returns {Promise<{ app: App; hasAiRules: boolean } | { error: string }>} The result of the clone.
   */
  public async cloneRepoFromUrl(
    params: CloneRepoParams,
  ): Promise<{ app: App; hasAiRules: boolean } | { error: string }> {
    return this.ipcRenderer.invoke("github:clone-repo-from-url", params);
  }

  /**
   * Starts a help chat session.
   * @param {string} sessionId - The ID of the session.
   * @param {string} message - The initial message.
   * @param {object} options - The options for the help chat.
   * @param {(delta: string) => void} options.onChunk - The callback for message chunks.
   * @param {() => void} options.onEnd - The callback for the end of the chat.
   * @param {(error: string) => void} options.onError - The callback for errors.
   */
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

  /**
   * Cancels a help chat session.
   * @param {string} sessionId - The ID of the session to cancel.
   */
  public cancelHelpChat(sessionId: string): void {
    this.ipcRenderer.invoke("help:chat:cancel", sessionId).catch(() => {});
  }
}
