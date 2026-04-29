import { AUTO_MODEL_ALIASES } from "@/ipc/shared/language_model_constants";
import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";
import { resolveBuiltinModelAlias } from "@/ipc/shared/remote_language_model_catalog";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";

import { getEnvVar } from "./read_env";

export async function resolveAutoModelForSettings(
  settings: UserSettings,
): Promise<LargeLanguageModel | null> {
  const allProviders = await getLanguageModelProviders();

  for (const autoModelAlias of AUTO_MODEL_ALIASES) {
    const resolvedModel = await resolveBuiltinModelAlias(autoModelAlias);
    if (!resolvedModel) {
      continue;
    }

    const providerInfo = allProviders.find(
      (provider) => provider.id === resolvedModel.providerId,
    );
    const envVarName = providerInfo?.envVarName;

    const apiKey =
      settings.providerSettings?.[resolvedModel.providerId]?.apiKey?.value ||
      (envVarName ? getEnvVar(envVarName) : undefined);

    if (apiKey) {
      return {
        provider: resolvedModel.providerId,
        name: resolvedModel.apiName,
      };
    }
  }

  return null;
}
