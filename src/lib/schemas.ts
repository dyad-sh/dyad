import { z } from "zod";

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
});

/**
 * Type derived from the ChatSummarySchema
 */
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/**
 * Zod schema for an array of chat summaries
 */
export const ChatSummariesSchema = z.array(ChatSummarySchema);

const providers = [
  "openai",
  "anthropic",
  "google",
  "auto",
  "openrouter",
  "ollama",
  "lmstudio",
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
 */
export const ProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
});

/**
 * Type derived from the ProviderSettingSchema
 */
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;

export const RuntimeModeSchema = z.enum(["web-sandbox", "local-node", "unset"]);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const ChatModeSchema = z.enum(["build", "ask"]);
export type ChatMode = z.infer<typeof ChatModeSchema>;

export const GitHubSecretsSchema = z.object({
  accessToken: SecretSchema.nullable(),
});
export type GitHubSecrets = z.infer<typeof GitHubSecretsSchema>;

export const GithubUserSchema = z.object({
  email: z.string(),
});
export type GithubUser = z.infer<typeof GithubUserSchema>;

export const SupabaseSchema = z.object({
  accessToken: SecretSchema.optional(),
  refreshToken: SecretSchema.optional(),
  expiresIn: z.number().optional(),
  tokenTimestamp: z.number().optional(),
});
export type Supabase = z.infer<typeof SupabaseSchema>;

export const ExperimentsSchema = z.object({
  // Deprecated
  enableSupabaseIntegration: z.boolean().describe("DEPRECATED").optional(),
  enableFileEditing: z.boolean().optional(),
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
});
export type AppChatContext = z.infer<typeof AppChatContextSchema>;

export type ContextPathResult = GlobPath & {
  files: number;
  tokens: number;
};

export type ContextPathResults = {
  contextPaths: ContextPathResult[];
  smartContextAutoIncludes: ContextPathResult[];
};

/**
 * Zod schema for user settings
 */
export const UserSettingsSchema = z.object({
  selectedModel: LargeLanguageModelSchema,
  providerSettings: z.record(z.string(), ProviderSettingSchema),
  githubUser: GithubUserSchema.optional(),
  githubAccessToken: SecretSchema.optional(),
  supabase: SupabaseSchema.optional(),
  autoApproveChanges: z.boolean().optional(),
  telemetryConsent: z.enum(["opted_in", "opted_out", "unset"]).optional(),
  telemetryUserId: z.string().optional(),
  hasRunBefore: z.boolean().optional(),
  enableDyadPro: z.boolean().optional(),
  experiments: ExperimentsSchema.optional(),
  lastShownReleaseNotesVersion: z.string().optional(),
  maxChatTurnsInContext: z.number().optional(),
  enableProLazyEditsMode: z.boolean().optional(),
  enableProSmartFilesContextMode: z.boolean().optional(),
  selectedTemplateId: z.string().optional(),
  enableSupabaseWriteSqlMigration: z.boolean().optional(),
  selectedChatMode: ChatModeSchema.optional(),

  enableNativeGit: z.boolean().optional(),

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
 * Type derived from the UserSettingsSchema
 */
export type UserSettings = z.infer<typeof UserSettingsSchema>;

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

export interface SqlQuery {
  content: string;
  description?: string;
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
