import { Check, MonitorSmartphone } from "lucide-react";

import { useTheme } from "@/contexts/ThemeContext";
import { UI_THEMES, type UiThemeMeta } from "@/lib/ui_themes";
import { cn } from "@/lib/utils";

/**
 * A miniature of the app in each theme: sidebar, window with title bar, a
 * chat exchange and an accent control — enough to judge a theme before
 * wearing it.
 */
function ThemePreview({ meta }: { meta: UiThemeMeta }) {
  const { preview } = meta;
  return (
    <div
      className="pointer-events-none flex h-24 w-full overflow-hidden rounded-lg border"
      style={{
        background: preview.background,
        borderColor: "rgba(127,127,127,0.25)",
      }}
      aria-hidden
    >
      {/* Sidebar */}
      <div
        className="flex w-1/5 flex-col gap-1 p-1.5"
        style={{ background: preview.sidebar }}
      >
        {[0.9, 0.6, 0.6].map((opacity, index) => (
          <span
            key={index}
            className="h-1.5 rounded-sm"
            style={{
              background: index === 0 ? preview.accent : preview.mutedText,
              opacity,
            }}
          />
        ))}
      </div>
      {/* Window */}
      <div className="flex flex-1 flex-col p-2">
        <div
          className="flex flex-1 flex-col overflow-hidden rounded-md border"
          style={{
            background: preview.surface,
            borderColor: "rgba(127,127,127,0.22)",
          }}
        >
          <div
            className="flex h-3 items-center gap-1 px-1.5"
            style={{ background: preview.titlebar }}
          >
            <span
              className="size-1 rounded-full"
              style={{ background: preview.accent }}
            />
            <span
              className="h-1 w-8 rounded-sm"
              style={{ background: preview.mutedText, opacity: 0.5 }}
            />
          </div>
          <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
            <span
              className="h-1.5 w-3/5 self-end rounded-sm"
              style={{ background: preview.userBubble }}
            />
            <span
              className="h-1.5 w-4/5 rounded-sm"
              style={{ background: preview.text, opacity: 0.55 }}
            />
            <span
              className="h-1.5 w-2/5 rounded-sm"
              style={{ background: preview.text, opacity: 0.35 }}
            />
            <span
              className="mt-0.5 h-2 w-7 rounded-sm"
              style={{ background: preview.accent }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {UI_THEMES.map((meta) => {
          const isActive = theme === meta.id;
          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => setTheme(meta.id)}
              aria-pressed={isActive}
              data-testid={`theme-card-${meta.id}`}
              className={cn(
                "rounded-xl border p-2.5 text-left transition-colors",
                isActive
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-primary/50",
              )}
            >
              <ThemePreview meta={meta} />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{meta.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                {isActive && (
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                    data-testid="theme-card-active"
                  >
                    <Check className="size-3" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setTheme("system")}
        aria-pressed={theme === "system"}
        data-testid="theme-follow-system"
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          theme === "system"
            ? "border-primary text-foreground ring-1 ring-primary"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <MonitorSmartphone className="size-4" />
        <span className="flex-1 text-left">Follow system appearance</span>
        <span className="text-xs text-muted-foreground">
          Light by day, Dark by night — never overrides a chosen theme
        </span>
        {theme === "system" && <Check className="size-4 text-primary" />}
      </button>
    </div>
  );
}
