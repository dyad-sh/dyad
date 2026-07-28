/**
 * Type-Safe IPC Layer
 *
 * This module provides a unified, type-safe interface for all IPC operations.
 * Contracts define the single source of truth for channel names, input schemas,
 * and output schemas. Clients are auto-generated from contracts.
 *
 * @example
 * // Invoke-response pattern
 * const settings = await ipc.settings.getUserSettings();
 * const { app, chatId } = await ipc.app.createApp({ name: "my-app" });
 *
 * // Streaming pattern
 * ipc.chatStream.start(
 *   { chatId: 123, prompt: "Hello" },
 *   { onChunk, onEnd, onError }
 * );
 *
 * // Event subscription pattern
 * const unsubscribe = ipc.events.agent.onTodosUpdate((payload) => {
 *   updateTodoList(payload.todos);
 * });
 */

// =============================================================================
// Contract Exports
// =============================================================================

export { settingsContracts } from "./settings";
export { appContracts } from "./app";
export { chatContracts, chatStreamContract } from "./chat";
export { agentContracts, agentEvents } from "./agent";
export { githubContracts, gitContracts } from "./github";
export {
  connectionFlowContracts,
  connectionFlowEvents,
} from "./connection_flow";
export { vercelContracts } from "./vercel";
export { supabaseContracts } from "./supabase";
export { neonContracts } from "./neon";
export { migrationContracts } from "./migration";
export { systemContracts, systemEvents } from "./system";
export {
  versionContracts,
  versionEvents,
  versionEventClient,
  MAX_VERSION_NOTE_LENGTH,
} from "./version";
export { languageModelContracts } from "./language-model";
export { promptContracts } from "./prompts";
export { templateContracts } from "./templates";
export { importContracts } from "./import";
export { capacitorContracts } from "./capacitor";
export { contextContracts } from "./context";
export { upgradeContracts } from "./upgrade";
export { visualEditingContracts } from "./visual-editing";
export { securityContracts } from "./security";
export { miscContracts, miscEvents } from "./misc";
export { mediaContracts } from "./media";
export {
  imageGenerationContracts,
  imageGenerationEvents,
} from "./image_generation";
export { appBlueprintContracts, appBlueprintEvents } from "./app_blueprint";
export { appCollectionContracts } from "./app_collections";
export { terminalContracts } from "./terminal";
export { testsContracts, testsEvents } from "./tests";
export { userInputContracts, userInputEvents } from "./user_input";
export { firstPromptSendContracts } from "./first_prompt";
export {
  windowInfrastructureContracts,
  windowInfrastructureEvents,
} from "./window_infrastructure";
export {
  distributedMachineContracts,
  distributedMachineEvents,
} from "./distributed_machines";

// =============================================================================
// Client Exports
// =============================================================================

export { settingsClient } from "./settings";
export { appClient } from "./app";
export { chatClient, chatStreamClient } from "./chat";
export { agentClient, agentEventClient } from "./agent";
export { githubClient, gitClient } from "./github";
export {
  connectionFlowClient,
  connectionFlowEventClient,
} from "./connection_flow";
export { vercelClient } from "./vercel";
export { supabaseClient } from "./supabase";
export { neonClient } from "./neon";
export { migrationClient } from "./migration";
export { systemClient, systemEventClient } from "./system";
export { versionClient } from "./version";
export { languageModelClient } from "./language-model";
export { promptClient } from "./prompts";
export { templateClient } from "./templates";
export { importClient } from "./import";
export { capacitorClient } from "./capacitor";
export { contextClient } from "./context";
export { upgradeClient } from "./upgrade";
export { visualEditingClient } from "./visual-editing";
export { securityClient } from "./security";
export { miscClient, miscEventClient } from "./misc";
export { mediaClient } from "./media";
export {
  imageGenerationClient,
  imageGenerationEventClient,
} from "./image_generation";
export { appBlueprintClient, appBlueprintEventClient } from "./app_blueprint";
export { appCollectionClient } from "./app_collections";
export { terminalClient } from "./terminal";
export { testsClient, testsEventClient } from "./tests";
export { userInputClient, userInputEventClient } from "./user_input";
export { firstPromptClient } from "./first_prompt";
export {
  windowInfrastructureClient,
  windowInfrastructureEventClient,
} from "./window_infrastructure";
export {
  distributedMachineClient,
  distributedMachineEventClient,
} from "./distributed_machines";

// =============================================================================
// Type Exports
// =============================================================================

// Settings types
export type {
  GetUserSettingsInput,
  GetUserSettingsOutput,
  ProviderApiKeyValidationProvider,
  SetUserSettingsInput,
  SetUserSettingsOutput,
  ValidateProviderApiKeyInput,
  ValidateProviderApiKeyOutput,
} from "./settings";

