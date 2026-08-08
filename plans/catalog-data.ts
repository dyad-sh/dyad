import { z } from "zod";

export const ProviderIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "vertex",
  "openrouter",
  "xai",
]);

export const ThemeGenerationAliasIdSchema = z.enum([
  "dyad/theme-generator/google",
  "dyad/theme-generator/anthropic",
  "dyad/theme-generator/openai",
]);

export const AliasIdSchema = z.enum([
  "dyad/theme-generator/google",
  "dyad/theme-generator/anthropic",
  "dyad/theme-generator/openai",
  "dyad/auto/openai",
  "dyad/auto/anthropic",
  "dyad/auto/google",
  "dyad/help-bot/default",
]);

export const CatalogProviderSchema = z.object({
  id: ProviderIdSchema,
  displayName: z.string(),
  type: z.literal("cloud"),
  hasFreeTier: z.boolean().optional(),
  websiteUrl: z.string().url().optional(),
  secondary: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  gatewayPrefix: z.string().optional(),
});

export const CatalogModelSchema = z.object({
  apiName: z.string(),
  displayName: z.string(),
  description: z.string(),
  tag: z.string().optional(),
  tagColor: z.string().optional(),
  dollarSigns: z.number().int().nonnegative().optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  lifecycle: z
    .object({
      stage: z.enum(["stable", "preview", "deprecated"]).optional(),
    })
    .optional(),
});

export const CatalogAliasSchema = z.object({
  id: AliasIdSchema,
  resolvedModel: z.object({
    providerId: ProviderIdSchema,
    apiName: z.string(),
  }),
  displayName: z.string().optional(),
  purpose: z.enum(["theme-generation", "auto-mode", "help-bot"]).optional(),
});

export const LanguageModelCatalogResponseSchema = z.object({
  version: z.string(),
  expiresAt: z.string().datetime(),
  providers: z.array(CatalogProviderSchema),
  modelsByProvider: z.record(z.string(), z.array(CatalogModelSchema)),
  aliases: z.array(CatalogAliasSchema),
  curatedSelections: z.object({
    themeGenerationOptions: z.array(
      z.object({
        id: ThemeGenerationAliasIdSchema,
        label: z.string(),
      }),
    ),
  }),
});

export type LanguageModelCatalogResponse = z.infer<
  typeof LanguageModelCatalogResponseSchema
>;

const ONE_HOUR_IN_MS = 60 * 60 * 1000;

const providers = [
  {
    id: "openai",
    displayName: "OpenAI",
    type: "cloud",
    websiteUrl: "https://platform.openai.com/docs/models",
    supportsThinking: true,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    type: "cloud",
    websiteUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    supportsThinking: true,
  },
  {
    id: "google",
    displayName: "Google AI Studio",
    type: "cloud",
    hasFreeTier: true,
    websiteUrl: "https://ai.google.dev/gemini-api/docs/models",
    supportsThinking: true,
    gatewayPrefix: "gemini/",
  },
  {
    id: "vertex",
    displayName: "Google Vertex AI",
    type: "cloud",
    websiteUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/models",
    supportsThinking: true,
    gatewayPrefix: "gemini/",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    type: "cloud",
    hasFreeTier: true,
    websiteUrl: "https://openrouter.ai/models",
  },
  {
    id: "xai",
    displayName: "xAI",
    type: "cloud",
    websiteUrl: "https://docs.x.ai/docs/models",
  },
] satisfies z.infer<typeof CatalogProviderSchema>[];

