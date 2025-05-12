import type { LanguageModelProvider } from "@/ipc/ipc_types";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getLanguageModelProviders } from "../shared/language_model_helpers";
import { db } from "@/db";
import { language_model_providers as languageModelProvidersSchema } from "@/db/schema";
import { eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";

const logger = log.scope("language_model_handlers");
const handle = createLoggedHandler(logger);

export interface CreateCustomLanguageModelProviderParams {
  id: string;
  name: string;
  apiBaseUrl: string;
  envVarName?: string;
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
        throw new Error("Provider ID is required");
      }

      if (!name) {
        throw new Error("Provider name is required");
      }

      if (!apiBaseUrl) {
        throw new Error("API base URL is required");
      }

      // Check if a provider with this ID already exists
      const existingProvider = await db
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
}
