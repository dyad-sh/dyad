import type {
  LargeLanguageModel,
  ModelSelection,
  UserSettings,
} from "@/lib/schemas";
import { createModelSelection, getModelPreferenceKey } from "@/lib/modelEffort";
import { findLanguageModel } from "./findLanguageModel";
import { modelForChatBackend } from "@/shared/execution_backend";

export async function resolveModelSelection({
  model,
  preferredEffortLevel,
}: {
  model: LargeLanguageModel;
  preferredEffortLevel?: string | null;
}): Promise<ModelSelection> {
  if (model.provider === "claude-code")
    return { ...model, effortLevel: preferredEffortLevel ?? "medium" };
  const catalogModel = await findLanguageModel(model);
  return createModelSelection({
    model,
    catalogModel,
    preferredEffortLevel,
  });
}

export async function resolveDefaultModelSelection(
  settings: UserSettings,
): Promise<ModelSelection> {
  const selectedModel = modelForChatBackend(undefined, settings);
  return resolveModelSelection({
    model: selectedModel,
    preferredEffortLevel:
      settings.modelEffortPreferences?.[getModelPreferenceKey(selectedModel)],
  });
}

export async function normalizeModelSelection(
  selection: ModelSelection,
): Promise<ModelSelection> {
  return resolveModelSelection({
    model: selection,
    preferredEffortLevel: selection.effortLevel,
  });
}
