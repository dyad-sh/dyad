import { useMemo } from "react";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import type { LargeLanguageModel } from "@/lib/schemas";

export function useModelDisplayName(
  model: LargeLanguageModel | undefined | null,
): string | null {
  const { data: modelsByProviders } = useLanguageModelsByProviders();
  const { models: ollamaModels } = useLocalModels();
  const { models: lmStudioModels } = useLocalLMSModels();

  return useMemo(() => {
    if (!model) return null;

    if (model.provider === "ollama") {
      const found = ollamaModels.find((m) => m.modelName === model.name);
      return found?.displayName ?? model.name;
    }
    if (model.provider === "lmstudio") {
      const found = lmStudioModels.find((m) => m.modelName === model.name);
      return found?.displayName ?? model.name;
    }

    const providerModels = modelsByProviders?.[model.provider];
    if (providerModels) {
      const custom = providerModels.find(
        (m) => m.type === "custom" && m.id === model.customModelId,
      );
      if (custom) return custom.displayName;
      const builtin = providerModels.find((m) => m.apiName === model.name);
      if (builtin) return builtin.displayName;
    }

    return model.name;
  }, [model, modelsByProviders, ollamaModels, lmStudioModels]);
}
