import log from "electron-log";
import { getLMStudioBaseUrlFromSettings } from "@/lib/local_provider_utils";
import {
  clearLMStudioDiscoveryCache,
  discoverLMStudioModelsCached,
} from "@/lib/lm_studio_models";
import { readSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { languageModelContracts } from "../types/language-model";
import type { LocalModel } from "../types/language-model";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";

const logger = log.scope("lmstudio_handler");

export async function fetchLMStudioModels(
  settings?: UserSettings | null,
): Promise<{ models: LocalModel[] }> {
  const baseUrl = getLMStudioBaseUrlFromSettings(settings);

  clearLMStudioDiscoveryCache(baseUrl);

  let discovery: Awaited<ReturnType<typeof discoverLMStudioModelsCached>>;
  try {
    discovery = await discoverLMStudioModelsCached(baseUrl);
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as Error).message.includes("fetch failed")
    ) {
      throw new DyadError(
        `Could not connect to LM Studio at ${baseUrl}. Make sure LM Studio is running with the local server enabled.`,
        DyadErrorKind.External,
      );
    }
    throw error;
  }

  if (!discovery.reachable) {
    throw new DyadError(
      `Could not connect to LM Studio at ${baseUrl}. Make sure LM Studio is running with the local server enabled.`,
      DyadErrorKind.External,
    );
  }

  if (discovery.models.length === 0) {
    throw new DyadError(
      "Connected to LM Studio but no chat models are loaded. In LM Studio, load a model (it should show READY), then test again.",
      DyadErrorKind.External,
    );
  }

  logger.info(
    `Fetched ${discovery.models.length} LM Studio model(s) from ${discovery.source ?? "unknown"} at ${baseUrl}`,
  );
  return { models: discovery.models };
}

export function registerLMStudioHandlers() {
  createTypedHandler(languageModelContracts.listLMStudioModels, async () => {
    return fetchLMStudioModels(readSettings());
  });
}
