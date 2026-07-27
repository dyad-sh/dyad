import { useSettings } from "@/hooks/useSettings";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";
import { getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useTranslation } from "react-i18next";

export function DefaultChatModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  const effectiveDefault = getEffectiveDefaultChatMode(settings);

  const handleDefaultChatModeChange = (value: ChatMode) => {
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "local-agent":
        return "Agent";
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
          <SelectItem value="local-agent">
            <div className="flex flex-col items-start">
              <span className="font-medium">Agent</span>
              <span className="text-xs text-muted-foreground">
                Build and debug with tools
              </span>
            </div>
          </SelectItem>
          <SelectItem value="ask">Ask</SelectItem>
          <SelectItem value="plan">Plan</SelectItem>
        </SelectContent>
      </Select>
    </SettingField>
  );
}
