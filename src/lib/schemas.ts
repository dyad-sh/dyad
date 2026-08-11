import { z } from "zod";
import { isOpenAIOrAnthropicSetup } from "./providerUtils";

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
  "vercel",
  "kimi-code",
  "ollama",
  "lmstudio",
  "mx_serve",
  "azure",
  "xai",
  "bedrock",
  "minimax",
] as const;

export const cloudProviders = providers.filter(
  (provider) =>
    provider !== "ollama" && provider !== "lmstudio" && provider !== "mx_serve",
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

export const ModelRoleSchema = z.enum([
  "chat",
  "image",
  "coding",
  "video",
  "embeddings",
  "ocr",
]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelRoleAssignmentSchema = z.object({
  auto: z.boolean(),
  model: LargeLanguageModelSchema.optional(),
});
export type ModelRoleAssignment = z.infer<typeof ModelRoleAssignmentSchema>;

export const ModelRoleAssignmentsSchema = z
  .object({
    chat: ModelRoleAssignmentSchema.optional(),
    image: ModelRoleAssignmentSchema.optional(),
    coding: ModelRoleAssignmentSchema.optional(),
    video: ModelRoleAssignmentSchema.optional(),
    embeddings: ModelRoleAssignmentSchema.optional(),
    ocr: ModelRoleAssignmentSchema.optional(),
  })
  .optional();
export type ModelRoleAssignments = z.infer<typeof ModelRoleAssignmentsSchema>;

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

/** LM Studio, Ollama, and other local OpenAI-compatible servers */
export const LocalProviderSettingSchema = z.object({
  /** Suppresses a reasoning model's deliberation via /no_think. */
  disableThinking: z.boolean().optional(),
  apiBaseUrl: z.string().optional(),
  apiKey: SecretSchema.optional(),
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
  LocalProviderSettingSchema.passthrough(),
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
export type LocalProviderSetting = z.infer<typeof LocalProviderSettingSchema>;

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
  login: z.string().optional(),
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

/**
 * Vercel Blob cloud storage. A store-scoped read/write token
 * (BLOB_READ_WRITE_TOKEN) connects persistent storage for images/assets.
 */
export const VercelBlobSchema = z.object({
  token: SecretSchema.optional(),
  connectedAt: z.number().optional(),
});
export type VercelBlob = z.infer<typeof VercelBlobSchema>;

export const StorageSettingsSchema = z.object({
  destination: z.enum(["local", "cloud"]).optional(),
  localVaultPath: z.string().optional(),
  autoSync: z.boolean().optional(),
  syncConversations: z.boolean().optional(),
  syncGeneratedMedia: z.boolean().optional(),
  syncSystemNotes: z.boolean().optional(),
  lastSyncedAt: z.number().optional(),
});
export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

export const ResearchPluginsSchema = z.object({
  travelSearch: z
    .object({
      enabled: z.boolean().optional(),
      market: z.string().optional(),
      locale: z.string().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  duckDuckGo: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  coinGecko: z
    .object({
      enabled: z.boolean().optional(),
      plan: z.enum(["public", "demo", "pro"]).optional(),
      apiKey: SecretSchema.optional(),
    })
    .optional(),
  weather: z
    .object({
      enabled: z.boolean().optional(),
      temperatureUnit: z.enum(["celsius", "fahrenheit"]).optional(),
      windSpeedUnit: z.enum(["kmh", "mph"]).optional(),
      forecastDays: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  maps: z
    .object({
      enabled: z.boolean().optional(),
      style: z.enum(["dark", "liberty", "positron"]).optional(),
    })
    .optional(),
  skyscanner: z
    .object({
      enabled: z.boolean().optional(),
      apiKey: SecretSchema.optional(),
      market: z.string().optional(),
      locale: z.string().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  amadeus: z
    .object({
      enabled: z.boolean().optional(),
      environment: z.enum(["test", "production"]).optional(),
      apiKey: SecretSchema.optional(),
      apiSecret: SecretSchema.optional(),
      currency: z.string().optional(),
    })
    .optional(),
  duffel: z
    .object({
      enabled: z.boolean().optional(),
      accessToken: SecretSchema.optional(),
    })
    .optional(),
});
export type ResearchPlugins = z.infer<typeof ResearchPluginsSchema>;

export const ChatAgentSystemAccessSchema = z.object({
  terminal: z.boolean().optional(),
  browser: z.boolean().optional(),
  computer: z.boolean().optional(),
});
export type ChatAgentSystemAccess = z.infer<typeof ChatAgentSystemAccessSchema>;

/**
 * Facebook Page connection used by the Social Media Agent.
 * Posting goes through the Graph API with a Page access token.
 */
export const FacebookConnectionSchema = z.object({
  pageId: z.string(),
  pageName: z.string().optional(),
  pageAccessToken: SecretSchema,
  connectedAt: z.number().optional(),
});
export type FacebookConnection = z.infer<typeof FacebookConnectionSchema>;

/**
 * X (Twitter) connection used by the Social Media Agent.
 * Posting uses OAuth 1.0a user-context credentials from an X developer app.
 */
export const XConnectionSchema = z.object({
  apiKey: SecretSchema,
  apiSecret: SecretSchema,
  accessToken: SecretSchema,
  accessTokenSecret: SecretSchema,
  username: z.string().optional(),
  connectedAt: z.number().optional(),
});
export type XConnection = z.infer<typeof XConnectionSchema>;

export const SocialMediaConnectionsSchema = z.object({
  facebook: FacebookConnectionSchema.optional(),
  x: XConnectionSchema.optional(),
});
export type SocialMediaConnections = z.infer<
  typeof SocialMediaConnectionsSchema
>;

/**
 * How Meta Human OS picks the LLM that powers voice conversations.
 * "agent" routes to a registered Hermes/Agent OS endpoint.
 */
export const JarvisModelModeSchema = z.enum([
  "agent",
  "automatic",
  "chat",
  "voice",
  "custom",
]);
export type JarvisModelMode = z.infer<typeof JarvisModelModeSchema>;

export const JarvisPermissionModeSchema = z.enum(["allow", "confirm"]);
export type JarvisPermissionMode = z.infer<typeof JarvisPermissionModeSchema>;

export const JarvisPermissionsSchema = z.object({
  navigation: JarvisPermissionModeSchema.optional(),
  files: JarvisPermissionModeSchema.optional(),
  builds: JarvisPermissionModeSchema.optional(),
  externalApis: JarvisPermissionModeSchema.optional(),
  /** Destructive actions always confirm; stored for UI display only. */
  requireSpokenConfirmation: z.boolean().optional(),
});
export type JarvisPermissions = z.infer<typeof JarvisPermissionsSchema>;

/**
 * Settings for the Meta Human OS live voice assistant.
 * ElevenLabs provides STT/TTS only; reasoning uses the app's own models.
 */
/**
 * Which voice engine drives a session.
 * - "pipeline": ElevenLabs speech-to-text → your own model → ElevenLabs speech
 * - "realtime": OpenAI Realtime speech-to-speech (lowest latency)
 */
export const JarvisVoiceEngineSchema = z.enum(["pipeline", "realtime"]);
export type JarvisVoiceEngine = z.infer<typeof JarvisVoiceEngineSchema>;

export const JarvisSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  voiceEngine: JarvisVoiceEngineSchema.optional(),
  realtimeModel: z.string().optional(),
  realtimeVoice: z.string().optional(),
  startListeningOnOpen: z.boolean().optional(),
  continueListeningAfterResponse: z.boolean().optional(),
  greeting: z.string().optional(),
  inactivityTimeoutSeconds: z.number().optional(),
  saveTranscripts: z.boolean().optional(),
  showActivityPanel: z.boolean().optional(),
  playInterfaceSounds: z.boolean().optional(),

  // Voice input (ElevenLabs STT)
  elevenLabsApiKey: SecretSchema.optional(),
  sttModelId: z.string().optional(),
  language: z.string().optional(),
  autoDetectLanguage: z.boolean().optional(),
  /** MediaDevices deviceId for the capture device; empty means system default. */
  inputDeviceId: z.string().optional(),
  vadSensitivity: z.number().optional(),
  silenceTimeoutMs: z.number().optional(),
  interruptionSensitivity: z.number().optional(),
  echoCancellation: z.boolean().optional(),
  noiseSuppression: z.boolean().optional(),

  // Voice output (ElevenLabs TTS)
  voiceId: z.string().optional(),
  ttsModelId: z.string().optional(),
  stability: z.number().optional(),
  similarityBoost: z.number().optional(),
  speed: z.number().optional(),
  outputFormat: z.string().optional(),
  streamingLatency: z.number().optional(),
  allowInterruptions: z.boolean().optional(),

  // Intelligence
  modelMode: JarvisModelModeSchema.optional(),
  voiceModel: LargeLanguageModelSchema.optional(),
  /**
   * Agent OS agent id used as the voice brain. Set from the Agents page.
   * When present, Meta Human OS reasons through that agent's endpoint.
   */
  brainAgentId: z.string().optional(),
  preferLocalModels: z.boolean().optional(),
  localModelsOnly: z.boolean().optional(),

  permissions: JarvisPermissionsSchema.optional(),
});
export type JarvisSettings = z.infer<typeof JarvisSettingsSchema>;

export const ExperimentsSchema = z.object({
  // Deprecated
  enableLocalAgent: z.boolean().describe("DEPRECATED").optional(),
  enableSupabaseIntegration: z.boolean().describe("DEPRECATED").optional(),
  enableFileEditing: z.boolean().describe("DEPRECATED").optional(),
  enableCloudSandbox: z.boolean().optional(),
  enableSandboxScriptExecution: z.boolean().optional(),
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

export const AppLayoutModeSchema = z.enum(["landscape", "portrait"]);
export type AppLayoutMode = z.infer<typeof AppLayoutModeSchema>;

export const SmartContextModeSchema = z.enum([
  "balanced",
  "conservative",
  "deep",
]);
export type SmartContextMode = z.infer<typeof SmartContextModeSchema>;

export const AgentToolConsentSchema = z.enum(["ask", "always", "never"]);
export type AgentToolConsent = z.infer<typeof AgentToolConsentSchema>;

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
  vercelBlob: VercelBlobSchema.optional(),
  storage: StorageSettingsSchema.optional(),
  researchPlugins: ResearchPluginsSchema.optional(),
  chatAgentSystemAccess: ChatAgentSystemAccessSchema.optional(),
  socialMedia: SocialMediaConnectionsSchema.optional(),
  /** Meta Human OS live voice assistant configuration. */
  jarvis: JarvisSettingsSchema.optional(),
  /** Vercel AI Gateway API key, used by the Helix coding agent. */
  vercelAiGatewayApiKey: SecretSchema.optional(),
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
  skipPruneEdgeFunctions: z.boolean().optional(),
  acceptedCommunityCode: z.boolean().optional(),
  zoomLevel: ZoomLevelSchema.optional(),
  language: LanguageSchema.optional(),
  previewDeviceMode: DeviceModeSchema.optional(),
  /** Preferred shape of the main application window. */
  appLayoutMode: AppLayoutModeSchema.optional(),

  enableAutoFixProblems: z.boolean().optional(),
  autoExpandPreviewPanel: z.boolean().optional(),
  enableChatEventNotifications: z.boolean().optional(),
  blockUnsafeNpmPackages: z.boolean().optional(),
  enableNativeGit: z.boolean().optional(),
  enableMcpServersForBuildMode: z.boolean().optional(),
  enableAutoUpdate: z.boolean(),
  releaseChannel: ReleaseChannelSchema,
  runtimeMode2: RuntimeMode2Schema.optional(),
  customNodePath: z.string().optional().nullable(),
  customAppsFolder: z.string().optional().nullable(),
  isRunning: z.boolean().optional(),
  lastKnownPerformance: z
    .object({
      timestamp: z.number(),
      memoryUsageMB: z.number(),
      cpuUsagePercent: z.number().optional(),
      systemMemoryUsageMB: z.number().optional(),
      systemMemoryTotalMB: z.number().optional(),
      systemCpuPercent: z.number().optional(),
    })
    .optional(),
  hideLocalAgentNewChatToast: z.boolean().optional(),
  enableContextCompaction: z.boolean().optional(),
  skipNotificationBanner: z.boolean().optional(),
  enableSelectAppFromHomeChatInput: z.boolean().optional(),
  previewIdleTimeoutPolicy: z.enum(["default", "never"]).optional(),
  /** Chat Agent inference model (OpenRouter, OpenAI, or LM Studio). */
  chatAgentModel: LargeLanguageModelSchema.optional(),
  /** Image Agent model — an OpenRouter image-generation model id. */
  imageAgentModel: z.string().optional(),
  /** Video Agent model — a fal.ai video model id. */
  videoAgentModel: z.string().optional(),
  /** Preferred model assignment for each application role. */
  modelRoles: ModelRoleAssignmentsSchema,
  /** MCP server IDs the standalone Chat Agent may call. */
  chatAgentMcpServerIds: z.array(z.number()).optional(),
  /**
   * The project in effect, or absent for none.
   *
   * In settings rather than renderer state because the main process assembles
   * the system prompt, and a project that only the window knows about could
   * not reach it.
   */
  activeProjectId: z.string().nullable().optional(),
  /** MCP tool keys the standalone Chat Agent may call, formatted as `${serverId}:${toolName}`. */
  chatAgentMcpToolKeys: z.array(z.string()).optional(),
  /** MCP workflow keys the standalone Chat Agent may execute, formatted as `${serverId}:${workflowId}`. */
  chatAgentMcpWorkflowKeys: z.array(z.string()).optional(),
  /** Phantom (Hermes) / OpenAI AI coder routing and feature flags. */
  aiCoder: z
    .object({
      provider: z
        .enum(["phantom", "openai", "lmstudio", "openrouter"])
        .optional(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
      openaiModel: z.string().optional(),
      enableForChatAgent: z.boolean().optional(),
      enableForCodeCompletion: z.boolean().optional(),
      streamResponses: z.boolean().optional(),
    })
    .optional(),
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
  return {
    ...stored,
    selectedChatMode: migrateStoredChatMode(stored.selectedChatMode),
    defaultChatMode: migrateStoredChatMode(stored.defaultChatMode),
    enableChatEventNotifications:
      stored.enableChatEventNotifications ??
      stored.enableChatCompletionNotifications,
  };
}

export function isDyadProEnabled(settings: UserSettings): boolean {
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}

export function hasDyadProKey(settings: UserSettings): boolean {
  return !!settings.providerSettings?.auto?.apiKey?.value;
}

/**
 * Gets the effective default chat mode based on settings, pro status, and free quota availability.
 * - If defaultChatMode is set and valid for the user's Pro status, use it
 * - If defaultChatMode is "local-agent" but user doesn't have Pro:
 *   - If free agent quota available AND OpenAI/Anthropic is set up, use "local-agent" (basic agent mode)
 *   - Otherwise, fall back to "build"
 * - If defaultChatMode is NOT set:
 *   - Pro users: use "local-agent"
 *   - Non-Pro users with quota AND OpenAI/Anthropic set up: use "local-agent" (basic agent mode)
 *   - Non-Pro users without quota or provider: use "build"
 */
export function getEffectiveDefaultChatMode(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
  freeAgentQuotaAvailable?: boolean,
): ChatMode {
  const isPro = isDyadProEnabled(settings);
  // We are checking that OpenAI or Anthropic is setup, which are the first two
  // choices for the Auto model selection.
  //
  // If user only has Gemini API key, we don't default to local-agent because
  // most likely it's a free API key with stringent limits and they'll get
  // a bad experience with local-agent.
  const hasPaidProviderSetup = isOpenAIOrAnthropicSetup(settings, envVars);

  if (settings.defaultChatMode) {
    // "local-agent" requires either Pro OR (available free quota AND provider setup)
    if (settings.defaultChatMode === "local-agent") {
      if (isPro) return "local-agent";
      if (freeAgentQuotaAvailable && hasPaidProviderSetup) return "local-agent";
      return "build";
    }
    return settings.defaultChatMode;
  }

  // No explicit default set
  if (isPro) return "local-agent";
  if (freeAgentQuotaAvailable && hasPaidProviderSetup) return "local-agent";
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
  | KeepGoingAction;

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
