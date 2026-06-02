import React from "react";
import { useSettings } from "@/hooks/useSettings";
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
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="thinking-budget"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.thinkingBudget")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="thinking-budget">
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
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {currentOption.description}
      </div>
    </div>
  );
};
