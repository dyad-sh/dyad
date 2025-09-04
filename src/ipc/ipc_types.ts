import { z } from "zod";
import type { ProblemReport, Problem } from "../../shared/tsc_types";
export type { ProblemReport, Problem };

export interface AppOutput {
  type: "stdout" | "stderr" | "info" | "client-error" | "input-requested";
  message: string;
  timestamp: number;
  appId: number;
}

export interface RespondToAppInputParams {
  appId: number;
  response: string;
}

export interface ListAppsResponse {
  apps: App[];
  appBasePath: string;
}

export interface ChatStreamParams {
  chatId: number;
  prompt: string;
  redo?: boolean;
  attachments?: Array<{
    name: string;
    type: string;
    data: string; // Base64 encoded file data
    attachmentType: "upload-to-codebase" | "chat-context"; // FileAttachment type
  }>;
  selectedComponent: ComponentSelection | null;
}

export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
}

export interface ChatProblemsEvent {
  chatId: number;
  appId: number;
  problems: ProblemReport;
}

export interface CreateAppParams {
  name: string;
}

export interface CreateAppResult {
  app: {
    id: number;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  chatId: number;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  approvalState?: "approved" | "rejected" | null;
  commitHash?: string | null;
  dbTimestamp?: string | null;
  createdAt?: Date | string;
}

export interface Chat {
  id: number;
  title: string;
  messages: Message[];
  initialCommitHash?: string | null;
  dbTimestamp?: string | null;
}

export interface App {
  id: number;
  name: string;
  path: string;
  files: string[];
  createdAt: Date;
  updatedAt: Date;
  githubOrg: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  supabaseProjectId: string | null;
  supabaseProjectName: string | null;
  neonProjectId: string | null;
  neonDevelopmentBranchId: string | null;
  neonPreviewBranchId: string | null;
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamSlug: string | null;
  vercelDeploymentUrl: string | null;
  installCommand: string | null;
  startCommand: string | null;
}

export interface Version {
  oid: string;
  message: string;
  timestamp: number;
  dbTimestamp?: string | null;
}

export type BranchResult = { branch: string };

export interface SandboxConfig {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  entry: string;
}

export interface NodeSystemInfo {
  nodeVersion: string | null;
  pnpmVersion: string | null;
  nodeDownloadUrl: string;
}

export interface SystemDebugInfo {
  nodeVersion: string | null;
  pnpmVersion: string | null;
  nodePath: string | null;
  telemetryId: string;
  telemetryConsent: string;
  telemetryUrl: string;
  dyadVersion: string;
  platform: string;
  architecture: string;
  logs: string;
  selectedLanguageModel: string;
}

export interface LocalModel {
  provider: "ollama" | "lmstudio";
  modelName: string; // Name used for API calls (e.g., "llama2:latest")
  displayName: string; // User-friendly name (e.g., "Llama 2")
}

export type LocalModelListResponse = {
  models: LocalModel[];
};

export interface TokenCountParams {
  chatId: number;
  input: string;
}

export interface TokenCountResult {
  totalTokens: number;
  messageHistoryTokens: number;
  codebaseTokens: number;
  mentionedAppsTokens: number;
  inputTokens: number;
  systemPromptTokens: number;
  contextWindow: number;
}

export interface ChatLogsData {
  debugInfo: SystemDebugInfo;
  chat: Chat;
  codebase: string;
}

export interface LanguageModelProvider {
  id: string;
  name: string;
  hasFreeTier?: boolean;
  websiteUrl?: string;
  gatewayPrefix?: string;
  secondary?: boolean;
  envVarName?: string;
  apiBaseUrl?: string;
  type: "custom" | "local" | "cloud";
}

export type LanguageModel =
  | {
      id: number;
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
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
      maxOutputTokens?: number;
      contextWindow?: number;
      temperature?: number;
      dollarSigns?: number;
      type: "local" | "cloud";
    };

export interface CreateCustomLanguageModelProviderParams {
  id: string;
  name: string;
  apiBaseUrl: string;
  envVarName?: string;
}

export interface CreateCustomLanguageModelParams {
  apiName: string;
  displayName: string;
  providerId: string;
  description?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
}

export interface DoesReleaseNoteExistParams {
  version: string;
}

export interface ApproveProposalResult {
  extraFiles?: string[];
  extraFilesError?: string;
}

export interface ImportAppParams {
  path: string;
  appName: string;
  installCommand?: string;
  startCommand?: string;
}

export interface CopyAppParams {
  appId: number;
  newAppName: string;
  withHistory: boolean;
}

export interface ImportAppResult {
  appId: number;
  chatId: number;
}

export interface RenameBranchParams {
  appId: number;
  oldBranchName: string;
  newBranchName: string;
}

export const UserBudgetInfoSchema = z.object({
  usedCredits: z.number(),
  totalCredits: z.number(),
  budgetResetDate: z.date(),
});
export type UserBudgetInfo = z.infer<typeof UserBudgetInfoSchema>;

export interface ComponentSelection {
  id: string;
  name: string;
  relativePath: string;
  lineNumber: number;
  columnNumber: number;
}

export interface AppUpgrade {
  id: string;
  title: string;
  description: string;
  manualUpgradeUrl: string;
  isNeeded: boolean;
}

export interface EditAppFileReturnType {
  warning?: string;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface SetAppEnvVarsParams {
  appId: number;
  envVars: EnvVar[];
}

export interface GetAppEnvVarsParams {
  appId: number;
}

export interface ConnectToExistingVercelProjectParams {
  projectId: string;
  appId: number;
}

export interface IsVercelProjectAvailableResponse {
  available: boolean;
  error?: string;
}

export interface CreateVercelProjectParams {
  name: string;
  appId: number;
}

export interface GetVercelDeploymentsParams {
  appId: number;
}

export interface VercelDeployment {
  uid: string;
  url: string;
  state: string;
  createdAt: number;
  target: string;
  readyState: string;
}

export interface DisconnectVercelProjectParams {
  appId: number;
}

export interface IsVercelProjectAvailableParams {
  name: string;
}

export interface SaveVercelAccessTokenParams {
  token: string;
}

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
}

export interface UpdateChatParams {
  chatId: number;
  title: string;
}

export interface UploadFileToCodebaseParams {
  appId: number;
  filePath: string;
  fileData: string; // Base64 encoded file data
  fileName: string;
}

export interface UploadFileToCodebaseResult {
  success: boolean;
  filePath: string;
}

// --- Prompts ---
export interface PromptDto {
  id: number;
  title: string;
  description: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParamsDto {
  title: string;
  description?: string;
  content: string;
}

export interface UpdatePromptParamsDto extends CreatePromptParamsDto {
  id: number;
}

export interface FileAttachment {
  file: File;
  type: "upload-to-codebase" | "chat-context";
}

// --- Neon Types ---
export interface CreateNeonProjectParams {
  name: string;
  appId: number;
}

export interface NeonProject {
  id: string;
  name: string;
  connectionString: string;
  branchId: string;
}

export interface NeonBranch {
  type: "production" | "development" | "snapshot" | "preview";
  branchId: string;
  branchName: string;
  lastUpdated: string; // ISO timestamp
  parentBranchId?: string; // ID of the parent branch
  parentBranchName?: string; // Name of the parent branch
}

export interface GetNeonProjectParams {
  appId: number;
}

export interface GetNeonProjectResponse {
  projectId: string;
  projectName: string;
  orgId: string;
  branches: NeonBranch[];
}

export interface RevertVersionParams {
  appId: number;
  previousVersionId: string;
}

export type RevertVersionResponse =
  | { successMessage: string }
  | { warningMessage: string };

// --- Help Bot Types ---
export interface StartHelpChatParams {
  sessionId: string;
  message: string;
}

export interface HelpChatResponseChunk {
  sessionId: string;
  delta: string;
  type: "text";
}

export interface HelpChatResponseReasoning {
  sessionId: string;
  delta: string;
  type: "reasoning";
}

export interface HelpChatResponseEnd {
  sessionId: string;
}

export interface HelpChatResponseError {
  sessionId: string;
  error: string;
}
