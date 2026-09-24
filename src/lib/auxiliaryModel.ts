import type { LargeLanguageModel, UserSettings } from "./schemas";

/** BYO helpers use the chat's chosen provider, not an implicit second API key. */
export function getAuxiliaryModel(
  settings: UserSettings,
  defaultModel: LargeLanguageModel,
): LargeLanguageModel {
  const { connection: _connection, ...model } =
    settings.proModelUsage === "api-key"
      ? settings.selectedModel
      : defaultModel;
  return model;
}
