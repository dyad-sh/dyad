export interface AppOutput {
  type: "stdout" | "stderr" | "info" | "client-error";
  message: string;
  timestamp: number;
  appId: number;
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
  }>;
}

export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
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
}

export interface Chat {
  id: number;
  title: string;
  messages: Message[];
  initialCommitHash?: string | null;
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
  supabaseProjectId: string | null;
  supabaseProjectName: string | null;
}

export interface Version {
  oid: string;
  message: string;
  timestamp: number;
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
      type: "custom";
    }
  | {
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      maxOutputTokens?: number;
      contextWindow?: number;
      supportsTurboEdits?: boolean;
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
}

export interface ImportAppResult {
  appId: number;
  chatId: number;
}
