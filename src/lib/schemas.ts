import { z } from "zod";

/**
 * Zod schema for a secret value.
 */
export const SecretSchema = z.object({
  value: z.string(),
  encryptionType: z.enum(["electron-safe-storage", "plaintext"]).optional(),
});
export type Secret = z.infer<typeof SecretSchema>;

/**
 * Zod schema for chat summary objects returned by the get-chats IPC.
 */
export const ChatSummarySchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string().nullable(),
  createdAt: z.date(),
});

/**
 * Type derived from the ChatSummarySchema.
 */
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/**
 * Zod schema for an array of chat summaries.
 */
export const ChatSummariesSchema = z.array(ChatSummarySchema);

/**
 * Zod schema for chat search result objects returned by the search-chats IPC.
 */
export const ChatSearchResultSchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string().nullable(),
  createdAt: z.date(),
  matchedMessageContent: z.string().nullable(),
});

/**
 * Type derived from the ChatSearchResultSchema.
 */
export type ChatSearchResult = z.infer<typeof ChatSearchResultSchema>;

/**
 * Zod schema for an array of chat search results.
 */
export const ChatSearchResultsSchema = z.array(ChatSearchResultSchema);

/**
 * Zod schema for app search result objects returned by the search-app IPC.
 */
export const AppSearchResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.date(),
  matchedChatTitle: z.string().nullable(),
  matchedChatMessage: z.string().nullable(),
});

/**
 * Type derived from AppSearchResultSchema.
 */
export type AppSearchResult = z.infer<typeof AppSearchResultSchema>;

/**
 * Zod schema for an array of app search results.
 */
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
] as const;

export const cloudProviders = providers.filter(
  (provider) => provider !== "ollama" && provider !== "lmstudio",
);

/**
 * Zod schema for large language model configuration.
 */
export const LargeLanguageModelSchema = z.object({
  name: z.string(),
  provider: z.string(),
  customModelId: z.number().optional(),
});

/**
 * Type derived from the LargeLanguageModelSchema.
 */
export type LargeLanguageModel = z.infer<typeof LargeLanguageModelSchema>;

/**
 * Zod schema for regular provider settings.
 */
export const RegularProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
});

/**
 * Zod schema for Azure provider settings.
 */
export const AzureProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
  resourceName: z.string().optional(),
});

/**
 * Zod schema for Vertex provider settings.
 */
export const VertexProviderSettingSchema = z.object({
  // We make this undefined so that it makes existing callsites easier.
  apiKey: z.undefined(),
  projectId: z.string().optional(),
  location: z.string().optional(),
  serviceAccountKey: SecretSchema.optional(),
});

/**
 * Zod schema for provider settings.
 * Regular providers use only apiKey. Vertex has additional optional fields.
 */
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
 * Type derived from the ProviderSettingSchema.
 */
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;
/**
 * Type for regular provider settings.
 */
export type RegularProviderSetting = z.infer<
  typeof RegularProviderSettingSchema
>;
/**
 * Type for Azure provider settings.
 */
export type AzureProviderSetting = z.infer<typeof AzureProviderSettingSchema>;
/**
 * Type for Vertex provider settings.
 */
export type VertexProviderSetting = z.infer<typeof VertexProviderSettingSchema>;

/**
 * Zod schema for the runtime mode.
 */
export const RuntimeModeSchema = z.enum(["web-sandbox", "local-node", "unset"]);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

/**
 * Zod schema for the runtime mode 2.
 */
export const RuntimeMode2Schema = z.enum(["host", "docker"]);
export type RuntimeMode2 = z.infer<typeof RuntimeMode2Schema>;

/**
 * Zod schema for the chat mode.
 */
export const ChatModeSchema = z.enum(["build", "ask", "agent"]);
export type ChatMode = z.infer<typeof ChatModeSchema>;

/**
 * Zod schema for GitHub secrets.
 */
