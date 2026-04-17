import { z } from "zod";
import type { ProblemReport, Problem } from "../../shared/tsc_types";
export type { ProblemReport, Problem };

export interface AppOutput {
  type: "stdout" | "stderr" | "info" | "client-error" | "input-requested" | "process-exited";
  message: string;
  timestamp: number;
  appId: number;
}

export interface SecurityFinding {
  title: string;
  level: "critical" | "high" | "medium" | "low";
  description: string;
}

export interface SecurityReviewResult {
  findings: SecurityFinding[];
  timestamp: string;
  chatId: number;
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
  selectedComponents?: ComponentSelection[];
}

export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
  totalTokens?: number;
  contextWindow?: number;
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
  sourceCommitHash?: string | null;
  dbTimestamp?: string | null;
  createdAt?: Date | string;
  requestId?: string | null;
  totalTokens?: number | null;
  model?: string | null;
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
  projectId: number | null;
  githubOrg: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  supabaseProjectId: string | null;
  supabaseParentProjectId: string | null;
  supabaseProjectName: string | null;
  supabaseOrganizationSlug: string | null;
  neonProjectId: string | null;
  neonDevelopmentBranchId: string | null;
  neonPreviewBranchId: string | null;
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamSlug: string | null;
  vercelDeploymentUrl: string | null;
  installCommand: string | null;
  startCommand: string | null;
  isFavorite: boolean;
}

export interface Version {
  oid: string;
  message: string;
  timestamp: number;
  dbTimestamp?: string | null;
}

export type BranchResult = { branch: string | null };

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
  joyVersion: string;
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
  estimatedTotalTokens: number;
  actualMaxTokens: number | null;
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
  redactedUserId: z.string(),
});
export type UserBudgetInfo = z.infer<typeof UserBudgetInfoSchema>;

export interface ComponentSelection {
  id: string;
  name: string;
  runtimeId?: string; // Unique runtime ID for duplicate components
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
  currentChatMessageId?: {
    chatId: number;
    messageId: number;
  };
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

// --- MCP Types ---
export interface McpServer {
  id: number;
  name: string;
  transport: string;
  command?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  envJson?: Record<string, string> | null;
  url?: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMcpServer
  extends Omit<McpServer, "id" | "createdAt" | "updatedAt"> {}
export type McpServerUpdate = Partial<McpServer> & Pick<McpServer, "id">;
export type McpToolConsentType = "ask" | "always" | "denied";

export interface McpTool {
  name: string;
  description?: string | null;
  consent: McpToolConsentType;
}

export interface McpToolConsent {
  id: number;
  serverId: number;
  toolName: string;
  consent: McpToolConsentType;
  updatedAt: number;
}
export interface CloneRepoParams {
  url: string;
  installCommand?: string;
  startCommand?: string;
  appName: string;
}

export interface GithubRepository {
  name: string;
  full_name: string;
  private: boolean;
}

export type CloneRepoReturnType =
  | {
      app: App;
      hasAiRules: boolean;
    }
  | {
      error: string;
    };

export interface SupabaseBranch {
  id: string;
  name: string;
  isDefault: boolean;
  projectRef: string;
  parentProjectRef: string;
}

/**
 * Supabase organization info for display (without secrets).
 */
export interface SupabaseOrganizationInfo {
  organizationSlug: string;
  name?: string;
  ownerEmail?: string;
}

/**
 * Supabase project info.
 */
export interface SupabaseProject {
  id: string;
  name: string;
  region?: string;
  organizationSlug: string;
}

export interface SetSupabaseAppProjectParams {
  projectId: string;
  parentProjectId?: string;
  appId: number;
  organizationSlug: string | null;
}

export interface DeleteSupabaseOrganizationParams {
  organizationSlug: string;
}

// Supabase Logs
export interface LogMetadata {
  // For Edge Functions
  function?: string;
  request_id?: string;
  status?: number;

  // For Database logs
  query?: string;
  table?: string;
  rows_affected?: number;

  // For Auth logs
  user_id?: string;
  event?: string;

