import type { EffortSettings, LanguageModel } from "@/ipc/types/language-model";
import type { LargeLanguageModel, ModelSelection } from "@/lib/schemas";
import { getAutoSidekickRuntimeModel } from "@/lib/autoSidekick";

export const FALLBACK_EFFORT_SETTINGS = {
  defaultEffortLevel: "medium",
  possibleEffortLevels: ["low", "medium", "high"],
} as const;

export const LOCAL_PROVIDER_EFFORT_SETTINGS = {
  defaultEffortLevel: "medium",
  possibleEffortLevels: ["none", "low", "medium", "high"],
} as const;

/**
 * Parses the "Effort levels" form field (e.g. "xhigh, medium, low") into
 * effort settings. The first level is the default. Empty input means "use
 * Dyad's defaults", so it returns undefined. Levels are de-duplicated
 * case-insensitively (the first spelling wins).
 *
 * Pass `previous` when editing: if the text is unchanged from how `previous`
 * is displayed, `previous` is returned as-is so saving doesn't reorder it or
 * move its default.
 */
export function parseEffortLevelsInput(
  text: string,
  previous?: EffortSettings,
): EffortSettings | undefined {
  if (previous && text.trim() === formatEffortLevelsInput(previous)) {
    return previous;
  }
  const seen = new Set<string>();
  const levels = text
    .split(",")
    .map((level) => level.trim())
    .filter((level) => {
      const key = level.toLowerCase();
      if (!level || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return levels.length > 0
    ? { defaultEffortLevel: levels[0], possibleEffortLevels: levels }
    : undefined;
}

/** Inverse of parseEffortLevelsInput: default level first. */
export function formatEffortLevelsInput(settings?: EffortSettings): string {
  if (!settings) return "";
  const { defaultEffortLevel, possibleEffortLevels } = settings;
  return [
    defaultEffortLevel,
    ...possibleEffortLevels.filter((level) => level !== defaultEffortLevel),
  ].join(", ");
}

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
  if (
    providerId === "ollama" ||
    providerId === "lmstudio" ||
    providerId?.startsWith("custom::")
  ) {
    return model?.effortSettings ?? LOCAL_PROVIDER_EFFORT_SETTINGS;
  }
  return model?.effortSettings ?? FALLBACK_EFFORT_SETTINGS;
}

export function resolveEffortLevel({
  catalogModel,
  preferredEffortLevel,
  providerId,
}: {
  providerId?: string;
  catalogModel?: LanguageModel | null;
  preferredEffortLevel?: string | null;
}): string {
  // A persisted chat selection is authoritative even if a remote-only model is
  // temporarily absent from the current catalog. Only apply the generic
  // fallback schema when the model exists and explicitly has no metadata.
  if (!catalogModel) {
    return preferredEffortLevel ?? FALLBACK_EFFORT_SETTINGS.defaultEffortLevel;
  }
  const settings = getEffortSettings(catalogModel, providerId);
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
    effortLevel: resolveEffortLevel({
      catalogModel,
      preferredEffortLevel,
      providerId: model.provider,
    }),
  };
}

export function formatEffortLevel(effortLevel: string): string {
  return effortLevel
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCompactEffortLevel(effortLevel: string): string {
  const normalizedEffortLevel = effortLevel
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  const compactLabels: Record<string, string> = {
    none: "None",
    minimal: "Min",
    low: "Low",
    medium: "Med",
    high: "High",
    xhigh: "X-High",
    "x-high": "X-High",
    "extra-high": "X-High",
    max: "Max",
    maximum: "Max",
  };

  return compactLabels[normalizedEffortLevel] ?? formatEffortLevel(effortLevel);
}
