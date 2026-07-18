import React from "react";
import { useSettings } from "@/hooks/useSettings";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import {
  THINKING_EFFORT_DEFAULT,
  THINKING_EFFORT_OPTIONS,
  getThinkingEffortOption,
  type ThinkingEffortLevel,
} from "@/lib/thinkingEffort";

export const ThinkingBudgetSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleValueChange = (value: string) => {
    updateSettings({ thinkingBudget: value as ThinkingEffortLevel });
  };

  // Determine the current value
  const currentValue = settings?.thinkingBudget || THINKING_EFFORT_DEFAULT;

  // Find the current option to display its description
  const currentOption = getThinkingEffortOption(currentValue);

  return (
    <SettingField
      htmlFor="thinking-budget"
      label={t("ai.thinkingBudget")}
      description={currentOption.description}
    >
      <Select
        value={currentValue}
        onValueChange={(v) => v && handleValueChange(v)}
      >
        <SelectTrigger
          className="w-full sm:w-[240px]"
          id="thinking-budget"
          aria-describedby="thinking-budget-description"
        >
          <SelectValue placeholder={t("ai.selectThinkingBudget")} />
        </SelectTrigger>
        <SelectContent>
          {THINKING_EFFORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.value === THINKING_EFFORT_DEFAULT
                ? `${option.label} (default)`
                : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingField>
  );
};