  // Additional dynamic fields
  [key: string]: any;
}

export interface SupabaseLog {
  id: string;
  timestamp: string;
  log_type: "function" | "database" | "auth" | "api" | "realtime" | "system";
  event_message: string;
  metadata?: LogMetadata;
  body?: any;
}

export interface SetNodePathParams {
  nodePath: string;
}

export interface SelectNodeFolderResult {
  path: string | null;
  canceled?: boolean;
  selectedPath: string | null;
}

export interface VisualEditingChange {
  componentId: string;
  componentName: string;
  relativePath: string;
  lineNumber: number;
  styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };
    dimensions?: { width?: string; height?: string };
    border?: { width?: string; radius?: string; color?: string };
    backgroundColor?: string;
    text?: {
      fontSize?: string;
      fontWeight?: string;
      color?: string;
      fontFamily?: string;
    };
  };
  textContent?: string;
}

export interface ApplyVisualEditingChangesParams {
  appId: number;
  changes: VisualEditingChange[];
}

export interface AnalyseComponentParams {
  appId: number;
  componentId: string;
}

// --- Agent Tool Types ---
export interface AgentTool {
  name: string;
  description: string;
  isAllowedByDefault: boolean;
  consent: AgentToolConsent;
}

export interface SetAgentToolConsentParams {
  toolName: string;
  consent: AgentToolConsent;
}

export interface AgentToolConsentRequestPayload {
  requestId: string;
  chatId: number;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
}

export type AgentToolConsentDecision =
  | "accept-once"
  | "accept-always"
  | "decline";

export interface AgentToolConsentResponseParams {
  requestId: string;
  decision: AgentToolConsentDecision;
}

// ============================================================================
// Consent Types
// ============================================================================

export type AgentToolConsent = "ask" | "always";

export interface TelemetryEventPayload {
  eventName: string;
  properties?: Record<string, unknown>;
}

// ============================================================================
// Model Factory Types (Training)
// ============================================================================

export interface ModelFactorySystemInfo {
  hasGPU: boolean;
  gpuName?: string;
  gpuVRAM?: number;
  cudaVersion?: string;
  hasPython: boolean;
  pythonVersion?: string;
  hasTransformers: boolean;
  hasBitsAndBytes: boolean;
  hasUnsloth: boolean;
  recommendedMethod: string;
  recommendedQuantization: string;
  maxBatchSize: number;
}

export interface CreateTrainingJobParams {
  name: string;
  description?: string;
  baseModelSource: "huggingface" | "local" | "ollama";
  baseModelId: string;
  method: "lora" | "qlora" | "dora" | "full";
  datasetPath: string;
  datasetFormat: "alpaca" | "sharegpt" | "dolly" | "raw" | "custom";
  hyperparameters: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    loraRank?: number;
    loraAlpha?: number;
    loraDropout?: number;
    use4bit?: boolean;
    use8bit?: boolean;
    gradientCheckpointing?: boolean;
  };
  outputPath?: string;
  tags?: string[];
}

