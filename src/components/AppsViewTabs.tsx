import { cn } from "@/lib/utils";

export type AppsView = "apps" | "collections";

interface AppsViewTabsProps {
  value: AppsView;
  onChange: (value: AppsView) => void;
}

const TABS: { key: AppsView; label: string }[] = [
  { key: "apps", label: "Apps" },
  { key: "collections", label: "Collections" },
];

export function AppsViewTabs({ value, onChange }: AppsViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Apps view"
      className="flex items-center gap-2"
      data-testid="apps-view-tabs"
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`apps-view-tab-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-(--background-lighter) text-foreground border-border hover:border-primary/40",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
