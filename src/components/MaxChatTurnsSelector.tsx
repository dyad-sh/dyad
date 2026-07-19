import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

interface OptionInfo {
  value: string;
  label: string;
  description: string;
}

const defaultValue = "default";

export const MaxChatTurnsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const options: OptionInfo[] = [
    {
      value: "2",
      label: t("ai.chatTurnEconomy"),
      description: t("ai.chatTurnEconomyDescription"),
    },
    {
      value: defaultValue,
      label: t("ai.chatTurnDefault", { count: MAX_CHAT_TURNS_IN_CONTEXT }),
      description: t("ai.chatTurnDefaultDescription"),
    },
    {
      value: "5",
      label: t("ai.chatTurnPlus"),
      description: t("ai.chatTurnPlusDescription"),
    },
    {
      value: "10",
      label: t("ai.chatTurnHigh"),
      description: t("ai.chatTurnHighDescription"),
    },
    {
      value: "100",
      label: t("ai.chatTurnMax"),
      description: t("ai.chatTurnMaxDescription"),
    },
  ];

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxChatTurnsInContext: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxChatTurnsInContext: numValue });
    }
  };

  // Determine the current value
  const currentValue =
    settings?.maxChatTurnsInContext?.toString() || defaultValue;

  // Find the current option to display its description
  const currentOption =
    options.find((opt) => opt.value === currentValue) || options[1];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="max-chat-turns"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.maxChatTurns")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="max-chat-turns">
            <SelectValue placeholder={t("ai.selectMaxChatTurns")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {currentOption.description}
      </div>
    </div>
  );
};