// App types
export type {
  App,
  CreateAppParams,
  CreateAppResult,
  CopyAppParams,
  EditAppFileReturnType,
  RespondToAppInputParams,
  AppFileSearchResult,
  ChangeAppLocationParams,
  ChangeAppLocationResult,
  ListAppsResponse,
  RenameBranchParams,
  UpdateAppCommandsParams,
} from "./app";

// Chat types
export type {
  Message,
  Chat,
  FileAttachment,
  ChatAttachment,
  ChatStreamParams,
  ChatResponseChunk,
  ChatResponseEnd,
  UpdateChatParams,
  TokenCountParams,
  TokenCountResult,
  StreamingPatch,
} from "./chat";

export type {
  ComponentSelection,
  VisualEditingChange,
  ApplyVisualEditingChangesParams,
  AnalyseComponentParams,
} from "./visual-editing";

export type {
  TerminalOpenParams,
  TerminalOpenResult,
  TerminalDataPayload,
  TerminalExitPayload,
} from "./terminal";

// Agent types
export type {
  AgentTool,
  AgentTodo,
  AgentTodosUpdatePayload,
  AgentProblemsUpdatePayload,
  SetAgentToolConsentParams,
  Problem,
  ProblemReport,
} from "./agent";

// GitHub types
export type {
  GitBranchAppIdParams,
  GitBranchParams,
  CreateGitBranchParams,
  RenameGitBranchParams,
  ListRemoteGitBranchesParams,
  CommitChangesParams,
  UncommittedFile,
  UncommittedFileStatus,
  GetUncommittedFileDiffParams,
  UncommittedFileDiff,
  CloneRepoParams,
  GithubRepository,
} from "./github";

// Vercel types
export type {
  VercelProject,
  VercelDeployment,
  SaveVercelAccessTokenParams,
  ConnectToExistingVercelProjectParams,
  IsVercelProjectAvailableParams,
  IsVercelProjectAvailableResponse,
  CreateVercelProjectParams,
  GetVercelDeploymentsParams,
  DisconnectVercelProjectParams,
} from "./vercel";

// Supabase types
export type {
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
  DeleteSupabaseOrganizationParams,
  SetSupabaseAppProjectParams,
  ConsoleEntry,
} from "./supabase";

// Neon types
export type {
  NeonProject,
  NeonProjectListItem,
  NeonBranch,
  CreateNeonProjectParams,
  GetNeonProjectParams,
  GetNeonProjectResponse,
  ListNeonProjectsResponse,
  NeonAuthEmailAndPasswordConfig,
} from "./neon";

// Migration types
export type {
  MigrationMigrateParams,
  MigrationMigrateResponse,
} from "./migration";

// System types
export type {
  NodeSystemInfo,
  ManagedNodeInstallProgress,
  SystemDebugInfo,
  SelectNodeFolderResult,
  DoesReleaseNoteExistParams,
  TelemetryEventPayload,
} from "./system";

// Version types
export type {
  Version,
  BranchResult,
  RevertVersionParams,
  RevertVersionResponse,
  VersionChangedFile,
  CheckoutVersionResponse,
  RestoreToMessageParams,
  RestoreToMessageResponse,
  VersionCommandResult,
} from "./version";

