import type { ChatMode, LargeLanguageModel } from "./schemas";

export const FREE_PRO_MODEL_PROVIDER = "auto";
export const FREE_PRO_MODEL_NAME = "free-pro";
export const FREE_PRO_MODEL_FALLBACK_CHAT_MODE: ChatMode = "local-agent";
export const FREE_PRO_BUILD_MODE_ERROR =
  "Dyad Free is not available in Build mode. Switch to Agent, Ask, or Plan mode, or choose a paid model.";

export function isFreeProModel(
  model: Pick<LargeLanguageModel, "provider" | "name"> | null | undefined,
) {
  return (
    model?.provider === FREE_PRO_MODEL_PROVIDER &&
    model?.name === FREE_PRO_MODEL_NAME
  );
}

export function isFreeProLanguageModel(providerId: string, apiName: string) {
  return (
    providerId === FREE_PRO_MODEL_PROVIDER && apiName === FREE_PRO_MODEL_NAME
  );
}

export function isFreeProBuildModeCombination(
  model: Pick<LargeLanguageModel, "provider" | "name"> | null | undefined,
  chatMode: ChatMode | null | undefined,
) {
  return isFreeProModel(model) && chatMode === "build";
}