const modelsByProvider = {
  openai: [
    {
      apiName: "gpt-5.2",
      displayName: "GPT 5.2",
      description: "OpenAI's latest flagship model",
      dollarSigns: 3,
      temperature: 1,
      contextWindow: 400_000,
    },
    {
      apiName: "gpt-5.1-codex",
      displayName: "GPT 5.1 Codex",
      description: "OpenAI model optimized for coding workflows",
      dollarSigns: 3,
      temperature: 1,
      contextWindow: 400_000,
    },
    {
      apiName: "gpt-5-mini",
      displayName: "GPT 5 Mini",
      description: "OpenAI lightweight model for faster lower-cost tasks",
      dollarSigns: 2,
      temperature: 1,
      contextWindow: 400_000,
    },
    {
      apiName: "gpt-5-nano",
      displayName: "GPT 5 Nano",
      description: "OpenAI compact budget-friendly model",
      dollarSigns: 1,
      temperature: 1,
      contextWindow: 400_000,
    },
  ],
  anthropic: [
    {
      apiName: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      description: "Anthropic fast and high-quality coding model",
      dollarSigns: 5,
      temperature: 0,
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
    },
    {
      apiName: "claude-opus-4-6",
      displayName: "Claude Opus 4.6",
      description: "Anthropic most capable model",
      dollarSigns: 6,
      temperature: 0,
      maxOutputTokens: 32_000,
      contextWindow: 1_000_000,
    },
  ],
  google: [
    {
      apiName: "gemini-3.1-pro-preview",
      displayName: "Gemini 3.1 Pro (Preview)",
      description: "Google's highest-quality Gemini model",
      dollarSigns: 4,
      temperature: 1,
      maxOutputTokens: 65_535,
      contextWindow: 1_048_576,
      lifecycle: { stage: "preview" },
    },
    {
      apiName: "gemini-3-flash-preview",
      displayName: "Gemini 3 Flash (Preview)",
      description: "Google fast and affordable Gemini model",
      dollarSigns: 2,
      temperature: 1,
      maxOutputTokens: 65_535,
      contextWindow: 1_048_576,
      lifecycle: { stage: "preview" },
    },
    {
      apiName: "gemini-flash-latest",
      displayName: "Gemini 2.5 Flash",
      description: "Google fast Gemini model with broad availability",
      dollarSigns: 2,
      temperature: 0,
      maxOutputTokens: 65_535,
      contextWindow: 1_048_576,
    },
  ],
  vertex: [
    {
      apiName: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      description: "Vertex Gemini 2.5 Pro",
      temperature: 0,
      maxOutputTokens: 65_535,
      contextWindow: 1_048_576,
    },
    {
      apiName: "gemini-flash-latest",
      displayName: "Gemini 2.5 Flash",
      description: "Vertex Gemini 2.5 Flash",
      temperature: 0,
      maxOutputTokens: 65_535,
      contextWindow: 1_048_576,
    },
  ],
  openrouter: [
    {
      apiName: "openrouter/free",
      displayName: "Free (OpenRouter)",
      description: "A rotating free-tier OpenRouter model",
      dollarSigns: 0,
      temperature: 0,
      maxOutputTokens: 32_000,
      contextWindow: 200_000,
    },
    {
      apiName: "moonshotai/kimi-k2.5",
      displayName: "Kimi K2.5",
      description: "Moonshot AI's capable model via OpenRouter",
      dollarSigns: 2,
      temperature: 0,
      maxOutputTokens: 32_000,
      contextWindow: 256_000,
    },
  ],
  xai: [
    {
      apiName: "grok-4",
      displayName: "Grok 4",
      description: "xAI flagship model",
      dollarSigns: 3,
      temperature: 0,
      contextWindow: 256_000,
    },
  ],
} satisfies z.infer<
  typeof LanguageModelCatalogResponseSchema.shape.modelsByProvider
>;

const aliases = [
  {
    id: "dyad/theme-generator/google",
    resolvedModel: {
      providerId: "google",
      apiName: "gemini-3.1-pro-preview",
    },
    displayName: "Google",
    purpose: "theme-generation",
  },
  {
    id: "dyad/theme-generator/anthropic",
    resolvedModel: {
      providerId: "anthropic",
      apiName: "claude-opus-4-6",
    },
    displayName: "Anthropic",
    purpose: "theme-generation",
  },
  {
    id: "dyad/theme-generator/openai",
    resolvedModel: {
      providerId: "openai",
      apiName: "gpt-5.2",
    },
    displayName: "OpenAI",
    purpose: "theme-generation",
  },
  {
    id: "dyad/auto/openai",
    resolvedModel: {
      providerId: "openai",
      apiName: "gpt-5.2",
    },
    displayName: "Auto OpenAI",
    purpose: "auto-mode",
  },
  {
    id: "dyad/auto/anthropic",
    resolvedModel: {
      providerId: "anthropic",
      apiName: "claude-sonnet-4-6",
    },
    displayName: "Auto Anthropic",
    purpose: "auto-mode",
  },
  {
    id: "dyad/auto/google",
    resolvedModel: {
      providerId: "google",
      apiName: "gemini-3-flash-preview",
    },
    displayName: "Auto Google",
    purpose: "auto-mode",
  },
  {
    id: "dyad/help-bot/default",
    resolvedModel: {
      providerId: "openai",
      apiName: "gpt-5-nano",
    },
    displayName: "Help Bot",
    purpose: "help-bot",
  },
] satisfies z.infer<typeof CatalogAliasSchema>[];

export function buildLanguageModelCatalogResponse(
  now = new Date(),
): LanguageModelCatalogResponse {
  return LanguageModelCatalogResponseSchema.parse({
    version: now.toISOString(),
    expiresAt: new Date(now.getTime() + ONE_HOUR_IN_MS).toISOString(),
    providers,
    modelsByProvider,
    aliases,
    curatedSelections: {
      themeGenerationOptions: [
        {
          id: "dyad/theme-generator/google",
          label: "Google",
        },
        {
          id: "dyad/theme-generator/anthropic",
          label: "Anthropic",
        },
        {
          id: "dyad/theme-generator/openai",
          label: "OpenAI",
        },
      ],
    },
  });
}
