import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Language, LanguageSchema } from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import i18n from "@/i18n";

const DEFAULT_LANGUAGE: Language = "en";

/**
 * Language labels shown in their native script so users can always
 * find their language regardless of the current UI language.
 */
const LANGUAGE_OPTIONS: { value: Language; nativeLabel: string }[] = [
  { value: "en", nativeLabel: "English" },
  { value: "zh-CN", nativeLabel: "简体中文" },
  { value: "ja", nativeLabel: "日本語" },
  { value: "ko", nativeLabel: "한국어" },
  { value: "es", nativeLabel: "Español" },
  { value: "fr", nativeLabel: "Français" },
  { value: "de", nativeLabel: "Deutsch" },
];

export function LanguageSelector() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  const currentLanguage: Language = useMemo(() => {
    const value = settings?.language ?? DEFAULT_LANGUAGE;
    return LanguageSchema.safeParse(value).success
      ? (value as Language)
      : DEFAULT_LANGUAGE;
  }, [settings?.language]);

  const handleChange = (value: string) => {
    i18n.changeLanguage(value);
    updateSettings({ language: value as Language });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="language">{t("general.language")}</Label>
        <p className="text-sm text-muted-foreground">
          {t("general.languageDescription")}
        </p>
      </div>
      <Select value={currentLanguage} onValueChange={handleChange}>
        <SelectTrigger id="language" className="w-[220px]">
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
    </div>
  );
}
