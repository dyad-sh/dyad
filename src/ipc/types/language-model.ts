import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

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

export const EffortSettingsSchema = z
  .object({
    defaultEffortLevel: z.string().trim().min(1),
    possibleEffortLevels: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine((levels) => new Set(levels).size === levels.length, {
        message: "Effort levels must be unique",
      }),
  })
  .refine(
    ({ defaultEffortLevel, possibleEffortLevels }) =>
      possibleEffortLevels.includes(defaultEffortLevel),
    { message: "Default effort level must be included in possible levels" },
  );

export type EffortSettings = z.infer<typeof EffortSettingsSchema>;

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
  effortSettings: EffortSettingsSchema.optional(),
  type: z.enum(["custom", "local", "cloud"]).optional(),
});

export type LanguageModel = z.infer<typeof LanguageModelSchema>;

export const LocalModelSchema = z.object({
  provider: z.enum(["ollama", "lmstudio"]),
  modelName: z.string(),
  displayName: z.string(),
});

export type LocalModel = z.infer<typeof LocalModelSchema>;

// Ollama model references are `name[:tag]`, optionally prefixed by the
// community author (`mannix/phi3-mini-4k:latest`). Restricting the alphabet
// keeps user input out of anything shell- or URL-meaningful.
export const OllamaModelNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.\-/:]+$/, "Invalid Ollama model name");

export const OllamaRegistrySearchTermSchema = z
  .string()
  .trim()
  .min(1, "Enter a search term")
  .max(100);

export const OllamaRegistryModelSchema = z.object({
  name: z.string(),
  updated: z.string().nullable(),
  context: z.string().nullable(),
  size: z.string().nullable(),
});

export type OllamaRegistryModel = z.infer<typeof OllamaRegistryModelSchema>;

export const OllamaPullProgressSchema = z.object({
  pullId: z.string(),
  status: z.string(),
  completed: z.number().optional(),
  total: z.number().optional(),
});

export type OllamaPullProgress = z.infer<typeof OllamaPullProgressSchema>;

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

export const UpdateCustomLanguageModelParamsSchema =
  CreateCustomLanguageModelParamsSchema.extend({ id: z.number() });

export type UpdateCustomLanguageModelParams = z.infer<
  typeof UpdateCustomLanguageModelParamsSchema
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
    output: z.number(),
  }),

  updateCustomModel: defineContract({
    channel: "update-custom-language-model",
    input: UpdateCustomLanguageModelParamsSchema,
    output: z.number(),
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

  searchOllamaRegistry: defineContract({
    channel: "local-models:search-ollama-registry",
    input: z.object({ term: OllamaRegistrySearchTermSchema }),
    output: z.object({ models: z.array(OllamaRegistryModelSchema) }),
  }),

  pullOllamaModel: defineContract({
    channel: "local-models:pull-ollama-model",
    input: z.object({
      pullId: z.string().min(1),
      model: OllamaModelNameSchema,
    }),
    output: z.void(),
  }),

  cancelOllamaPull: defineContract({
    channel: "local-models:cancel-ollama-pull",
    input: z.object({ pullId: z.string().min(1) }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Language Model Events (Main -> Renderer)
// =============================================================================

export const languageModelEvents = {
  ollamaPullProgress: defineEvent({
    channel: "local-models:ollama-pull-progress",
    payload: OllamaPullProgressSchema,
  }),
} as const;

// =============================================================================
// Language Model Client
// =============================================================================

export const languageModelClient = createClient(languageModelContracts);

export const languageModelEventClient = createEventClient(languageModelEvents);
