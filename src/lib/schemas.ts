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

/**
 * Zod schema for model provider
 */
export const ModelProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "auto",
  "openrouter",
]);

/**
 * Type derived from the ModelProviderSchema
 */
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/**
 * Zod schema for large language model configuration
 */
export const LargeLanguageModelSchema = z.object({
  name: z.string(),
  provider: ModelProviderSchema,
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
});
export type Supabase = z.infer<typeof SupabaseSchema>;

export const ExperimentsSchema = z.object({
  enableSupabaseIntegration: z.boolean().optional(),
});
export type Experiments = z.infer<typeof ExperimentsSchema>;

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

  experiments: ExperimentsSchema.optional(),
  // DEPRECATED.
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
}

export interface CodeProposal {
  type: "code-proposal";
  title: string;
  securityRisks: SecurityRisk[];
  filesChanged: FileChange[];
  packagesAdded: string[];
  sqlQueries: string[];
}

export interface SuggestedAction {
  id: "restart-app";
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
