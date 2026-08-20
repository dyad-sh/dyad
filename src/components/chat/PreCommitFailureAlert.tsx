import { Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export function PreCommitFailureAlert({
  error,
  isStartingFix,
  onFix,
}: {
  error: Error;
  isStartingFix: boolean;
  onFix: () => void;
}) {
  const { t } = useTranslation("home");

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
      data-testid="pre-commit-failure-alert"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("preview.preCommitFailed")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("preview.preCommitFailedDescription")}
            </p>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              {t("preview.viewPreCommitOutput")}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono">
              {error.message}
            </pre>
          </details>
          <Button
            type="button"
            size="sm"
            onClick={onFix}
            disabled={isStartingFix}
            data-testid="fix-pre-commit-with-ai-button"
          >
            <Sparkles className="h-4 w-4" />
            {isStartingFix
              ? t("preview.startingAiFix")
              : t("preview.fixWithAi")}
          </Button>
        </div>
      </div>
    </div>
  );
}
