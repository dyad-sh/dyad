import type {
  LanguageModelProvider,
  LanguageModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "@/ipc/ipc_types";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "../shared/language_model_helpers";
import { db } from "@/db";
import {
  language_model_providers as languageModelProvidersSchema,
  language_models as languageModelsSchema,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";

const logger = log.scope("language_model_handlers");
const handle = createLoggedHandler(logger);

export function registerLanguageModelHandlers() {
  handle(
    "get-language-model-providers",
    async (): Promise<LanguageModelProvider[]> => {
      return getLanguageModelProviders();
    },
  );

  handle(
    "create-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      // Validation
      if (!id) {
        throw new Error("Provider ID is required");
      }

      if (!name) {
        throw new Error("Provider name is required");
      }

      if (!apiBaseUrl) {
        throw new Error("API base URL is required");
      }

      // Check if a provider with this ID already exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, id))
        .get();

      if (existingProvider) {
        throw new Error(`A provider with ID "${id}" already exists`);
      }

      // Insert the new provider
      await db.insert(languageModelProvidersSchema).values({
        id,
        name,
        api_base_url: apiBaseUrl,
        env_var_name: envVarName || null,
      });

      // Return the newly created provider
      return {
        id,
        name,
        apiBaseUrl,
        envVarName,
        type: "custom",
      };
    },
  );

  handle(
    "create-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelParams,
    ): Promise<void> => {
      const {
        id,
        name,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
      } = params;

      // Validation
      if (!id) {
        throw new Error("Model ID is required");
      }
      if (!name) {
        throw new Error("Model name is required");
      }
      if (!providerId) {
        throw new Error("Provider ID is required");
      }

      // Check if provider exists
      const provider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, providerId))
        .get();

      if (!provider) {
        throw new Error(`Provider with ID "${providerId}" not found`);
      }

      // Check if model ID already exists
      const existingModel = db
        .select()
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.id, id))
        .get();

      if (existingModel) {
        throw new Error(`A model with ID "${id}" already exists`);
      }

      // Insert the new model
      await db.insert(languageModelsSchema).values({
        id,
        name,
        provider_id: providerId,
        description: description || null,
        max_output_tokens: maxOutputTokens || null,
        context_window: contextWindow || null,
      });
    },
  );

  handle(
    "get-language-models",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<LanguageModel[]> => {
      if (!params || typeof params.providerId !== "string") {
        throw new Error("Invalid parameters: providerId (string) is required.");
      }
      return getLanguageModels({ providerId: params.providerId });
    },
  );
}
