import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";

import { useSettings } from "@/hooks/useSettings";
import {
  DEFAULT_PHANTOM_MODEL,
  dispatchAiSettingsChanged,
  getAiCoderProvider,
} from "@/lib/ai_coder";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { Switch } from "@/components/ui/switch";
import { ProviderModelTabs } from "@/components/settings/ProviderModelTabs";

const settingsCardClass =
  "bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 scroll-mt-24";

const PROVIDER_LABEL: Record<string, string> = {
  phantom: "Phantom (Hermes)",
  openrouter: "OpenRouter",
  lmstudio: "LM Studio",
  openai: "OpenAI",
};

export function AiCoderSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  if (!settings) return null;

  const provider = getAiCoderProvider(settings);
  const model = settings.aiCoder?.model?.trim();
  const value: LargeLanguageModel = {
    provider,
    name: model || (provider === "phantom" ? DEFAULT_PHANTOM_MODEL : ""),
  };
  const activeLabel = `${PROVIDER_LABEL[provider] ?? provider} · ${
    value.name || "—"
  }`;

  const persist = async (patch: NonNullable<UserSettings["aiCoder"]>) => {
    await updateSettings({ aiCoder: { ...settings.aiCoder, ...patch } });
    dispatchAiSettingsChanged();
  };

  const onSelect = (selected: LargeLanguageModel) => {
    void persist({
      provider: selected.provider as NonNullable<
        UserSettings["aiCoder"]
      >["provider"],
      model: selected.name,
    });
  };

  return (
    <div
      id={SECTION_IDS.aiCoder}
      className={settingsCardClass}
      data-testid="ai-coder-settings"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
          <Sparkles className="size-4" />
        </div>
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            {t("aiCoder.sectionTitle")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose the AI model. Pick a service tab, select a model, and press
            “Use this model”.
          </p>
        </div>
      </div>

      <div id={SETTING_IDS.aiCoderProvider}>
        <ProviderModelTabs
          value={value}
          activeLabel={activeLabel}
          onSelect={onSelect}
        />
      </div>

      <div className="mt-5 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("aiCoder.enableChatAgent")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aiCoder.enableChatAgentDescription")}
            </p>
          </div>
          <Switch
            checked={settings.aiCoder?.enableForChatAgent ?? false}
            onCheckedChange={(checked) =>
              void persist({ enableForChatAgent: checked })
            }
            data-testid="ai-coder-enable-chat-agent"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("aiCoder.enableCodeCompletion")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aiCoder.enableCodeCompletionDescription")}
            </p>
          </div>
          <Switch
            checked={settings.aiCoder?.enableForCodeCompletion ?? false}
            onCheckedChange={(checked) =>
              void persist({ enableForCodeCompletion: checked })
            }
            data-testid="ai-coder-enable-code-completion"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {t("aiCoder.streamResponses")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aiCoder.streamResponsesDescription")}
            </p>
          </div>
          <Switch
            checked={settings.aiCoder?.streamResponses !== false}
            onCheckedChange={(checked) =>
              void persist({ streamResponses: checked })
            }
            data-testid="ai-coder-stream-responses"
          />
        </div>
      </div>
    </div>
  );
}
