import { z } from "zod";
import type { ProblemReport, Problem } from "../../shared/tsc_types";
export type { ProblemReport, Problem };

/**
 * Represents the output of an application.
 * @interface
 */
export interface AppOutput {
  /** The type of the output. */
  type: "stdout" | "stderr" | "info" | "client-error" | "input-requested";
  /** The output message. */
  message: string;
  /** The timestamp of the output. */
  timestamp: number;
  /** The ID of the application. */
  appId: number;
}

/**
 * Parameters for responding to an application input request.
 * @interface
 */
export interface RespondToAppInputParams {
  /** The ID of the application. */
  appId: number;
  /** The response to the input request. */
  response: string;
}

/**
 * The response for a request to list applications.
 * @interface
 */
export interface ListAppsResponse {
  /** A list of applications. */
  apps: App[];
  /** The base path of the applications. */
  appBasePath: string;
}

/**
 * Parameters for a chat stream.
 * @interface
 */
export interface ChatStreamParams {
  /** The ID of the chat. */
  chatId: number;
  /** The prompt for the chat. */
  prompt: string;
  /** Whether to redo the last message. */
  redo?: boolean;
  /** A list of file attachments. */
  attachments?: Array<{
    name: string;
    type: string;
    data: string; // Base64 encoded file data
    attachmentType: "upload-to-codebase" | "chat-context"; // FileAttachment type
  }>;
  /** The selected component. */
  selectedComponent: ComponentSelection | null;
}

/**
 * The end of a chat response.
 * @interface
 */
export interface ChatResponseEnd {
  /** The ID of the chat. */
  chatId: number;
  /** Whether files were updated. */
  updatedFiles: boolean;
  /** A list of extra files that were created. */
  extraFiles?: string[];
  /** An error message for extra files. */
  extraFilesError?: string;
}

/**
 * An event for chat problems.
 * @interface
 */
export interface ChatProblemsEvent {
  /** The ID of the chat. */
  chatId: number;
  /** The ID of the application. */
  appId: number;
  /** The problem report. */
  problems: ProblemReport;
}

/**
 * Parameters for creating an application.
 * @interface
 */
export interface CreateAppParams {
  /** The name of the application. */
  name: string;
}

/**
 * The result of creating an application.
 * @interface
 */