export interface TrainingJobInfo {
  id: string;
  name: string;
  description?: string;
  baseModelId: string;
  method: string;
  status: string;
  progress: number;
  currentEpoch?: number;
  totalEpochs?: number;
  currentStep?: number;
  totalSteps?: number;
  currentLoss?: number;
  gpuMemoryUsed?: number;
  elapsedTime?: number;
  estimatedTimeRemaining?: number;
  error?: string;
  outputPath?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TrainingProgressEvent {
  jobId: string;
  status: string;
  progress: number;
  currentEpoch: number;
  totalEpochs: number;
  currentStep: number;
  totalSteps: number;
  loss?: number;
  learningRate?: number;
  gpuMemoryUsed?: number;
  tokensPerSecond?: number;
}

export interface TrainingMetricsEvent {
  jobId: string;
  step: number;
  epoch: number;
  trainLoss: number;
  evalLoss?: number;
  learningRate: number;
  gradientNorm?: number;
}

export interface ExportModelParams {
  jobId: string;
  format: "safetensors" | "pytorch" | "gguf" | "onnx";
  quantization?: string;
  mergeAdapter?: boolean;
  outputPath?: string;
}

export interface ImportAdapterParams {
  name: string;
  path: string;
  baseModelId: string;
  description?: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  description?: string;
  baseModelId: string;
  method: string;
  rank?: number;
  alpha?: number;
  path: string;
  sizeBytes: number;
  createdAt: number;
}

// ============================================================================
// Agent Factory Types
// ============================================================================

export interface CreateCustomAgentParams {
  name: string;
  displayName: string;
  description: string;
  type: string;
  personality?: string;
  baseModelProvider: "ollama" | "lmstudio" | "transformers" | "custom";
  baseModelId: string;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  adapterId?: string;
  tags?: string[];
}

export interface CustomAgentInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: string;
  personality: string;
  baseModelId: string;
  systemPrompt: string;
  status: string;
  adapterId?: string;
  adapterName?: string;
  version: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateCustomAgentParams {
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  adapterId?: string;
  tags?: string[];
}

export interface StartAgentTrainingParams {
  agentId: string;
  datasetPath: string;
  datasetFormat: string;
  method: "lora" | "qlora" | "dora";
  hyperparameters: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    loraRank?: number;
    loraAlpha?: number;
    use4bit?: boolean;
    gradientCheckpointing?: boolean;
  };
}

// ============================================================================
// Dataset Training Types (Training Center)
// ============================================================================

export interface DatasetTrainingParams {
  name: string;
  description?: string;
  datasetId: string;
  baseModelSource: "huggingface" | "local" | "ollama";
  baseModelId: string;
  method: "lora" | "qlora" | "dora" | "full";
  datasetFormat: "alpaca" | "sharegpt" | "oasst" | "raw";
  autoSplitRatio?: number;
  filterByModality?: "text" | "image" | "audio" | "video";
  minQualityScore?: number;
  hyperparameters: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    loraRank?: number;
    loraAlpha?: number;
    loraDropout?: number;
    use4bit?: boolean;
    use8bit?: boolean;
    gradientCheckpointing?: boolean;
  };
  outputName?: string;
  openAiConfig?: {
    apiKey: string;
    model: string;
    suffix?: string;
    nEpochs?: number;
    batchSize?: number;
    learningRateMultiplier?: number;
  };
}

