import type { LanguageModel } from "@/ipc/types/language-model";
import type { LargeLanguageModel, ModelSelection } from "@/lib/schemas";

export const FALLBACK_EFFORT_SETTINGS = {
  defaultEffortLevel: "medium",
  possibleEffortLevels: ["low", "medium", "high"],
} as const;

export function getModelPreferenceKey(model: LargeLanguageModel): string {
  return JSON.stringify([
    model.provider,
    model.name,
    model.customModelId ?? null,
  ]);
}

export function getEffortSettings(model?: LanguageModel | null): {
  defaultEffortLevel: string;
  possibleEffortLevels: readonly string[];
} {
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
