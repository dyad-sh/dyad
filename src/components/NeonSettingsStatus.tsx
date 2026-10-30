import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function NeonSettingsStatus({
  loading,
  onRetry,
}: {
  loading: boolean;
  onRetry: () => Promise<unknown>;
}) {
  const { t } = useTranslation("home");
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-muted-foreground">
        {t(
          loading
            ? "integrations.neon.branchSafety.settingsLoading"
            : "integrations.neon.branchSafety.settingsUnavailable",
        )}
      </p>
      {!loading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onRetry().catch(() => {})}
        >
          {t("integrations.neon.retry")}
        </Button>
      )}
    </div>
  );
}
