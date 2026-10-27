import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "@/hooks/useSettings";
import { resolveUiFontFamily } from "@/hooks/useUiFontFamily";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UI_FONT_FAMILY_IDS,
  UI_FONT_FAMILY_STACKS,
  type UiFontFamilyId,
} from "@/shared/settings_defaults";

/**
 * Picks the font used for Dyad's own UI. Each option is rendered in its own
 * typeface so the choice can be made by eye rather than by name.
 */
export function UiFontSelector() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  const currentFont: UiFontFamilyId = useMemo(
    () => resolveUiFontFamily(settings?.uiFontFamily),
    [settings?.uiFontFamily],
  );

  const handleChange = async (value: UiFontFamilyId | null) => {
    if (!value) return;
    await updateSettings({ uiFontFamily: value });
  };

  return (
    <SettingField
      htmlFor="ui-font-family"
      label={t("general.uiFont")}
      description={t("general.uiFontDescription")}
    >
      <Select value={currentFont} onValueChange={handleChange}>
        <SelectTrigger
          id="ui-font-family"
          className="w-full sm:w-[240px]"
          aria-describedby="ui-font-family-description"
        >
          <SelectValue placeholder={t("general.selectUiFont")} />
        </SelectTrigger>
        <SelectContent>
          {UI_FONT_FAMILY_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              <span
                style={{ fontFamily: UI_FONT_FAMILY_STACKS[id] }}
                className="text-base"
              >
                {t(`general.uiFontOptions.${id}`)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingField>
  );
}
