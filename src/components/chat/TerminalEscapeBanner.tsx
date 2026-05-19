import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface TerminalEscapeBannerProps {
  appName: string;
  cwd?: string;
  onExit: () => void;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function getTerminalExitShortcutLabel(): string {
  return isMacPlatform() ? "⌘K" : "Ctrl+K";
}

export function TerminalEscapeBanner({
  appName,
  cwd,
  onExit,
}: TerminalEscapeBannerProps) {
  const { t } = useTranslation("chat");
  const shortcut = getTerminalExitShortcutLabel();

  return (
    <button
      type="button"
      onClick={onExit}
      className={cn(
        "flex h-8 w-full items-center gap-2 border-b border-primary/15 bg-primary/8 px-3 text-left text-xs text-foreground transition-colors hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      <X className="size-3.5 shrink-0 text-primary" />
      <span className="shrink-0 font-medium">{t("terminal.bannerMode")}</span>
      <span className="hidden min-w-0 flex-1 truncate text-muted-foreground min-[480px]:block">
        {appName}
        {cwd ? ` · ${cwd}` : ""}
      </span>
      <span className="ml-auto shrink-0 text-muted-foreground">
        {t("terminal.bannerExitPrefix")}{" "}
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          {shortcut}
        </kbd>
      </span>
    </button>
  );
}
