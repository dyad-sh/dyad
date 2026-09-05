import type { LargeLanguageModel } from "@/lib/schemas";

export const MAX_RECENT_MODELS = 5;

export function isSameModel(
  left: LargeLanguageModel,
  right: LargeLanguageModel,
): boolean {
  return (
    left.provider === right.provider &&
    left.name === right.name &&
    left.connection === right.connection &&
    left.customModelId === right.customModelId
  );
}

export function getEffectiveRecentModels(
  recentModels: LargeLanguageModel[] | undefined,
  selectedModel: LargeLanguageModel,
): LargeLanguageModel[] {
  const candidates =
    recentModels ?? (selectedModel.provider === "auto" ? [] : [selectedModel]);

  return candidates
    .filter((model) => model.provider !== "auto")
    .filter(
      (model, index, models) =>
        models.findIndex((candidate) => isSameModel(candidate, model)) ===
        index,
    )
    .slice(0, MAX_RECENT_MODELS);
}

export function addRecentModel(
  recentModels: LargeLanguageModel[],
  model: LargeLanguageModel,
): LargeLanguageModel[] {
  if (model.provider === "auto") {
    return recentModels;
  }

  return [
    model,
    ...recentModels.filter((recent) => !isSameModel(recent, model)),
  ].slice(0, MAX_RECENT_MODELS);
}

export function replaceRecentModelIdentity(
  recentModels: LargeLanguageModel[] | undefined,
  previous: LargeLanguageModel,
  replacement: LargeLanguageModel,
  options?: { includeLegacyIdless?: boolean },
): LargeLanguageModel[] | undefined {
  return recentModels?.map((model) =>
    model.provider === previous.provider &&
    model.name === previous.name &&
    (model.customModelId === previous.customModelId ||
      (options?.includeLegacyIdless && model.customModelId === undefined))
      ? replacement
      : model,
  );
}