export const GitHubSecretsSchema = z.object({
  accessToken: SecretSchema.nullable(),
});
export type GitHubSecrets = z.infer<typeof GitHubSecretsSchema>;

/**
 * Zod schema for a GitHub user.
 */
export const GithubUserSchema = z.object({
  email: z.string(),
});
export type GithubUser = z.infer<typeof GithubUserSchema>;

/**
 * Zod schema for Supabase settings.
 */
export const SupabaseSchema = z.object({
  accessToken: SecretSchema.optional(),
  refreshToken: SecretSchema.optional(),
  expiresIn: z.number().optional(),
  tokenTimestamp: z.number().optional(),
});
export type Supabase = z.infer<typeof SupabaseSchema>;

/**
 * Zod schema for Neon settings.
 */
export const NeonSchema = z.object({
  accessToken: SecretSchema.optional(),
  refreshToken: SecretSchema.optional(),
  expiresIn: z.number().optional(),
  tokenTimestamp: z.number().optional(),
});
export type Neon = z.infer<typeof NeonSchema>;

/**
 * Zod schema for experiments.
 */
export const ExperimentsSchema = z.object({
  // Deprecated
  enableSupabaseIntegration: z.boolean().describe("DEPRECATED").optional(),
  enableFileEditing: z.boolean().describe("DEPRECATED").optional(),
});
export type Experiments = z.infer<typeof ExperimentsSchema>;

/**
 * Zod schema for the Dyad Pro budget.
 */
export const DyadProBudgetSchema = z.object({
  budgetResetAt: z.string(),
  maxBudget: z.number(),
});
export type DyadProBudget = z.infer<typeof DyadProBudgetSchema>;

/**
 * Zod schema for a glob path.
 */
export const GlobPathSchema = z.object({
  globPath: z.string(),
});

export type GlobPath = z.infer<typeof GlobPathSchema>;

/**
 * Zod schema for the app chat context.
 */
export const AppChatContextSchema = z.object({
  contextPaths: z.array(GlobPathSchema),
  smartContextAutoIncludes: z.array(GlobPathSchema),
  excludePaths: z.array(GlobPathSchema).optional(),
});
export type AppChatContext = z.infer<typeof AppChatContextSchema>;

/**
 * Type for a context path result.
 */
export type ContextPathResult = GlobPath & {
  files: number;
  tokens: number;
};

/**
 * Type for context path results.
 */
export type ContextPathResults = {
  contextPaths: ContextPathResult[];
  smartContextAutoIncludes: ContextPathResult[];
  excludePaths: ContextPathResult[];
};

/**
 * Zod schema for the release channel.
 */
