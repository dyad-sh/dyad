import { useSettings } from "@/hooks/useSettings";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled, getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
  isFreeProModel,
} from "@/lib/freeProModel";

export function DefaultChatModeSelector() {
  const { settings, updateSettings, envVars } = useSettings();
  const { quotaStatus } = useFreeAgentQuota();
  const { t } = useTranslation("settings");

  useEffect(() => {
    if (
      settings &&
      isFreeProBuildModeCombination(
        settings.selectedModel,
        settings.defaultChatMode,
      )
    ) {
      updateSettings({ defaultChatMode: FREE_PRO_MODEL_FALLBACK_CHAT_MODE });
    }
  }, [settings, updateSettings]);

  if (!settings) {
    return null;
  }

  const isProEnabled = isDyadProEnabled(settings);
  const isDyadFreeSelected = isFreeProModel(settings.selectedModel);
  const freeAgentQuotaAvailable = quotaStatus
    ? !quotaStatus.isQuotaExceeded
    : undefined;
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
  const showBasicAgentOption =
    isProEnabled || freeAgentQuotaAvailable !== false;

  const handleDefaultChatModeChange = (value: ChatMode) => {
    if (isFreeProBuildModeCombination(settings.selectedModel, value)) {
      return;
    }
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return "Build";
      case "local-agent":
        return isProEnabled ? "Agent" : "Basic Agent";
      case "ask":
        return "Ask";
      case "plan":
        return "Plan";
      default:
        throw new Error(`Unknown chat mode: ${mode}`);
    }
  };

  return (
    <SettingField
      htmlFor="default-chat-mode"
      label={t("workflow.defaultChatMode")}
      description={t("workflow.defaultChatModeDescription")}
    >
      <Select
        value={effectiveDefault}
        onValueChange={(v) => v && handleDefaultChatModeChange(v)}
      >
        <SelectTrigger
          className="w-full sm:w-[240px]"
          id="default-chat-mode"
          aria-describedby="default-chat-mode-description"
        >
          <SelectValue>{getModeDisplayName(effectiveDefault)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {showBasicAgentOption && (
            <SelectItem value="local-agent">
              <div className="flex flex-col items-start">
                <span className="font-medium">
                  {isProEnabled ? "Agent" : "Basic Agent"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isProEnabled
                    ? "Better at bigger tasks"
                    : "Free tier (10 messages/day)"}
                </span>
              </div>
            </SelectItem>
          )}
          <SelectItem value="build" disabled={isDyadFreeSelected}>
            <div className="flex flex-col items-start">
              <span className="font-medium">Build</span>
              <span className="text-xs text-muted-foreground">
                {isDyadFreeSelected
                  ? "Use Agent with Dyad Free"
                  : "Generate and edit code"}
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingField>
  );
}
