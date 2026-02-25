import { Palette, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterType = "all" | "themes" | "prompts";

const FILTER_OPTIONS: {
  key: FilterType;
  label: string;
  icon: typeof BookOpen;
}[] = [
  { key: "all", label: "All", icon: BookOpen },
  { key: "themes", label: "Themes", icon: Palette },
  { key: "prompts", label: "Prompts", icon: FileText },
];

export function LibraryFilterTabs({
  active,
  onChange,
}: {
  active: FilterType;
  onChange: (f: FilterType) => void;
}) {
  return (
    <div className="flex gap-2 mb-6">
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            active === opt.key
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          <opt.icon className="h-3.5 w-3.5" />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