export const ReleaseChannelSchema = z.enum(["stable", "beta"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

/**
 * Zod schema for user settings.
 */
export const UserSettingsSchema = z.object({
  selectedModel: LargeLanguageModelSchema,
  providerSettings: z.record(z.string(), ProviderSettingSchema),
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
  thinkingBudget: z.enum(["low", "medium", "high"]).optional(),
  enableProLazyEditsMode: z.boolean().optional(),
  proLazyEditsMode: z.enum(["off", "v1", "v2"]).optional(),
  enableProSmartFilesContextMode: z.boolean().optional(),
  enableProWebSearch: z.boolean().optional(),
  proSmartContextOption: z.enum(["balanced", "conservative"]).optional(),
  selectedTemplateId: z.string(),
  enableSupabaseWriteSqlMigration: z.boolean().optional(),
  selectedChatMode: ChatModeSchema.optional(),
  acceptedCommunityCode: z.boolean().optional(),

  enableAutoFixProblems: z.boolean().optional(),
  enableNativeGit: z.boolean().optional(),
  enableAutoUpdate: z.boolean(),
  releaseChannel: ReleaseChannelSchema,
  runtimeMode2: RuntimeMode2Schema.optional(),
  customNodePath: z.string().optional().nullable(),

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
});

/**
 * Type derived from the UserSettingsSchema.
 */
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/**
 * Checks if Dyad Pro is enabled.
 * @param {UserSettings} settings - The user settings.
 * @returns {boolean} Whether Dyad Pro is enabled.
 */
export function isDyadProEnabled(settings: UserSettings): boolean {
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}

/**
 * Checks if the user has a Dyad Pro key.
 * @param {UserSettings} settings - The user settings.
 * @returns {boolean} Whether the user has a Dyad Pro key.
 */
export function hasDyadProKey(settings: UserSettings): boolean {
  return !!settings.providerSettings?.auto?.apiKey?.value;
}

/**
 * Represents a security risk.
 * @interface
 */
export interface SecurityRisk {
  /** The type of the security risk. */
  type: "warning" | "danger";
  /** The title of the security risk. */
  title: string;
  /** A description of the security risk. */
  description: string;
}

/**
 * Represents a file change.
 * @interface
 */
export interface FileChange {
  /** The name of the file. */
  name: string;
  /** The path to the file. */
  path: string;
  /** A summary of the file change. */
  summary: string;
  /** The type of the file change. */
  type: "write" | "rename" | "delete";
  /** Whether the file is a server function. */
  isServerFunction: boolean;
}

/**
 * Represents a code proposal.
 * @interface
 */
export interface CodeProposal {
  /** The type of the proposal. */
  type: "code-proposal";
  /** The title of the proposal. */
  title: string;
  /** A list of security risks. */
  securityRisks: SecurityRisk[];
  /** A list of files that were changed. */
  filesChanged: FileChange[];
  /** A list of packages that were added. */
  packagesAdded: string[];
  /** A list of SQL queries. */
  sqlQueries: SqlQuery[];
}

/**
 * Represents a suggested action.
 */
export type SuggestedAction =
  | RestartAppAction
  | SummarizeInNewChatAction
  | RefactorFileAction
  | WriteCodeProperlyAction
  | RebuildAction
  | RestartAction
  | RefreshAction
  | KeepGoingAction;

/**
 * Represents a restart app action.
 * @interface
 */
export interface RestartAppAction {
  id: "restart-app";
}

/**
 * Represents a summarize in new chat action.
 * @interface
 */
export interface SummarizeInNewChatAction {
  id: "summarize-in-new-chat";
}

/**
 * Represents a write code properly action.
 * @interface
 */
export interface WriteCodeProperlyAction {
  id: "write-code-properly";
}

/**
 * Represents a refactor file action.
 * @interface
 */
export interface RefactorFileAction {
  id: "refactor-file";
  path: string;
}

/**
 * Represents a rebuild action.
 * @interface
 */
export interface RebuildAction {
  id: "rebuild";
}

/**
 * Represents a restart action.
 * @interface
 */
export interface RestartAction {
  id: "restart";
}

/**
 * Represents a refresh action.
 * @interface
 */
export interface RefreshAction {
  id: "refresh";
}

/**
 * Represents a keep going action.
 * @interface
 */
export interface KeepGoingAction {
  id: "keep-going";
}

/**
 * Represents an action proposal.
 * @interface
 */
export interface ActionProposal {
  /** The type of the proposal. */
  type: "action-proposal";
  /** A list of suggested actions. */
  actions: SuggestedAction[];
}

/**
 * Represents a tip proposal.
 * @interface
 */
export interface TipProposal {
  /** The type of the proposal. */
  type: "tip-proposal";
  /** The title of the tip. */
  title: string;
  /** A description of the tip. */
  description: string;
}

/**
 * Represents a proposal.
 */
export type Proposal = CodeProposal | ActionProposal | TipProposal;

/**
 * Represents a proposal result.
 * @interface
 */
export interface ProposalResult {
  /** The proposal object. */
  proposal: Proposal;
  /** The ID of the chat. */
  chatId: number;
  /** The ID of the message. */
  messageId: number;
}

/**
 * Represents a SQL query.
 * @interface
 */
export interface SqlQuery {
  /** The content of the SQL query. */
  content: string;
  /** A description of the SQL query. */
  description?: string;
}
