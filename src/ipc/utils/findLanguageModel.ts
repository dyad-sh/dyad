import { LargeLanguageModel } from "@/lib/schemas";
import { LanguageModel } from "@/ipc/types";
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

  if (model.variantId) {
    const variantModel = models.find(
      (m) => m.apiName === model.name && m.variantId === model.variantId,
    );
    if (variantModel) {
      return variantModel;
    }
  }

  return models.find(
    (m) =>
      m.apiName === model.name &&
      (m.variantId === model.variantId ||
        (!model.variantId && (m.variantId === "default" || !m.variantId))),
  );
}
