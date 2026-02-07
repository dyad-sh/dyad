import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Language Model Schemas
// =============================================================================

export const LanguageModelProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  hasFreeTier: z.boolean().optional(),
  websiteUrl: z.string().optional(),
  gatewayPrefix: z.string().optional(),
  secondary: z.boolean().optional(),
  envVarName: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  type: z.enum(["custom", "local", "cloud"]),
  isCustom: z.boolean().optional(),
});

export type LanguageModelProvider = z.infer<typeof LanguageModelProviderSchema>;

export const LanguageModelSchema = z.object({
  id: z.number().optional(),
  apiName: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  tag: z.string().optional(),
  tagColor: z.string().optional(),
  maxOutputTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  temperature: z.number().optional(),
  dollarSigns: z.number().optional(),
  type: z.enum(["custom", "local", "cloud"]).optional(),
});

export type LanguageModel = z.infer<typeof LanguageModelSchema>;

export const LocalModelSchema = z.object({
  provider: z.enum(["ollama", "lmstudio"]),
  modelName: z.string(),
  displayName: z.string(),
});

export type LocalModel = z.infer<typeof LocalModelSchema>;

export const CreateCustomLanguageModelProviderParamsSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiBaseUrl: z.string(),
  envVarName: z.string().optional(),
});

export type CreateCustomLanguageModelProviderParams = z.infer<
  typeof CreateCustomLanguageModelProviderParamsSchema
>;

export const CreateCustomLanguageModelParamsSchema = z.object({
  apiName: z.string(),
  displayName: z.string(),
  providerId: z.string(),
  description: z.string().optional(),
  maxOutputTokens: z.number().optional(),
  contextWindow: z.number().optional(),
});

export type CreateCustomLanguageModelParams = z.infer<
  typeof CreateCustomLanguageModelParamsSchema
>;

export const DeleteCustomModelParamsSchema = z.object({
  providerId: z.string(),
  modelApiName: z.string(),
});

// =============================================================================
// Language Model Contracts
// =============================================================================

export const languageModelContracts = {
  getProviders: defineContract({
    channel: "get-language-model-providers",
    input: z.void(),
    output: z.array(LanguageModelProviderSchema),
  }),

  getModels: defineContract({
    channel: "get-language-models",
    input: z.object({ providerId: z.string() }),
    output: z.array(LanguageModelSchema),
  }),

  getModelsByProviders: defineContract({
    channel: "get-language-models-by-providers",
    input: z.void(),
    output: z.record(z.string(), z.array(LanguageModelSchema)),
  }),

  createCustomProvider: defineContract({
    channel: "create-custom-language-model-provider",
    input: CreateCustomLanguageModelProviderParamsSchema,
    output: LanguageModelProviderSchema,
  }),

  editCustomProvider: defineContract({
    channel: "edit-custom-language-model-provider",
    input: CreateCustomLanguageModelProviderParamsSchema,
    output: LanguageModelProviderSchema,
  }),

  deleteCustomProvider: defineContract({
    channel: "delete-custom-language-model-provider",
    input: z.object({ providerId: z.string() }),
    output: z.void(),
  }),

  createCustomModel: defineContract({
    channel: "create-custom-language-model",
    input: CreateCustomLanguageModelParamsSchema,
    output: z.void(),
  }),

  deleteCustomModel: defineContract({
    channel: "delete-custom-language-model",
    input: z.string(), // modelId
    output: z.void(),
  }),

  deleteModel: defineContract({
    channel: "delete-custom-model",
    input: DeleteCustomModelParamsSchema,
    output: z.void(),
  }),

  listOllamaModels: defineContract({
    channel: "local-models:list-ollama",
    input: z.void(),
    output: z.object({ models: z.array(LocalModelSchema) }),
  }),

  listLMStudioModels: defineContract({
    channel: "local-models:list-lmstudio",
    input: z.void(),
    output: z.object({ models: z.array(LocalModelSchema) }),
  }),
} as const;

// =============================================================================
// Language Model Client
// =============================================================================

export const languageModelClient = createClient(languageModelContracts);