// Language model types
export type {
  LanguageModelProvider,
  LanguageModel,
  LocalModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "./language-model";

// Prompt types
export type {
  PromptDto,
  CreatePromptParamsDto,
  UpdatePromptParamsDto,
} from "./prompts";

// Template types
export type {
  Template,
  Theme,
  SetAppThemeParams,
  GetAppThemeParams,
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  DeleteCustomThemeParams,
} from "./templates";

// Proposal types

// Import types
export type { ImportAppParams, ImportAppResult } from "./import";

// Context types
export type { ContextPathResults, AppChatContext } from "./context";

// Upgrade types
export type { AppUpgrade } from "./upgrade";

// Security types
export type { SecurityReviewResult } from "./security";

// Misc types
export type {
  SessionDebugBundle,
  DeepLinkData,
  AppOutput,
  EnvVar,
} from "./misc";

// Pro types

// Media types
export type {
  MediaFile,
  RenameMediaFileParams,
  DeleteMediaFileParams,
  MoveMediaFileParams,
} from "./media";

// Image generation types
export type {
  ImageThemeMode,
  ImageGenerationResultView,
  ImageGenerationOperationOutcome,
} from "./image_generation";

// Tests types
export type {
  TestSpec,
  TestCase,
  TestRunStatus,
  TestResult,
  TestCaseResult,
  RunAppTestsResult,
  TestIsolation,
  TestOutputPayload,
} from "./tests";
export type {
  UserInputDescriptorPayload,
  UserInputResponsePayload,
  PendingUserInputPayload,
} from "./user_input";

// App blueprint types
export type {
  AppBlueprintVisual,
  AppBlueprintData,
  AppBlueprintUpdatePayload,
  AppBlueprintVisualsUpdatePayload,
  AppBlueprintApprovePayload,
  AppBlueprintFieldEditPayload,
  AppBlueprintApprovedPayload,
} from "./app_blueprint";

// =============================================================================
// Schema Exports (for validation in handlers/components)
// =============================================================================

export {
  AppSchema,
  CreateAppParamsSchema,
  CreateAppResultSchema,
  AppFileSearchResultSchema,
} from "./app";

export {
  MessageSchema,
  ChatSchema,
  ChatAttachmentSchema,
  ChatStreamParamsSchema,
  ChatResponseEndSchema,
} from "./chat";

export {
  AgentTodoSchema,
  AgentTodosUpdateSchema,
  AgentToolSchema,
} from "./agent";

// =============================================================================
// Aggregated IPC Client
// =============================================================================

import { settingsClient } from "./settings";
import { appClient } from "./app";
import { chatClient, chatStreamClient } from "./chat";
import { agentClient, agentEventClient } from "./agent";
import { githubClient, gitClient } from "./github";
import {
  connectionFlowClient,
  connectionFlowEventClient,
} from "./connection_flow";
import { vercelClient } from "./vercel";
import { supabaseClient } from "./supabase";
import { neonClient } from "./neon";
import { migrationClient } from "./migration";
import { systemClient, systemEventClient } from "./system";
import { versionClient } from "./version";
import { languageModelClient } from "./language-model";
import { promptClient } from "./prompts";
import { templateClient } from "./templates";
import { importClient } from "./import";
import { capacitorClient } from "./capacitor";
import { contextClient } from "./context";
import { upgradeClient } from "./upgrade";
import { visualEditingClient } from "./visual-editing";
import { securityClient } from "./security";
import { miscClient, miscEventClient } from "./misc";
import { mediaClient } from "./media";
import {
  imageGenerationClient,
  imageGenerationEventClient,
} from "./image_generation";
import { appBlueprintClient, appBlueprintEventClient } from "./app_blueprint";
import { appCollectionClient } from "./app_collections";
import { terminalClient } from "./terminal";
import { testsClient, testsEventClient } from "./tests";
import { userInputClient, userInputEventClient } from "./user_input";
import { firstPromptClient } from "./first_prompt";
import {
  windowInfrastructureClient,
  windowInfrastructureEventClient,
} from "./window_infrastructure";
import {
  distributedMachineClient,
  distributedMachineEventClient,
} from "./distributed_machines";

/**
 * Unified IPC client with all domains organized by namespace.
 *
 * @example
 * // Settings
 * const settings = await ipc.settings.getUserSettings();
 *
 * // App management
 * const app = await ipc.app.getApp(appId);
 *
 * // Chat operations
 * const chat = await ipc.chat.getChat(chatId);
 *
 * // Streaming
 * ipc.chatStream.start(params, callbacks);
 *
 * // Event subscriptions
 * ipc.events.agent.onTodosUpdate(handler);
 */
export const ipc = {
  // Core domains
  settings: settingsClient,
  app: appClient,
  chat: chatClient,
  agent: agentClient,

  // Streaming clients
  chatStream: chatStreamClient,

  // Integrations
  github: githubClient,
  git: gitClient,
  connectionFlow: connectionFlowClient,
  vercel: vercelClient,
  supabase: supabaseClient,
  neon: neonClient,
  migration: migrationClient,

  // Features
  system: systemClient,
  version: versionClient,
  languageModel: languageModelClient,
  prompt: promptClient,
  template: templateClient,
  import: importClient,
  capacitor: capacitorClient,
  context: contextClient,
  upgrade: upgradeClient,
  visualEditing: visualEditingClient,
  security: securityClient,
  misc: miscClient,
  media: mediaClient,
  appBlueprint: appBlueprintClient,
  appCollection: appCollectionClient,
  terminal: terminalClient,
  tests: testsClient,
  userInput: userInputClient,
  firstPrompt: firstPromptClient,
  windowInfrastructure: windowInfrastructureClient,
  distributedMachine: distributedMachineClient,
  imageGeneration: imageGenerationClient,

  // Event clients for main->renderer pub/sub
  events: {
    agent: agentEventClient,
    connectionFlow: connectionFlowEventClient,
    system: systemEventClient,
    misc: miscEventClient,
    appBlueprint: appBlueprintEventClient,
    tests: testsEventClient,
    userInput: userInputEventClient,
    imageGeneration: imageGenerationEventClient,
    windowInfrastructure: windowInfrastructureEventClient,
    distributedMachine: distributedMachineEventClient,
  },
} as const;
