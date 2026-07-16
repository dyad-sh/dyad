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
import { DEFAULT_MAX_TOOL_CALL_STEPS } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

interface OptionInfo {
  value: string;
  label: string;
  description: string;
}

const defaultValue = "default";

const options: OptionInfo[] = [
  {
    value: "25",
    label: "Low (25)",
    description:
      "Limits tool calls to 25. Good for simple tasks that don't need many steps.",
  },
  {
    value: "50",
    label: "Medium (50)",
    description: "Moderate limit for straightforward tasks.",
  },
  {
    value: defaultValue,
    label: `Default (${DEFAULT_MAX_TOOL_CALL_STEPS})`,
    description: "Balanced limit for most tasks.",
  },
  {
    value: "200",
    label: "High (200)",
    description:
      "Extended limit for complex multi-step tasks (may increase cost and time).",
  },
];

export const MaxToolCallStepsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxToolCallSteps: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxToolCallSteps: numValue });
    }
  };

  // Determine the current value
  const rawValue = settings?.maxToolCallSteps;
  const currentValue =
    rawValue == null || rawValue === DEFAULT_MAX_TOOL_CALL_STEPS
      ? defaultValue
      : rawValue.toString();

  // Find the current option to display its description
  const currentOption =
    options.find((opt) => opt.value === currentValue) ||
    options.find((opt) => opt.value === defaultValue) ||
    options[0];

  return (
    <SettingField
      htmlFor="max-tool-call-steps"
      label={t("ai.maxToolCallSteps")}
      description={currentOption.description}
    >
      <Select
        value={currentValue}
        onValueChange={(v) => v && handleValueChange(v)}
      >
        <SelectTrigger className="w-full sm:w-[240px]" id="max-tool-call-steps">
          <SelectValue placeholder={t("ai.selectMaxToolCallSteps")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingField>
  );
};
