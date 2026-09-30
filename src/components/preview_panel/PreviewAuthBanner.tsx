import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PreviewAuthStatus } from "@/app_run/state";
import { useTranslation } from "react-i18next";

export function PreviewAuthBanner({
  status,
  onRetry,
  disabled,
}: {
  status?: PreviewAuthStatus;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  if (!status) return null;
  const pending = status.state === "pending";
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
      data-testid="preview-auth-banner"
    >
      {pending && (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <p role="status" className="min-w-0 flex-1">
        {pending
          ? status.provider === "neon"
            ? t("previewAuth.neonPending")
            : t("previewAuth.supabasePending")
          : status.message}
      </p>
      {!pending && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={disabled}
        >
          {t("previewAuth.retry")}
        </Button>
      )}
    </div>
  );
}
