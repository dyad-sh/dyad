import { SquareTerminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface TerminalEscapeBannerProps {
  appName: string;
  cwd?: string;
  onExit: () => void;
}

export function TerminalEscapeBanner({
  cwd,
  onExit,
}: TerminalEscapeBannerProps) {
  const { t } = useTranslation("chat");

  return (
    <div
      className={cn(
        "flex h-10 w-full items-center gap-2 border-b border-border bg-muted/30 px-3 text-left text-xs text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onExit}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("terminal.context.exit")}
      >
        <X className="size-4" />
      </button>
      <span className="shrink-0 font-medium leading-none">
        {t("terminal.bannerMode")}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {cwd ?? ""}
      </span>
      <button
        type="button"
        onClick={onExit}
        data-testid="terminal-banner-toggle-button"
        className="ml-auto flex shrink-0 cursor-pointer items-center rounded-md bg-primary/10 p-2 text-primary transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("terminal.toggleAriaLabel")}
      >
        <SquareTerminal size={20} />
      </button>
    </div>
  );
}
