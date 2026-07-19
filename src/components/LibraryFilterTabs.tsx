import { Palette, FileText, BookOpen, Image } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type FilterType = "all" | "themes" | "prompts" | "media";

const FILTER_OPTIONS: {
  key: FilterType;
  labelKey: FilterType;
  icon: typeof BookOpen;
}[] = [
  { key: "all", labelKey: "all", icon: BookOpen },
  { key: "themes", labelKey: "themes", icon: Palette },
  { key: "prompts", labelKey: "prompts", icon: FileText },
  { key: "media", labelKey: "media", icon: Image },
];

export function LibraryFilterTabs({
  active,
  onChange,
}: {
  active: FilterType;
  onChange: (f: FilterType) => void;
}) {
  const { t } = useTranslation("home");
  return (
    <div
      className="flex gap-2 mb-6"
      role="group"
      aria-label={t("library.filters")}
    >
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={active === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            active === opt.key
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          <opt.icon className="h-3.5 w-3.5" />
          {t(`library.${opt.labelKey}`)}
        </button>
      ))}
    </div>
  );
}
