import { z } from "zod";
import { isNonGoogleProviderSetup } from "./providerUtils";

export const SecretSchema = z.object({
  value: z.string(),
  encryptionType: z.enum(["electron-safe-storage", "plaintext"]).optional(),
});
export type Secret = z.infer<typeof SecretSchema>;

/**
 * Zod schema for chat summary objects returned by the get-chats IPC
 */
export const ChatSummarySchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string().nullable(),
  createdAt: z.date(),
  chatMode: z.enum(["build", "ask", "local-agent", "plan"]).nullable(),
  isFavorite: z.boolean(),
});

/**
 * Type derived from the ChatSummarySchema
 */
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/**
 * Zod schema for an array of chat summaries
 */
export const ChatSummariesSchema = z.array(ChatSummarySchema);

/**
 * Zod schema for chat search result objects returned by the search-chats IPC
 */
export const ChatSearchResultSchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string().nullable(),
  createdAt: z.date(),
  matchedMessageContent: z.string().nullable(),
});

/**
 * Type derived from the ChatSearchResultSchema
 */
export type ChatSearchResult = z.infer<typeof ChatSearchResultSchema>;

export const ChatSearchResultsSchema = z.array(ChatSearchResultSchema);

// Zod schema for app search result objects returned by the search-app IPC
export const AppSearchResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.date(),
  matchedChatTitle: z.string().nullable(),
  matchedChatMessage: z.string().nullable(),
});

// Type derived from AppSearchResultSchema
export type AppSearchResult = z.infer<typeof AppSearchResultSchema>;

export const AppSearchResultsSchema = z.array(AppSearchResultSchema);

const providers = [
  "openai",
  "anthropic",
  "google",
  "vertex",
  "auto",
  "openrouter",
  "ollama",
  "lmstudio",
  "azure",
  "xai",
  "bedrock",
  "minimax",
] as const;

export const cloudProviders = providers.filter(
  (provider) => provider !== "ollama" && provider !== "lmstudio",
);

/**
 * Zod schema for large language model configuration
 */
export const LargeLanguageModelSchema = z.object({
  name: z.string(),
  provider: z.string(),
  customModelId: z.number().optional(),
});

/**
 * Type derived from the LargeLanguageModelSchema
 */
export type LargeLanguageModel = z.infer<typeof LargeLanguageModelSchema>;

/**
 * Zod schema for provider settings
 * Regular providers use only apiKey. Vertex has additional optional fields.
 */
export const RegularProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
});

export const AzureProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
  resourceName: z.string().optional(),
});

export const VertexProviderSettingSchema = z.object({
  // We make this undefined so that it makes existing callsites easier.
  apiKey: z.undefined(),
  projectId: z.string().optional(),
  location: z.string().optional(),
  serviceAccountKey: SecretSchema.optional(),
});

export const ProviderSettingSchema = z.union([
  // Must use more specific type first!
  // Zod uses the first type that matches.
  //
  // We use passthrough as a hack because Azure and Vertex
  // will match together since their required fields overlap.
  //
  // In addition, there may be future provider settings that
  // we may want to preserve (e.g. user downgrades to older version)
  // so doing passthrough keeps these extra fields.
  AzureProviderSettingSchema.passthrough(),
  VertexProviderSettingSchema.passthrough(),
  RegularProviderSettingSchema.passthrough(),
]);

/**
 * Type derived from the ProviderSettingSchema
 */
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;
export type RegularProviderSetting = z.infer<
  typeof RegularProviderSettingSchema
>;
export type AzureProviderSetting = z.infer<typeof AzureProviderSettingSchema>;
export type VertexProviderSetting = z.infer<typeof VertexProviderSettingSchema>;

export const RuntimeModeSchema = z.enum(["web-sandbox", "local-node", "unset"]);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const RuntimeMode2Schema = z.enum(["host", "docker", "cloud"]);
export type RuntimeMode2 = z.infer<typeof RuntimeMode2Schema>;

