import { z } from "zod";

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
  apiKey: z.string().nullable(),
});

/**
 * Type derived from the ProviderSettingSchema
 */
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;

export const RuntimeModeSchema = z.enum(["web-sandbox", "local-node", "unset"]);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const GitHubSecretsSchema = z.object({
  accessToken: z.string().nullable(),
});
export type GitHubSecrets = z.infer<typeof GitHubSecretsSchema>;

export const GitHubSettingsSchema = z.object({
  secrets: GitHubSecretsSchema.nullable(),
});
export type GitHubSettings = z.infer<typeof GitHubSettingsSchema>;

/**
 * Zod schema for user settings
 */
export const UserSettingsSchema = z.object({
  selectedModel: LargeLanguageModelSchema,
  providerSettings: z.record(z.string(), ProviderSettingSchema),
  runtimeMode: RuntimeModeSchema,
  githubSettings: GitHubSettingsSchema,
});

/**
 * Type derived from the UserSettingsSchema
 */
export type UserSettings = z.infer<typeof UserSettingsSchema>;
