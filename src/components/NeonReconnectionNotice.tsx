import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NeonSignInButton } from "./NeonSignInButton";

export function NeonReconnectionNotice({
  appId,
  projectAccessDenied = false,
  onDismiss,
}: {
  appId?: number;
  projectAccessDenied?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  return (
    <div
      className="relative space-y-3 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="neon-reconnection-notice"
    >
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 size-8"
          aria-label={t("close", { ns: "common" })}
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
      <div role="status" className="space-y-1">
        <p className={cn("text-sm font-medium", onDismiss && "pr-8")}>
          {t("integrations.neon.reconnectTitle")}
        </p>
        <p className="text-sm text-foreground/80">
          {t(
            projectAccessDenied
              ? "integrations.neon.projectAccessRequired"
              : "integrations.neon.reconnectDescription",
          )}
        </p>
      </div>
      <NeonSignInButton
        appId={appId}
        reconnect
        projectAccessDenied={projectAccessDenied}
      />
    </div>
  );
}
