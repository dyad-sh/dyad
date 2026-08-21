import type { LanguageModel } from "@/ipc/types/language-model";
import type { LargeLanguageModel, ModelSelection } from "@/lib/schemas";
import { getAutoSidekickRuntimeModel } from "@/lib/autoSidekick";

export const FALLBACK_EFFORT_SETTINGS = {
  defaultEffortLevel: "medium",
  possibleEffortLevels: ["low", "medium", "high"],
} as const;

export const OLLAMA_EFFORT_SETTINGS = {
  defaultEffortLevel: "medium",
  possibleEffortLevels: ["none", "low", "medium", "high"],
} as const;

export function getModelPreferenceKey(model: LargeLanguageModel): string {
  const preferenceModel = getAutoSidekickRuntimeModel(model);
  return JSON.stringify([
    preferenceModel.provider,
    preferenceModel.name,
    preferenceModel.customModelId ?? null,
  ]);
}

export function getEffortSettings(
  model?: LanguageModel | null,
  providerId?: string,
): {
  defaultEffortLevel: string;
  possibleEffortLevels: readonly string[];
} {
  if (providerId === "ollama") {
    return OLLAMA_EFFORT_SETTINGS;
  }
  return model?.effortSettings ?? FALLBACK_EFFORT_SETTINGS;
}

export function resolveEffortLevel({
  catalogModel,
  preferredEffortLevel,
}: {
  catalogModel?: LanguageModel | null;
  preferredEffortLevel?: string | null;
}): string {
  // A persisted chat selection is authoritative even if a remote-only model is
  // temporarily absent from the current catalog. Only apply the generic
  // fallback schema when the model exists and explicitly has no metadata.
  if (!catalogModel) {
    return preferredEffortLevel ?? FALLBACK_EFFORT_SETTINGS.defaultEffortLevel;
  }
  const settings = getEffortSettings(catalogModel);
  return preferredEffortLevel &&
    settings.possibleEffortLevels.includes(preferredEffortLevel)
    ? preferredEffortLevel
    : settings.defaultEffortLevel;
}

export function createModelSelection({
  model,
  catalogModel,
  preferredEffortLevel,
}: {
  model: LargeLanguageModel;
  catalogModel?: LanguageModel | null;
  preferredEffortLevel?: string | null;
}): ModelSelection {
  return {
    ...model,
    effortLevel: resolveEffortLevel({ catalogModel, preferredEffortLevel }),
  };
}

export function formatEffortLevel(effortLevel: string): string {
  return effortLevel
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
