import { useTranslation } from "react-i18next";

import { useSettings } from "@/hooks/useSettings";
import { getChatAgentModel } from "@/lib/chat_agent_model";
import { isAiCoderEnabledForChatAgent } from "@/lib/ai_coder";
import type { LargeLanguageModel } from "@/lib/schemas";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { useModelDisplayName } from "@/hooks/useModelDisplayName";
import { ProviderModelTabs } from "@/components/settings/ProviderModelTabs";

const settingsCardClass =
  "bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 scroll-mt-24";

export function ChatAgentModelSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  const configured = settings?.chatAgentModel;
  const displayModel = useModelDisplayName(
    settings ? getChatAgentModel(settings) : null,
  );
  const aiCoderOverride = settings
    ? isAiCoderEnabledForChatAgent(settings)
    : false;

  const onSelect = (model: LargeLanguageModel) => {
    void updateSettings({ chatAgentModel: model });
  };

  if (!settings) return null;

  return (
    <div
      id={SECTION_IDS.chatAgent}
      className={settingsCardClass}
      data-testid="chat-agent-model-settings"
    >
      <h2 className="mb-1 text-lg font-medium text-gray-900 dark:text-white">
        {t("chatAgent.sectionTitle")}
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Pick the model the Chat Agent talks to. Choose a service tab, select a
        model, and press “Use this model”.
      </p>

      <div id={SETTING_IDS.chatAgentModel}>
        <ProviderModelTabs
          value={configured}
          activeLabel={displayModel ?? undefined}
          onSelect={onSelect}
        />
      </div>

      {aiCoderOverride && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          AI Coder is overriding the Chat Agent model — that selection takes
          precedence over the one above. Turn it off in AI Coder settings to use
          this picker.
        </p>
      )}
    </div>
  );
}
