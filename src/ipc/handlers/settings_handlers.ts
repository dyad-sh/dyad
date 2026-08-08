import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { writeSettings, readEffectiveSettings } from "../../main/settings";
import {
  testOpenAiCoderConnection,
  testPhantomHermesConnection,
} from "../utils/test_ai_coder_connection";
import { testResearchPlugin } from "../utils/research_plugins";
import { syncSecretsToVault } from "../utils/vault_secrets_sync";

export function registerSettingsHandlers() {
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return readEffectiveSettings();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    writeSettings(settings);
    const effective = await readEffectiveSettings();
    // Keep the vault's copy of the keys current. Never blocks the save.
    void syncSecretsToVault(effective);
    return effective;
  });

  createTypedHandler(
    settingsContracts.testAiCoderConnection,
    async (_, { provider, apiKey, endpoint, model, openaiModel }) => {
      const message =
        provider === "phantom"
          ? await testPhantomHermesConnection(
              apiKey ?? "",
              model ?? "",
              endpoint,
            )
          : await testOpenAiCoderConnection(apiKey, openaiModel ?? model ?? "");
      return { ok: true as const, message };
    },
  );

  createTypedHandler(
    settingsContracts.testResearchPlugin,
    async (_, { plugin, settings }) => {
      const current = await readEffectiveSettings();
      const message = await testResearchPlugin(plugin, {
        ...current,
        researchPlugins: settings.researchPlugins,
      });
      return { ok: true as const, message };
    },
  );
}
