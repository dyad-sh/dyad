import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Language, LanguageSchema } from "@/lib/schemas";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_LANGUAGE: Language = "en";

/**
 * Language labels shown in their native script so users can always
 * find their language regardless of the current UI language.
 * Only languages with completed translations are listed here.
 */
const LANGUAGE_OPTIONS: { value: Language; nativeLabel: string }[] = [
  { value: "en", nativeLabel: "English" },
  { value: "zh-CN", nativeLabel: "简体中文" },
  { value: "pt-BR", nativeLabel: "Português (Brasil)" },
  { value: "es", nativeLabel: "Español" },
  { value: "ko", nativeLabel: "한국어" },
  // Additional languages will be added as translations are completed:
  // { value: "ja", nativeLabel: "日本語" },
  // { value: "fr", nativeLabel: "Français" },
  // { value: "de", nativeLabel: "Deutsch" },
];

export function LanguageSelector() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  const currentLanguage: Language = useMemo(() => {
    const parsed = LanguageSchema.safeParse(settings?.language);
    return parsed.success ? parsed.data : DEFAULT_LANGUAGE;
  }, [settings?.language]);

  const handleChange = async (value: Language | null) => {
    if (!value) return;
    try {
      await updateSettings({ language: value });
      // Language change is handled by the useEffect in layout.tsx
      // after settings are successfully persisted
    } catch (error) {
      console.error("Failed to update language setting:", error);
      // Settings update failed, so no language change will occur
    }
  };

  return (
    <SettingField
      htmlFor="language"
      label={t("general.language")}
      description={t("general.languageDescription")}
    >
      <Select value={currentLanguage} onValueChange={handleChange}>
        <SelectTrigger id="language" className="w-full sm:w-[240px]">
          <SelectValue placeholder="Select language" />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGE_OPTIONS.map((lang) => (
            <SelectItem key={lang.value} value={lang.value}>
              {lang.nativeLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingField>
  );
}
