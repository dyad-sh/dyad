import { LargeLanguageModel } from "@/lib/schemas";
import { LanguageModel } from "../ipc_types";
import { getLanguageModels } from "../shared/language_model_helpers";

export async function findLanguageModel(
  model: LargeLanguageModel,
): Promise<LanguageModel | undefined> {
  const models = await getLanguageModels({
    providerId: model.provider,
  });

  if (model.customModelId) {
    const customModel = models.find(
      (m) => m.type === "custom" && m.id === model.customModelId,
    );
    if (customModel) {
      return customModel;
    }
  }

  return models.find((m) => m.apiName === model.name);
}