/**
 * Chat modes that can be stored in settings (includes deprecated values for backwards compat)
 */
export const StoredChatModeSchema = z.enum([
  "build",
  "ask",
  "agent", // DEPRECATED: converted to "build" on read
  "local-agent",
  "plan",
]);
export type StoredChatMode = z.infer<typeof StoredChatModeSchema>;

/**
 * Active chat modes (excludes deprecated values)
 */
export const ChatModeSchema = z.enum(["build", "ask", "local-agent", "plan"]);
export type ChatMode = z.infer<typeof ChatModeSchema>;

/**
 * Modes that stream through the local agent (tool-calling) path rather than
 * the build-mode path that injects full codebases into the prompt. Keep this
 * in sync with the chat-stream and token-count handlers: whenever a new mode
 * routes through the local agent, add it here so the token estimate matches
 * what's actually sent to the model.
 */
export function isLocalAgentBackedMode(mode: ChatMode | undefined): boolean {
  return mode === "local-agent" || mode === "ask" || mode === "plan";
}

export const GitHubSecretsSchema = z.object({
  accessToken: SecretSchema.nullable(),
});
export type GitHubSecrets = z.infer<typeof GitHubSecretsSchema>;

export const GithubUserSchema = z.object({
  email: z.string(),
});
export type GithubUser = z.infer<typeof GithubUserSchema>;

/**
 * Supabase organization credentials.
 * Each organization has its own OAuth tokens.
 */
export const SupabaseOrganizationCredentialsSchema = z.object({
  accessToken: SecretSchema,
  refreshToken: SecretSchema,
  expiresIn: z.number(),
  tokenTimestamp: z.number(),
});
export type SupabaseOrganizationCredentials = z.infer<
  typeof SupabaseOrganizationCredentialsSchema
>;

export const SupabaseSchema = z.object({
  // Map keyed by organizationSlug -> organization credentials
  organizations: z
    .record(z.string(), SupabaseOrganizationCredentialsSchema)
    .optional(),

  // Legacy fields - kept for backwards compat
  accessToken: SecretSchema.optional(),
  refreshToken: SecretSchema.optional(),
  expiresIn: z.number().optional(),
  tokenTimestamp: z.number().optional(),
});
export type Supabase = z.infer<typeof SupabaseSchema>;

export const NeonSchema = z.object({
  accessToken: SecretSchema.optional(),
  refreshToken: SecretSchema.optional(),
  expiresIn: z.number().optional(),
  tokenTimestamp: z.number().optional(),
});
export type Neon = z.infer<typeof NeonSchema>;

// IMPORTANT: Do NOT add any new experiments here. Instead, add them to BaseUserSettingsFields.
// It's hard to turn experiments on by default when you put them in
// ExperimentsSchema.
export const ExperimentsSchema = z.object({
  enableCloudSandbox: z.boolean().optional(),
  //////////////////////////////////////////////////////////////////////////////
  // Deprecated experiments
  //////////////////////////////////////////////////////////////////////////////
  enableLocalAgent: z.boolean().describe("DEPRECATED").optional(),
  enableSupabaseIntegration: z.boolean().describe("DEPRECATED").optional(),
  enableFileEditing: z.boolean().describe("DEPRECATED").optional(),
  // do NOT read off these property, instead use BaseUserSettingsFields#enableSandboxScriptExecution
  enableSandboxScriptExecution: z.boolean("DEPRECATED").optional(),
});
export type Experiments = z.infer<typeof ExperimentsSchema>;

export const DyadProBudgetSchema = z.object({
  budgetResetAt: z.string(),
  maxBudget: z.number(),
});
export type DyadProBudget = z.infer<typeof DyadProBudgetSchema>;

export const GlobPathSchema = z.object({
  globPath: z.string(),
});

export type GlobPath = z.infer<typeof GlobPathSchema>;