export interface CreateAppResult {
  /** The created application. */
  app: {
    id: number;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  /** The ID of the chat associated with the application. */
  chatId: number;
}

/**
 * Represents a message in a chat.
 * @interface
 */
export interface Message {
  /** The ID of the message. */
  id: number;
  /** The role of the message sender. */
  role: "user" | "assistant";
  /** The content of the message. */
  content: string;
  /** The approval state of the message. */
  approvalState?: "approved" | "rejected" | null;
  /** The commit hash associated with the message. */
  commitHash?: string | null;
  /** The database timestamp of the message. */
  dbTimestamp?: string | null;
  /** The creation date of the message. */
  createdAt?: Date | string;
  /** The request ID of the message. */
  requestId?: string | null;
}

/**
 * Represents a chat.
 * @interface
 */
export interface Chat {
  /** The ID of the chat. */
  id: number;
  /** The title of the chat. */
  title: string;
  /** The messages in the chat. */
  messages: Message[];
  /** The initial commit hash of the chat. */
  initialCommitHash?: string | null;
  /** The database timestamp of the chat. */
  dbTimestamp?: string | null;
}

/**
 * Represents an application.
 * @interface
 */
export interface App {
  /** The ID of the application. */
  id: number;
  /** The name of the application. */
  name: string;
  /** The path of the application. */
  path: string;
  /** The files in the application. */
  files: string[];
  /** The creation date of the application. */
  createdAt: Date;
  /** The last update date of the application. */
  updatedAt: Date;
  /** The GitHub organization of the application. */
  githubOrg: string | null;
  /** The GitHub repository of the application.
   * @deprecated Use `githubRepo` instead.
   */
  githubRepo: string | null;
  /** The GitHub branch of the application. */
  githubBranch: string | null;
  /** The Supabase project ID of the application. */
  supabaseProjectId: string | null;
  /** The Supabase parent project ID of the application. */
  supabaseParentProjectId: string | null;
  /** The Supabase project name of the application. */
  supabaseProjectName: string | null;
  /** The Neon project ID of the application. */
  neonProjectId: string | null;
  /** The Neon development branch ID of the application. */
  neonDevelopmentBranchId: string | null;
  /** The Neon preview branch ID of the application. */
  neonPreviewBranchId: string | null;
  /** The Vercel project ID of the application. */
  vercelProjectId: string | null;
  /** The Vercel project name of the application. */
  vercelProjectName: string | null;
  /** The Vercel team slug of the application. */
  vercelTeamSlug: string | null;
  /** The Vercel deployment URL of the application. */
  vercelDeploymentUrl: string | null;
  /** The installation command for the application. */
  installCommand: string | null;
  /** The start command for the application. */
  startCommand: string | null;
  /** Whether the application is a favorite. */
  isFavorite: boolean;
}

/**
 * Represents a version of an application.
 * @interface
 */
export interface Version {
  /** The object ID of the version. */
  oid: string;
  /** The commit message of the version. */
  message: string;
  /** The timestamp of the version. */
  timestamp: number;
  /** The database timestamp of the version. */
  dbTimestamp?: string | null;
}

/**
 * The result of getting the current branch.
 * @typedef {object} BranchResult
 * @property {string} branch - The name of the current branch.
 */
export type BranchResult = { branch: string };

/**
 * The configuration for a sandbox.
 * @interface
 */
export interface SandboxConfig {
  /** The files in the sandbox. */
  files: Record<string, string>;
  /** The dependencies of the sandbox. */
  dependencies: Record<string, string>;
  /** The entry point of the sandbox. */
  entry: string;
}

/**
 * Information about the Node.js system.
 * @interface
 */
export interface NodeSystemInfo {
  /** The version of Node.js. */
  nodeVersion: string | null;
  /** The version of pnpm. */
  pnpmVersion: string | null;
  /** The download URL for Node.js. */
  nodeDownloadUrl: string;
}

/**
 * Information for debugging the system.
 * @interface
 */
export interface SystemDebugInfo {
  /** The version of Node.js. */
  nodeVersion: string | null;
  /** The version of pnpm. */
  pnpmVersion: string | null;
  /** The path to Node.js. */
  nodePath: string | null;
  /** The telemetry ID. */
  telemetryId: string;
  /** The telemetry consent status. */
  telemetryConsent: string;
  /** The telemetry URL. */
  telemetryUrl: string;
  /** The version of Dyad. */
  dyadVersion: string;
  /** The platform of the system. */
  platform: string;
  /** The architecture of the system. */
  architecture: string;
  /** The system logs. */
  logs: string;
  /** The selected language model. */
  selectedLanguageModel: string;
}

/**
 * Represents a local language model.
 * @interface
 */
export interface LocalModel {
  /** The provider of the local model. */
  provider: "ollama" | "lmstudio";
  /** The name of the model used for API calls. */
  modelName: string;
  /** The user-friendly display name of the model. */
  displayName: string;
}

/**
 * The response for a request to list local models.
 * @typedef {object} LocalModelListResponse
 * @property {LocalModel[]} models - A list of local models.
 */
export type LocalModelListResponse = {
  models: LocalModel[];
};

/**
 * Parameters for counting tokens.
 * @interface
 */
export interface TokenCountParams {
  /** The ID of the chat. */
  chatId: number;
  /** The input string. */
  input: string;
}

/**
 * The result of a token count.
 * @interface
 */
export interface TokenCountResult {
  /** The total number of tokens. */
  totalTokens: number;
  /** The number of tokens in the message history. */
  messageHistoryTokens: number;
  /** The number of tokens in the codebase. */
  codebaseTokens: number;
  /** The number of tokens in mentioned applications. */
  mentionedAppsTokens: number;
  /** The number of tokens in the input. */
  inputTokens: number;
  /** The number of tokens in the system prompt. */
  systemPromptTokens: number;
  /** The context window size. */
  contextWindow: number;
}

/**
 * Data for chat logs.
 * @interface
 */
export interface ChatLogsData {
  /** The system debug information. */
  debugInfo: SystemDebugInfo;
  /** The chat object. */
  chat: Chat;
  /** The codebase content. */
  codebase: string;
}

/**
 * Represents a language model provider.
 * @interface
 */
export interface LanguageModelProvider {
  /** The ID of the provider. */
  id: string;
  /** The name of the provider. */
  name: string;
  /** Whether the provider has a free tier. */
  hasFreeTier?: boolean;
  /** The website URL of the provider. */
  websiteUrl?: string;
  /** The gateway prefix for the provider. */
  gatewayPrefix?: string;
  /** Whether the provider is a secondary provider. */
  secondary?: boolean;
  /** The environment variable name for the provider's API key. */
  envVarName?: string;
  /** The base URL for the provider's API. */
  apiBaseUrl?: string;
  /** The type of the provider. */
  type: "custom" | "local" | "cloud";
}

/**
 * Represents a language model.
 * @typedef {object} LanguageModel
 * @property {number} [id] - The ID of the model.
 * @property {string} apiName - The name of the model used for API calls.
 * @property {string} displayName - The user-friendly display name of the model.
 * @property {string} description - A description of the model.
 * @property {string} [tag] - A tag for the model.
 * @property {string} [tagColor] - The color of the tag.
 * @property {number} [maxOutputTokens] - The maximum number of output tokens.
 * @property {number} [contextWindow] - The context window size.
 * @property {number} [temperature] - The temperature for the model.
 * @property {number} [dollarSigns] - The cost rating of the model.
 * @property {"custom" | "local" | "cloud"} type - The type of the model.
 */
export type LanguageModel =
  | {
      id: number;
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      tagColor?: string;
      maxOutputTokens?: number;
      contextWindow?: number;
      temperature?: number;
      dollarSigns?: number;
      type: "custom";
    }
  | {
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      tagColor?: string;
      maxOutputTokens?: number;
      contextWindow?: number;
      temperature?: number;
      dollarSigns?: number;
      type: "local" | "cloud";
    };

/**
 * Parameters for creating a custom language model provider.
 * @interface
 */
export interface CreateCustomLanguageModelProviderParams {
  /** The ID of the provider. */
  id: string;
  /** The name of the provider. */
  name: string;
  /** The base URL for the provider's API. */
  apiBaseUrl: string;
  /** The environment variable name for the provider's API key. */
  envVarName?: string;
}

/**
 * Parameters for creating a custom language model.
 * @interface
 */
export interface CreateCustomLanguageModelParams {
  /** The name of the model used for API calls. */
  apiName: string;
  /** The user-friendly display name of the model. */
  displayName: string;
  /** The ID of the provider. */
  providerId: string;
  /** A description of the model. */
  description?: string;
  /** The maximum number of output tokens. */
  maxOutputTokens?: number;
  /** The context window size. */
  contextWindow?: number;
}

/**
 * Parameters for checking if a release note exists.
 * @interface
 */
export interface DoesReleaseNoteExistParams {
  /** The version to check. */
  version: string;
}

/**
 * The result of approving a proposal.
 * @interface
 */
export interface ApproveProposalResult {
  /** A list of extra files that were created. */
  extraFiles?: string[];
  /** An error message for extra files. */
  extraFilesError?: string;
}

/**
 * Parameters for importing an application.
 * @interface
 */
export interface ImportAppParams {
  /** The path to the application. */
  path: string;
  /** The name of the application. */
  appName: string;
  /** The installation command for the application. */
  installCommand?: string;
  /** The start command for the application. */
  startCommand?: string;
}

/**
 * Parameters for copying an application.
 * @interface
 */
export interface CopyAppParams {
  /** The ID of the application to copy. */
  appId: number;
  /** The new name of the application. */
  newAppName: string;
  /** Whether to copy the history of the application. */
  withHistory: boolean;
}

/**
 * The result of importing an application.
 * @interface
 */
export interface ImportAppResult {
  /** The ID of the imported application. */
  appId: number;
  /** The ID of the chat associated with the application. */
  chatId: number;
}

/**
 * Parameters for renaming a branch.
 * @interface
 */
export interface RenameBranchParams {
  /** The ID of the application. */
  appId: number;
  /** The old name of the branch. */
  oldBranchName: string;
  /** The new name of the branch. */
  newBranchName: string;
}

/**
 * The schema for user budget information.
 */
export const UserBudgetInfoSchema = z.object({
  usedCredits: z.number(),
  totalCredits: z.number(),
  budgetResetDate: z.date(),
});

/**
 * Information about the user's budget.
 * @typedef {object} UserBudgetInfo
 * @property {number} usedCredits - The number of credits used.
 * @property {number} totalCredits - The total number of credits.
 * @property {Date} budgetResetDate - The date when the budget resets.
 */
export type UserBudgetInfo = z.infer<typeof UserBudgetInfoSchema>;

/**
 * Represents a component selection.
 * @interface
 */
export interface ComponentSelection {
  /** The ID of the component. */
  id: string;
  /** The name of the component. */
  name: string;
  /** The relative path to the component. */
  relativePath: string;
  /** The line number of the component. */
  lineNumber: number;
  /** The column number of the component. */
  columnNumber: number;
}

/**
 * Represents an application upgrade.
 * @interface
 */
export interface AppUpgrade {
  /** The ID of the upgrade. */
  id: string;
  /** The title of the upgrade. */
  title: string;
  /** A description of the upgrade. */
  description: string;
  /** The manual upgrade URL. */
  manualUpgradeUrl: string;
  /** Whether the upgrade is needed. */
  isNeeded: boolean;
}

/**
 * The return type for editing an application file.
 * @interface
 */
export interface EditAppFileReturnType {
  /** A warning message. */
  warning?: string;
}

/**
 * Represents an environment variable.
 * @interface
 */
export interface EnvVar {
  /** The key of the environment variable. */
  key: string;
  /** The value of the environment variable. */
  value: string;
}

/**
 * Parameters for setting application environment variables.
 * @interface
 */
export interface SetAppEnvVarsParams {
  /** The ID of the application. */
  appId: number;
  /** The environment variables to set. */
  envVars: EnvVar[];
}

/**
 * Parameters for getting application environment variables.
 * @interface
 */
export interface GetAppEnvVarsParams {
  /** The ID of the application. */
  appId: number;
}

/**
 * Parameters for connecting to an existing Vercel project.
 * @interface
 */
export interface ConnectToExistingVercelProjectParams {
  /** The ID of the Vercel project. */
  projectId: string;
  /** The ID of the application. */
  appId: number;
}

/**
 * The response for a request to check if a Vercel project is available.
 * @interface
 */
export interface IsVercelProjectAvailableResponse {
  /** Whether the project is available. */
  available: boolean;
  /** An error message. */
  error?: string;
}

/**
 * Parameters for creating a Vercel project.
 * @interface
 */
export interface CreateVercelProjectParams {
  /** The name of the project. */
  name: string;
  /** The ID of the application. */
  appId: number;
}

/**
 * Parameters for getting Vercel deployments.
 * @interface
 */
export interface GetVercelDeploymentsParams {
  /** The ID of the application. */
  appId: number;
}

/**
 * Represents a Vercel deployment.
 * @interface
 */
export interface VercelDeployment {
  /** The unique ID of the deployment. */
  uid: string;
  /** The URL of the deployment. */
  url: string;
  /** The state of the deployment. */
  state: string;
  /** The creation timestamp of the deployment. */
  createdAt: number;
  /** The target of the deployment. */
  target: string;
  /** The ready state of the deployment. */
  readyState: string;
}

/**
 * Parameters for disconnecting a Vercel project.
 * @interface
 */
export interface DisconnectVercelProjectParams {
  /** The ID of the application. */
  appId: number;
}

/**
 * Parameters for checking if a Vercel project is available.
 * @interface
 */
export interface IsVercelProjectAvailableParams {
  /** The name of the project. */
  name: string;
}

/**
 * Parameters for saving a Vercel access token.
 * @interface
 */
export interface SaveVercelAccessTokenParams {
  /** The access token. */
  token: string;
}

/**
 * Represents a Vercel project.
 * @interface
 */
export interface VercelProject {
  /** The ID of the project. */
  id: string;
  /** The name of the project. */
  name: string;
  /** The framework of the project. */
  framework: string | null;
}

/**
 * Parameters for updating a chat.
 * @interface
 */
export interface UpdateChatParams {
  /** The ID of the chat. */
  chatId: number;
  /** The new title of the chat. */
  title: string;
}

/**
 * Parameters for uploading a file to the codebase.
 * @interface
 */
export interface UploadFileToCodebaseParams {
  /** The ID of the application. */
  appId: number;
  /** The path to the file. */
  filePath: string;
  /** The base64 encoded file data. */
  fileData: string;
  /** The name of the file. */
  fileName: string;
}

/**
 * The result of uploading a file to the codebase.
 * @interface
 */
export interface UploadFileToCodebaseResult {
  /** Whether the upload was successful. */
  success: boolean;
  /** The path to the uploaded file. */
  filePath: string;
}

/**
 * Represents a prompt data transfer object.
 * @interface
 */
export interface PromptDto {
  /** The ID of the prompt. */
  id: number;
  /** The title of the prompt. */
  title: string;
  /** A description of the prompt. */
  description: string | null;
  /** The content of the prompt. */
  content: string;
  /** The creation date of the prompt. */
  createdAt: Date;
  /** The last update date of the prompt. */
  updatedAt: Date;
}

/**
 * Parameters for creating a prompt.
 * @interface
 */
export interface CreatePromptParamsDto {
  /** The title of the prompt. */
  title: string;
  /** A description of the prompt. */
  description?: string;
  /** The content of the prompt. */
  content: string;
}

/**
 * Parameters for updating a prompt.
 * @interface
 */
export interface UpdatePromptParamsDto extends CreatePromptParamsDto {
  /** The ID of the prompt. */
  id: number;
}

/**
 * Represents a file attachment.
 * @interface
 */
export interface FileAttachment {
  /** The file object. */
  file: File;
  /** The type of the attachment. */
  type: "upload-to-codebase" | "chat-context";
}

/**
 * Parameters for creating a Neon project.
 * @interface
 */
export interface CreateNeonProjectParams {
  /** The name of the project. */
  name: string;
  /** The ID of the application. */
  appId: number;
}

/**
 * Represents a Neon project.
 * @interface
 */
export interface NeonProject {
  /** The ID of the project. */
  id: string;
  /** The name of the project. */
  name: string;
  /** The connection string for the project. */
  connectionString: string;
  /** The ID of the branch. */
  branchId: string;
}

/**
 * Represents a Neon branch.
 * @interface
 */
export interface NeonBranch {
  /** The type of the branch. */
  type: "production" | "development" | "snapshot" | "preview";
  /** The ID of the branch. */
  branchId: string;
  /** The name of the branch. */
  branchName: string;
  /** The last update timestamp of the branch. */
  lastUpdated: string; // ISO timestamp
  /** The ID of the parent branch. */
  parentBranchId?: string;
  /** The name of the parent branch. */
  parentBranchName?: string;
}

/**
 * Parameters for getting a Neon project.
 * @interface
 */
export interface GetNeonProjectParams {
  /** The ID of the application. */
  appId: number;
}

/**
 * The response for a request to get a Neon project.
 * @interface
 */
export interface GetNeonProjectResponse {
  /** The ID of the project. */
  projectId: string;
  /** The name of the project. */
  projectName: string;
  /** The ID of the organization. */
  orgId: string;
  /** A list of branches in the project. */
  branches: NeonBranch[];
}

/**
 * Parameters for reverting a version.
 * @interface
 */
export interface RevertVersionParams {
  /** The ID of the application. */
  appId: number;
  /** The ID of the previous version. */
  previousVersionId: string;
}

/**
 * The response for a request to revert a version.
 * @typedef {object} RevertVersionResponse
 * @property {string} [successMessage] - A success message.
 * @property {string} [warningMessage] - A warning message.
 */
export type RevertVersionResponse =
  | { successMessage: string }
  | { warningMessage: string };

/**
 * Parameters for starting a help chat.
 * @interface
 */
export interface StartHelpChatParams {
  /** The ID of the session. */
  sessionId: string;
  /** The initial message. */
  message: string;
}

/**
 * A chunk of a help chat response.
 * @interface
 */
export interface HelpChatResponseChunk {
  /** The ID of the session. */
  sessionId: string;
  /** The delta of the response. */
  delta: string;
  /** The type of the response. */
  type: "text";
}

/**
 * The reasoning for a help chat response.
 * @interface
 */
export interface HelpChatResponseReasoning {
  /** The ID of the session. */
  sessionId: string;
  /** The delta of the reasoning. */
  delta: string;
  /** The type of the response. */
  type: "reasoning";
}

/**
 * The end of a help chat response.
 * @interface
 */
export interface HelpChatResponseEnd {
  /** The ID of the session. */
  sessionId: string;
}

/**
 * An error in a help chat response.
 * @interface
 */
export interface HelpChatResponseError {
  /** The ID of the session. */
  sessionId: string;
  /** The error message. */
  error: string;
}

/**
 * Represents an MCP server.
 * @interface
 */
export interface McpServer {
  /** The ID of the server. */
  id: number;
  /** The name of the server. */
  name: string;
  /** The transport protocol of the server. */
  transport: string;
  /** The command to run the server. */
  command?: string | null;
  /** The arguments for the command. */
  args?: string[] | null;
  /** The current working directory for the command. */
  cwd?: string | null;
  /** The environment variables for the command. */
  envJson?: Record<string, string> | null;
  /** The URL of the server. */
  url?: string | null;
  /** Whether the server is enabled. */
  enabled: boolean;
  /** The creation timestamp of the server. */
  createdAt: number;
  /** The last update timestamp of the server. */
  updatedAt: number;
}

/**
 * Parameters for creating an MCP server.
 * @typedef {Omit<McpServer, "id" | "createdAt" | "updatedAt">} CreateMcpServer
 */
export interface CreateMcpServer
  extends Omit<McpServer, "id" | "createdAt" | "updatedAt"> {}
/**
 * Parameters for updating an MCP server.
 * @typedef {Partial<McpServer> & Pick<McpServer, "id">} McpServerUpdate
 */
export type McpServerUpdate = Partial<McpServer> & Pick<McpServer, "id">;
/**
 * The type of consent for an MCP tool.
 * @typedef {"ask" | "always" | "denied"} McpToolConsentType
 */
export type McpToolConsentType = "ask" | "always" | "denied";

/**
 * Represents an MCP tool.
 * @interface
 */
export interface McpTool {
  /** The name of the tool. */
  name: string;
  /** A description of the tool. */
  description?: string | null;
  /** The consent level for the tool. */
  consent: McpToolConsentType;
}

/**
 * Represents the consent for an MCP tool.
 * @interface
 */
export interface McpToolConsent {
  /** The ID of the consent. */
  id: number;
  /** The ID of the server. */
  serverId: number;
  /** The name of the tool. */
  toolName: string;
  /** The consent level for the tool. */
  consent: McpToolConsentType;
  /** The last update timestamp of the consent. */
  updatedAt: number;
}

/**
 * Parameters for cloning a repository.
 * @interface
 */
export interface CloneRepoParams {
  /** The URL of the repository. */
  url: string;
  /** The installation command for the repository. */
  installCommand?: string;
  /** The start command for the repository. */
  startCommand?: string;
  /** The name of the application. */
  appName: string;
}

/**
 * Represents a GitHub repository.
 * @interface
 */
export interface GithubRepository {
  /** The name of the repository. */
  name: string;
  /** The full name of the repository. */
  full_name: string;
  /** Whether the repository is private. */
  private: boolean;
}

/**
 * The return type for cloning a repository.
 * @typedef {({ app: App; hasAiRules: boolean } | { error: string })} CloneRepoReturnType
 */
export type CloneRepoReturnType =
  | {
      app: App;
      hasAiRules: boolean;
    }
  | {
      error: string;
    };

/**
 * Represents a Supabase branch.
 * @interface
 */
export interface SupabaseBranch {
  /** The ID of the branch. */
  id: string;
  /** The name of the branch. */
  name: string;
  /** Whether the branch is the default branch. */
  isDefault: boolean;
  /** The project reference of the branch. */
  projectRef: string;
  /** The parent project reference of the branch. */
  parentProjectRef: string;
}

/**
 * Parameters for setting the Supabase project for an application.
 * @interface
 */
export interface SetSupabaseAppProjectParams {
  /** The ID of the project. */
  projectId: string;
  /** The ID of the parent project. */
  parentProjectId?: string;
  /** The ID of the application. */
  appId: number;
}
export interface SetNodePathParams {
  nodePath: string;
}

export interface SelectNodeFolderResult {
  path: string | null;
  canceled?: boolean;
  selectedPath: string | null;
}
