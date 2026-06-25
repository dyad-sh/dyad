import type { LargeLanguageModel } from "./schemas";

export const FREE_PRO_MODEL_PROVIDER = "auto";
export const FREE_PRO_MODEL_NAME = "free-pro";

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
