import type {
  LanguageModelProvider,
  LanguageModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "@/ipc/types";
import { languageModelContracts } from "@/ipc/types";
import { createLoggedHandler } from "./safe_handle";
import { createLoggedTypedHandler } from "./base";
import log from "electron-log";
import {
  CUSTOM_PROVIDER_PREFIX,
  getLanguageModelProviders,
  getLanguageModels,
  getLanguageModelsByProviders,
} from "../shared/language_model_helpers";
import { db } from "@/db";
import {
  language_models,
  language_model_providers as languageModelProvidersSchema,
  language_models as languageModelsSchema,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "../../main/settings";
import { getEnvVar } from "../utils/read_env";
import { getProviderApiKeyForRequest } from "../utils/get_model_client";
import {
  fetchOpenAICompatibleModels,
  selectModelsToImport,
} from "./fetch_openai_compatible_models";

const logger = log.scope("language_model_handlers");
const handle = createLoggedHandler(logger);
const handleTyped = createLoggedTypedHandler(logger);

/**
 * Looks the provider up in the database only. Going through
 * getLanguageModelProviders() would also load the remote built-in model
 * catalog, which can stall custom-endpoint discovery when the cloud is
 * unreachable.
 */
function getCustomProvider(providerId: string) {
  const provider = db
    .select()
    .from(languageModelProvidersSchema)
    .where(eq(languageModelProvidersSchema.id, providerId))
    .get();
  if (!provider) {
    throw new DyadError(
      `Custom provider "${providerId}" not found`,
      DyadErrorKind.NotFound,
    );
  }
  return {
    name: provider.name,
    apiBaseUrl: provider.api_base_url,
    envVarName: provider.env_var_name ?? undefined,
  };
}

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
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }

      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if a provider with this ID already exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, id))
        .get();

      if (existingProvider) {
        throw new DyadError(
          `A provider with ID "${id}" already exists`,
          DyadErrorKind.Conflict,
        );
      }

      // Insert the new provider
      await db.insert(languageModelProvidersSchema).values({
        // Make sure we will never have accidental collisions with builtin providers
        id: CUSTOM_PROVIDER_PREFIX + id,
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
    ): Promise<number> => {
      const {
        apiName,
        displayName,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
      } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!displayName) {
        throw new DyadError(
          "Model display name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if provider exists
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Insert the new model
      const result = db
        .insert(languageModelsSchema)
        .values({
          displayName,
          apiName,
          builtinProviderId: provider.type === "cloud" ? providerId : undefined,
          customProviderId: provider.type === "custom" ? providerId : undefined,
          description: description || null,
          max_output_tokens: maxOutputTokens || null,
          context_window: contextWindow || null,
        })
        .run();
      return Number(result.lastInsertRowid);
    },
  );

  handleTyped(
    languageModelContracts.fetchCustomProviderModels,
    async (_event, { providerId }) => {
      const provider = getCustomProvider(providerId);

      // Same lookup as chat requests in get_model_client. Read the persisted
      // settings only: readEffectiveSettings() also fetches remote desktop
      // config, which would stall local/LAN discovery when api.dyad.sh is
      // unreachable.
      const apiKey = getProviderApiKeyForRequest(
        readSettings().providerSettings?.[providerId]?.apiKey?.value ||
          (provider.envVarName ? getEnvVar(provider.envVarName) : undefined),
        provider.name,
      );

      return fetchOpenAICompatibleModels(provider.apiBaseUrl, apiKey);
    },
  );

  handleTyped(
    languageModelContracts.importCustomProviderModels,
    async (_event, { providerId, models }) => {
      getCustomProvider(providerId);

      // Everything below is synchronous, so no other IPC handler (i.e. another
      // window's import) can run between the duplicate check and the inserts.
      const toInsert = selectModelsToImport(
        models,
        db
          .select({ apiName: languageModelsSchema.apiName })
          .from(languageModelsSchema)
          .where(eq(languageModelsSchema.customProviderId, providerId))
          .all()
          .map((row) => row.apiName),
      );
      db.transaction((tx) => {
        for (const model of toInsert) {
          tx.insert(languageModelsSchema)
            .values({
              displayName: model.displayName,
              apiName: model.apiName,
              customProviderId: providerId,
              context_window: model.contextWindow || null,
            })
            .run();
        }
      });
      return {
        added: toInsert.length,
        skipped: models.length - toInsert.length,
      };
    },
  );

  handleTyped(
    languageModelContracts.updateCustomModel,
    async (_event, params): Promise<number> => {
      const {
        id,
        apiName,
        displayName,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
      } = params;

      if (!apiName) {
        throw new DyadError(
          "Model API name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!displayName) {
        throw new DyadError(
          "Model display name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      const providers = await getLanguageModelProviders();
      const provider = providers.find(
        (candidate) => candidate.id === providerId,
      );
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be updated",
          DyadErrorKind.Validation,
        );
      }

      const result = db
        .update(languageModelsSchema)
        .set({
          displayName,
          apiName,
          description: description || null,
          max_output_tokens: maxOutputTokens || null,
          context_window: contextWindow || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(languageModelsSchema.id, id),
            provider.type === "cloud"
              ? eq(languageModelsSchema.builtinProviderId, providerId)
              : eq(languageModelsSchema.customProviderId, providerId),
          ),
        )
        .run();

      if (result.changes === 0) {
        throw new DyadError(
          `Custom model with ID "${id}" was not found for provider "${providerId}"`,
          DyadErrorKind.NotFound,
        );
      }

      return id;
    },
  );

  handle(
    "edit-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      if (!id) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }
      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if the provider being edited exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id))
        .get();

      if (!existingProvider) {
        throw new DyadError(
          `Provider with ID "${id}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Use transaction to ensure atomicity when updating provider and potentially its models
      const result = db.transaction((tx) => {
        // Update the provider
        const updateResult = tx
          .update(languageModelProvidersSchema)
          .set({
            id: CUSTOM_PROVIDER_PREFIX + id,
            name,
            api_base_url: apiBaseUrl,
            env_var_name: envVarName || null,
          })
          .where(
            eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id),
          )
          .run();

        if (updateResult.changes === 0) {
          throw new DyadError(
            `Failed to update provider with ID "${id}"`,
            DyadErrorKind.External,
          );
        }

        return {
          id,
          name,
          apiBaseUrl,
          envVarName,
          type: "custom" as const,
        };
      });
      logger.info(`Successfully updated provider`);
      return result;
    },
  );

  handle(
    "delete-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: { modelId: string },
    ): Promise<void> => {
      const { modelId: apiName } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name (modelId) is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model for apiName: ${apiName}`,
      );

      const existingModel = await db
        .select()
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName))
        .get();

      if (!existingModel) {
        throw new Error(
          `A model with API name (modelId) "${apiName}" was not found`,
        );
      }

      await db
        .delete(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName));
    },
  );

  handle(
    "delete-custom-model",
    async (
      _event: IpcMainInvokeEvent,
      params: { providerId: string; modelApiName: string },
    ): Promise<void> => {
      const { providerId, modelApiName } = params;
      logger.info(
        `Handling delete-custom-model for ${providerId} / ${modelApiName}`,
      );
      if (!providerId || !modelApiName) {
        throw new DyadError(
          "Provider ID and Model API Name are required.",
          DyadErrorKind.External,
        );
      }
      logger.info(
        `Attempting to delete custom model ${modelApiName} for provider ${providerId}`,
      );

      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be deleted",
          DyadErrorKind.External,
        );
      }
      const result = db
        .delete(language_models)
        .where(
          and(
            provider.type === "cloud"
              ? eq(language_models.builtinProviderId, providerId)
              : eq(language_models.customProviderId, providerId),

            eq(language_models.apiName, modelApiName),
          ),
        )
        .run();

      if (result.changes === 0) {
        logger.warn(
          `No custom model found matching providerId=${providerId} and apiName=${modelApiName} for deletion.`,
        );
      } else {
        logger.info(
          `Successfully deleted ${result.changes} custom model(s) with apiName=${modelApiName} for provider=${providerId}`,
        );
      }
    },
  );

  handle(
    "delete-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<void> => {
      const { providerId } = params;

      // Validation
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model-provider for providerId: ${providerId}`,
      );

      // Check if the provider exists before attempting deletion
      const existingProvider = await db
        .select({ id: languageModelProvidersSchema.id })
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, providerId))
        .get();

      if (!existingProvider) {
        // If the provider doesn't exist, maybe it was already deleted. Log and return.
        logger.warn(
          `Provider with ID "${providerId}" not found. It might have been deleted already.`,
        );
        // Optionally, throw new Error(`Provider with ID "${providerId}" not found`);
        // Deciding to return gracefully instead of throwing an error if not found.
        return;
      }

      // Use a transaction to ensure atomicity
      db.transaction((tx) => {
        // 1. Delete associated models
        const deleteModelsResult = tx
          .delete(languageModelsSchema)
          .where(eq(languageModelsSchema.customProviderId, providerId))
          .run();
        logger.info(
          `Deleted ${deleteModelsResult.changes} model(s) associated with provider ${providerId}`,
        );

        // 2. Delete the provider
        const deleteProviderResult = tx
          .delete(languageModelProvidersSchema)
          .where(eq(languageModelProvidersSchema.id, providerId))
          .run();

        if (deleteProviderResult.changes === 0) {
          // This case should ideally not happen if existingProvider check passed,
          // but adding safety check within transaction.
          logger.error(
            `Failed to delete provider with ID "${providerId}" during transaction, although it was found initially. Rolling back.`,
          );
          throw new Error(
            `Failed to delete provider with ID "${providerId}" which should have existed.`,
          );
        }
        logger.info(`Successfully deleted provider with ID "${providerId}".`);
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
        throw new DyadError(
          "Invalid parameters: providerId (string) is required.",
          DyadErrorKind.Validation,
        );
      }
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === params.providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${params.providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be fetched",
          DyadErrorKind.External,
        );
      }
      return getLanguageModels({ providerId: params.providerId });
    },
  );

  handle(
    "get-language-models-by-providers",
    async (): Promise<Record<string, LanguageModel[]>> => {
      return getLanguageModelsByProviders();
    },
  );
}
