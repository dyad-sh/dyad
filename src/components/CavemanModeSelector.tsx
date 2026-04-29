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
import { Label } from "@/components/ui/label";
import { CavemanMode } from "@/lib/schemas";

interface OptionInfo {
  value: CavemanMode;
  labelKey: string;
  descriptionKey: string;
}

const options: OptionInfo[] = [
  {
    value: "off",
    labelKey: "ai.cavemanOff",
    descriptionKey: "ai.cavemanOffDescription",
  },
  {
    value: "lite",
    labelKey: "ai.cavemanLite",
    descriptionKey: "ai.cavemanLiteDescription",
  },
  {
    value: "full",
    labelKey: "ai.cavemanFull",
    descriptionKey: "ai.cavemanFullDescription",
  },
  {
    value: "ultra",
    labelKey: "ai.cavemanUltra",
    descriptionKey: "ai.cavemanUltraDescription",
  },
];

export const CavemanModeSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleValueChange = (value: string) => {
    updateSettings({ cavemanMode: value as CavemanMode });
  };

  const currentValue = settings?.cavemanMode || "off";
  const currentOption =
    options.find((opt) => opt.value === currentValue) || options[0];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <Label
          htmlFor="caveman-mode"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.cavemanMode")}
        </Label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="caveman-mode">
            <SelectValue placeholder={t("ai.selectCavemanMode")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey as any)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {t(currentOption.descriptionKey as any)}
      </div>
    </div>
  );
};