export const AppChatContextSchema = z.object({
  contextPaths: z.array(GlobPathSchema),
  smartContextAutoIncludes: z.array(GlobPathSchema),
  excludePaths: z.array(GlobPathSchema).optional(),
});
export type AppChatContext = z.infer<typeof AppChatContextSchema>;

export type ContextPathResult = GlobPath & {
  files: number;
  tokens: number;
};

export type ContextPathResults = {
  contextPaths: ContextPathResult[];
  smartContextAutoIncludes: ContextPathResult[];
  excludePaths: ContextPathResult[];
};

export const ReleaseChannelSchema = z.enum(["stable", "beta"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const ZoomLevelSchema = z.enum(["90", "100", "110", "125", "150"]);
export type ZoomLevel = z.infer<typeof ZoomLevelSchema>;
export const ZOOM_LEVELS: readonly ZoomLevel[] = ZoomLevelSchema.options;
export const DEFAULT_ZOOM_LEVEL: ZoomLevel = "100";

export const LanguageSchema = z.enum([
  "en",
  "zh-CN",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt-BR",
]);
export type Language = z.infer<typeof LanguageSchema>;

export const DeviceModeSchema = z.enum(["desktop", "tablet", "mobile"]);
export type DeviceMode = z.infer<typeof DeviceModeSchema>;

export const SmartContextModeSchema = z.enum([
  "balanced",
  "conservative",
  "deep",
]);
export type SmartContextMode = z.infer<typeof SmartContextModeSchema>;

export const AgentToolConsentSchema = z.enum(["ask", "always", "never"]);
export type AgentToolConsent = z.infer<typeof AgentToolConsentSchema>;

// The kinds of TypeScript utility process the scheduler can run.
export const TypeScriptUtilityProcessKindSchema = z.enum([
  "code-explorer",
  "supabase-dependency-analysis",
  "tsc",
]);
export type TypeScriptUtilityProcessKind = z.infer<
  typeof TypeScriptUtilityProcessKindSchema
>;

// What the main process was doing when a performance snapshot was taken.
export const PerformanceActivitySchema = z.object({
  activeStreams: z.number(),
  runningApps: z.number(),
  extractCodebase: z.boolean(),
  tsUtilityProcess: TypeScriptUtilityProcessKindSchema.nullable(),
});

// Performance snapshot written by the performance monitor every 30s. Also
// used to parse the snapshot embedded in renderer crash records.
export const LastKnownPerformanceSchema = z.object({
  timestamp: z.number(),
  memoryUsageMB: z.number(),
  cpuUsagePercent: z.number().optional(),
  systemMemoryUsageMB: z.number().optional(),
  systemMemoryTotalMB: z.number().optional(),
  systemCpuPercent: z.number().optional(),
  // Main process V8 heap, from v8.getHeapStatistics().
  heapUsedMB: z.number().optional(),
  heapLimitMB: z.number().optional(),
  // Working set per Electron process type (browser, tab, gpu, utility).
  processWorkingSetsMB: z.record(z.string(), z.number()).optional(),
  // What was running at this snapshot.
  activity: PerformanceActivitySchema.optional(),
  // Session highs. peakRssMB is exact (kernel tracked); the rest are
  // maxima over 30s samples and can miss short spikes.
  peakHeapUsedMB: z.number().optional(),
  peakHeapPct: z.number().optional(),
  peakRssMB: z.number().optional(),
  peakProcessWorkingSetsMB: z.record(z.string(), z.number()).optional(),
  // What was running when a main process peak (heap, RSS) was last set,
  // and when. The per-type working set peaks above are not stamped; they
  // can come from different moments than this pair.
  peakActivity: PerformanceActivitySchema.optional(),
  peakTimestamp: z.number().optional(),
});

/**
 * Base fields shared between StoredUserSettings and UserSettings
 */
const BaseUserSettingsFields = {
  ////////////////////////////////
  // E2E TESTING ONLY.
  ////////////////////////////////
  isTestMode: z.boolean().optional(),

  ////////////////////////////////
  // DEPRECATED.
  ////////////////////////////////
  enableProSaverMode: z.boolean().optional(),
  dyadProBudget: DyadProBudgetSchema.optional(),
  runtimeMode: RuntimeModeSchema.optional(),

  ////////////////////////////////
  // ACTIVE FIELDS.
  ////////////////////////////////
  selectedModel: LargeLanguageModelSchema,
  providerSettings: z.record(z.string(), ProviderSettingSchema),
  agentToolConsents: z.record(z.string(), AgentToolConsentSchema).optional(),
  githubUser: GithubUserSchema.optional(),
  githubAccessToken: SecretSchema.optional(),
  vercelAccessToken: SecretSchema.optional(),
  supabase: SupabaseSchema.optional(),
  neon: NeonSchema.optional(),
  autoApproveChanges: z.boolean().optional(),
  telemetryConsent: z.enum(["opted_in", "opted_out", "unset"]).optional(),
  telemetryUserId: z.string().optional(),
  hasRunBefore: z.boolean().optional(),
  enableDyadPro: z.boolean().optional(),
  experiments: ExperimentsSchema.optional(),
  lastShownReleaseNotesVersion: z.string().optional(),
  maxChatTurnsInContext: z.number().optional(),
  maxToolCallSteps: z.number().optional(),
  thinkingBudget: z.enum(["low", "medium", "high"]).optional(),
  enableProLazyEditsMode: z.boolean().optional(),
  proLazyEditsMode: z.enum(["off", "v1", "v2"]).optional(),
  enableProSmartFilesContextMode: z.boolean().optional(),
  enableProWebSearch: z.boolean().optional(),
  proSmartContextOption: SmartContextModeSchema.optional(),
  selectedTemplateId: z.string(),
  selectedThemeId: z.string().optional(),
  enableSupabaseWriteSqlMigration: z.boolean().optional(),
  autoApproveNonSchemaSql: z.boolean().optional(),
  autoApproveSafeMcpTools: z.boolean().optional(),
  skipPruneEdgeFunctions: z.boolean().optional(),
  acceptedCommunityCode: z.boolean().optional(),
  zoomLevel: ZoomLevelSchema.optional(),
  language: LanguageSchema.optional(),
  previewDeviceMode: DeviceModeSchema.optional(),

  enableAppBlueprint: z.boolean().optional(),
  autoExpandPreviewPanel: z.boolean().optional(),
  enableChatEventNotifications: z.boolean().optional(),
  blockUnsafeNpmPackages: z.boolean().optional(),
  enablePnpmMinimumReleaseAgeWarning: z.boolean().optional(),
  hidePnpmMinimumReleaseAgeWarning: z.boolean().optional(),
  enableSandboxScriptExecution: z.boolean().optional(),
  enableMcpToolSearch: z.boolean().optional(),
  enableCodeExplorer: z.boolean().optional(),
  enableAutoUpdate: z.boolean(),
  releaseChannel: ReleaseChannelSchema,
  runtimeMode2: RuntimeMode2Schema.optional(),
  customNodePath: z.string().optional().nullable(),
  nodeRuntimePreference: z.enum(["system", "managed"]).optional(),
  disablePreviewNodeAutoInstall: z.boolean().optional(),
  customAppsFolder: z.string().optional().nullable(),
  isRunning: z.boolean().optional(),
  lastKnownPerformance: LastKnownPerformanceSchema.optional(),
  hideLocalAgentNewChatToast: z.boolean().optional(),
  enableContextCompaction: z.boolean().optional(),
  skipNotificationBanner: z.boolean().optional(),
  enableSelectAppFromHomeChatInput: z.boolean().optional(),
  previewIdleTimeoutPolicy: z.enum(["default", "never"]).optional(),
};

/**
 * Zod schema for stored user settings (includes deprecated values for backwards compat).
 * This is what gets written to/read from the JSON file.
 */
export const StoredUserSettingsSchema = z
  .object({
    ...BaseUserSettingsFields,
    // Use StoredChatModeSchema to allow deprecated "agent" value
    selectedChatMode: StoredChatModeSchema.optional(),
    defaultChatMode: StoredChatModeSchema.optional(),
    // Deprecated: renamed to enableChatEventNotifications
    enableChatCompletionNotifications: z.boolean().optional(),
    // Deprecated: Dyad always uses the bundled Dugite Git backend.
    enableNativeGit: z.boolean().optional(),
    // Deprecated: Problems checks are manual-only.
    enableAutoFixProblems: z.boolean().optional(),
  })
  // Allow unknown properties to pass through (e.g. future settings
  // that should be preserved if user downgrades to an older version)
  .passthrough();

/**
 * Type derived from the StoredUserSettingsSchema
 */
export type StoredUserSettings = z.infer<typeof StoredUserSettingsSchema>;

/**
 * Zod schema for active user settings (excludes deprecated values).
 * This is what the application uses at runtime.
 */
export const UserSettingsSchema = z
  .object({
    ...BaseUserSettingsFields,
    // Use ChatModeSchema which excludes deprecated "agent" value
    selectedChatMode: ChatModeSchema.optional(),
    defaultChatMode: ChatModeSchema.optional(),
  })
  // Allow unknown properties to pass through (e.g. future settings
  // that should be preserved if user downgrades to an older version)
  .passthrough();

/**
 * Type derived from the UserSettingsSchema
 */
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/**
 * Migrates a stored chat mode to an active chat mode.
 * Converts deprecated "agent" mode to "build".
 */
export function migrateStoredChatMode(
  mode: StoredChatMode | undefined,
): ChatMode | undefined {
  if (mode === "agent") {
    return "build";
  }
  return mode;
}

/**
 * Migrates stored settings to active settings.
 * Applies necessary transformations for deprecated values.
 */
export function migrateStoredSettings(
  stored: StoredUserSettings,
): UserSettings {
  const activeSettings = { ...stored };
  delete activeSettings.enableNativeGit;
  delete activeSettings.enableAutoFixProblems;

  return {
    ...activeSettings,
    selectedChatMode: migrateStoredChatMode(stored.selectedChatMode),
    defaultChatMode: migrateStoredChatMode(stored.defaultChatMode),
    enableChatEventNotifications:
      stored.enableChatEventNotifications ??
      stored.enableChatCompletionNotifications,
    enableAppBlueprint: stored.enableAppBlueprint ?? true,
  };
}

export function isDyadProEnabled(settings: UserSettings): boolean {
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}

export function hasDyadProKey(settings: UserSettings): boolean {
  return !!settings.providerSettings?.auto?.apiKey?.value;
}

type PnpmMinimumReleaseAgeWarningSettings = Pick<
  UserSettings,
  "enablePnpmMinimumReleaseAgeWarning" | "hidePnpmMinimumReleaseAgeWarning"
>;

export function shouldShowPnpmMinimumReleaseAgeWarning(
  settings?: PnpmMinimumReleaseAgeWarningSettings | null,
): boolean {
  return Boolean(
    settings?.enablePnpmMinimumReleaseAgeWarning &&
    !settings.hidePnpmMinimumReleaseAgeWarning,
  );
}

/**
 * Gets the effective default chat mode based on settings, pro status, and free quota availability.
 * - If defaultChatMode is set and valid for the user's Pro status, use it
 * - If defaultChatMode is "local-agent" but user doesn't have Pro:
 *   - If free agent quota available AND a non-Google provider is set up, use "local-agent" (basic agent mode)
 *   - Otherwise, fall back to "build"
 * - If defaultChatMode is NOT set:
 *   - Pro users: use "local-agent"
 *   - Non-Pro users with quota AND a non-Google provider set up: use "local-agent" (basic agent mode)
 *   - Non-Pro users without quota or provider: use "build"
 */
export function getEffectiveDefaultChatMode(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
  freeAgentQuotaAvailable?: boolean,
): ChatMode {
  const isPro = isDyadProEnabled(settings);
  // If user only has a Google/Gemini API key, we don't default to local-agent because
  // most likely it's a free API key with stringent limits and they'll get
  // a bad experience with local-agent.
  const hasNonGoogleProviderSetup = isNonGoogleProviderSetup(settings, envVars);

  if (settings.defaultChatMode) {
    // "local-agent" requires either Pro OR (available free quota AND provider setup)
    if (settings.defaultChatMode === "local-agent") {
      if (isPro) return "local-agent";
      if (freeAgentQuotaAvailable && hasNonGoogleProviderSetup)
        return "local-agent";
      return "build";
    }
    return settings.defaultChatMode;
  }

  // No explicit default set
  if (isPro) return "local-agent";
  if (freeAgentQuotaAvailable && hasNonGoogleProviderSetup)
    return "local-agent";
  return "build";
}

/**
 * Determines if the current session is using Basic Agent mode (free tier with quota).
 * Basic Agent mode is when:
 * - User is NOT a Pro subscriber
 * - User is using local-agent chat mode
 */
export function isBasicAgentMode(settings: UserSettings): boolean {
  return (
    !isDyadProEnabled(settings) && settings.selectedChatMode === "local-agent"
  );
}

export function isSupabaseConnected(settings: UserSettings | null): boolean {
  if (!settings) {
    return false;
  }
  return Boolean(
    settings.supabase?.accessToken ||
    (settings.supabase?.organizations &&
      Object.keys(settings.supabase.organizations).length > 0),
  );
}

export function isTurboEditsV2Enabled(settings: UserSettings): boolean {
  return Boolean(
    isDyadProEnabled(settings) &&
    settings.enableProLazyEditsMode === true &&
    settings.proLazyEditsMode === "v2",
  );
}

// Define interfaces for the props
export interface SecurityRisk {
  type: "warning" | "danger";
  title: string;
  description: string;
}

export interface FileChange {
  name: string;
  path: string;
  summary: string;
  type: "write" | "rename" | "delete";
  isServerFunction: boolean;
}

export interface CodeProposal {
  type: "code-proposal";
  title: string;
  securityRisks: SecurityRisk[];
  filesChanged: FileChange[];
  packagesAdded: string[];
  sqlQueries: SqlQuery[];
}

export type SuggestedAction =
  | RestartAppAction
  | SummarizeInNewChatAction
  | RefactorFileAction
  | WriteCodeProperlyAction
  | RebuildAction
  | RestartAction
  | RefreshAction
  | KeepGoingAction
  | AddTypeScriptAction;

export interface RestartAppAction {
  id: "restart-app";
}

export interface SummarizeInNewChatAction {
  id: "summarize-in-new-chat";
}

export interface WriteCodeProperlyAction {
  id: "write-code-properly";
}

export interface RefactorFileAction {
  id: "refactor-file";
  path: string;
}

export interface RebuildAction {
  id: "rebuild";
}

export interface RestartAction {
  id: "restart";
}

export interface RefreshAction {
  id: "refresh";
}

export interface AddTypeScriptAction {
  id: "add-typescript";
}

export interface KeepGoingAction {
  id: "keep-going";
}

export interface ActionProposal {
  type: "action-proposal";
  actions: SuggestedAction[];
}

export interface TipProposal {
  type: "tip-proposal";
  title: string;
  description: string;
}

export type Proposal = CodeProposal | ActionProposal | TipProposal;

export interface ProposalResult {
  proposal: Proposal;
  chatId: number;
  messageId: number;
}

export interface SqlQuery {
  content: string;
  description?: string;
}
