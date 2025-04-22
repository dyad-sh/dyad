export interface AppOutput {
  type: "stdout" | "stderr" | "info" | "client-error";
  message: string;
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
}

export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
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
}

export interface Chat {
  id: number;
  title: string;
  messages: Message[];
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