export interface DatasetTrainingStatus {
  jobId: string;
  name: string;
  datasetId: string;
  datasetName: string;
  baseModelId: string;
  method: string;
  provider: "local" | "openai";
  status: "preparing" | "uploading" | "queued" | "training" | "completed" | "failed" | "cancelled";
  progress: number;
  currentEpoch?: number;
  totalEpochs?: number;
  currentStep?: number;
  totalSteps?: number;
  currentLoss?: number;
  gpuMemoryUsed?: number;
  elapsedTime?: number;
  estimatedTimeRemaining?: number;
  itemsProcessed: number;
  totalDatasetItems: number;
  error?: string;
  outputPath?: string;
  openAiJobId?: string;
  openAiModelId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TrainedModelInfo {
  id: string;
  name: string;
  baseModelId: string;
  method: string;
  datasetId?: string;
  datasetName?: string;
  provider: "local" | "openai";
  status: "training" | "completed" | "failed";
  adapterPath?: string;
  openAiModelId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface ListBaseModelsResult {
  local: Array<{ id: string; name: string; size?: string; quantization?: string }>;
  openai: Array<{ id: string; name: string; description: string }>;
}

export interface TrainingSystemInfo extends ModelFactorySystemInfo {
  hasOpenAiKey: boolean;
  openAiModels: string[];
}

export interface AddAgentSkillParams {
  agentId: string;
  name: string;
  description: string;
  type: "prompt" | "function" | "tool";
  implementation: string;
  examples?: { input: string; output: string }[];
}

export interface AddAgentToolParams {
  agentId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  implementation: {
    type: "builtin" | "custom" | "mcp" | "api";
    code?: string;
    mcpServerId?: number;
    mcpToolName?: string;
    apiEndpoint?: string;
  };
  requiresApproval?: boolean;
}

export interface TestAgentParams {
  agentId: string;
  input: string;
  context?: string;
  useAdapter?: boolean;
}

export interface TestAgentResult {
  output: string;
  reasoning?: string;
  toolCalls?: unknown[];
  tokensUsed: number;
  responseTimeMs: number;
}

// ============================================================================
// OpenClaw Gateway Types
// ============================================================================

export interface OpenClawGatewayStatus {
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  connectedAt?: number;
  lastHeartbeat?: number;
  reconnectAttempts: number;
  error?: string;
  version?: string;
  activePlugins: string[];
  connectedClients: number;
  /** True when operating in bridge mode (client to external OpenClaw gateway) */
  bridged?: boolean;
}

export interface OpenClawProviderStatus {
  name: string;
  enabled: boolean;
  healthy: boolean;
  type: string;
  model: string;
  priority: number;
  capabilities: string[];
  hasApiKey: boolean;
}

export interface OpenClawChatParams {
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
  }>;
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  systemPrompt?: string;
  capabilities?: string[];
}

export interface OpenClawChatResult {
  id: string;
  message: {
    role: "assistant";
    content: string;
  };
  finishReason: "stop" | "length" | "tool_calls" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  latencyMs: number;
  localProcessed: boolean;
}

export interface OpenClawAgentTaskParams {
  id?: string;
  type: "research" | "build" | "analyze" | "optimize" | "automate" | "custom";
  objective: string;
  context?: string;
  constraints?: string[];
  provider?: string;
  preferLocal?: boolean;
  maxIterations?: number;
  timeout?: number;
}

export interface OpenClawAgentTaskResult {
  taskId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: unknown;
  artifacts?: Array<{
    id: string;
    type: string;
    name: string;
    content: string;
    language?: string;
  }>;
  iterations: number;
  tokensUsed: number;
  providersUsed: string[];
  error?: string;
}

export interface OpenClawClaudeCodeTaskParams {
  id?: string;
  type: string;
  description: string;
  targetPath?: string;
  content?: string;
  searchQuery?: string;
  command?: string;
}

export interface OpenClawClaudeCodeResult {
  taskId: string;
  success: boolean;
  changes?: Array<{
    type: "create" | "modify" | "delete";
    path: string;
    diff?: string;
  }>;
  output?: string;
  error?: string;
}

export interface OpenClawQuickGenerateParams {
  prompt: string;
  language?: string;
  context?: string;
  useLocal?: boolean;
}

export interface OpenClawQuickGenerateResult {
  code: string;
  provider: string;
  model: string;
  localProcessed: boolean;
}

export interface OpenClawAutonomousAppParams {
  name: string;
  description: string;
  features: string[];
  techStack?: string[];
  useLocal?: boolean;
}

export interface OpenClawConfigureProviderParams {
  name: string;
  config: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    enabled?: boolean;
    priority?: number;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface ImageStudioImage {
  id: number;
  prompt: string;
  negativePrompt: string | null;
  provider: string;
  model: string;
  width: number;
  height: number;
  filePath: string;
  seed: string | null;
  style: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ImageStudioProviderModel {
  id: string;
  label: string;
  supportsImg2Img?: boolean;
  supportsNegativePrompt?: boolean;
}

export interface ImageStudioProvider {
  id: string;
  label: string;
  models: ImageStudioProviderModel[];
  supportsUpscale?: boolean;
}

// ── Video Studio Types ─────────────────────────────────────────────────────────

export interface VideoStudioVideo {
  id: number;
  prompt: string;
  negativePrompt: string | null;
  provider: string;
  model: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  format: string;
  filePath: string;
  thumbnailPath: string | null;
  seed: string | null;
  style: string | null;
  sourceType: string;
  sourceId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface VideoStudioProviderModel {
  id: string;
  label: string;
  supportsImg2Video?: boolean;
  supportsVideoExtend?: boolean;
  supportsVideo2Video?: boolean;
  maxDurationSeconds?: number;
  defaultFps?: number;
}

export interface VideoStudioProvider {
  id: string;
  label: string;
  models: VideoStudioProviderModel[];
}
