import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  DestructiveStatement,
  MigrationPreviewResponse,
} from "@/ipc/types/migration";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: MigrationPreviewResponse | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  targetBranchName?: string;
  onApprove: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}

export const MigrationSqlPreviewDialog = ({
  open,
  onOpenChange,
  preview,
  isLoading,
  isError,
  errorMessage,
  targetBranchName,
  onApprove,
  onCancel,
  onRetry,
}: Props) => {
  const { t } = useTranslation("home");
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const errorDetailsId = useId();

  const destructiveByIndex = useMemo(() => {
    const map = new Map<number, DestructiveStatement>();
    preview?.destructiveStatements.forEach((d) => map.set(d.index, d));
    return map;
  }, [preview?.destructiveStatements]);

  const statements = preview?.statements ?? [];
  const hasStatements = statements.length > 0;
  const hasDataLoss = preview?.hasDataLoss ?? false;
  const destructiveCount = preview?.destructiveStatements.length ?? 0;
  const warnings = useMemo(
    () =>
      (preview?.warningReasons ?? []).map((reason) =>
        t(`integrations.migration.preview.destructive.reasons.${reason}`),
      ),
    [preview?.warningReasons, t],
  );

  const subtitle = targetBranchName
    ? t("integrations.migration.preview.subtitle", { targetBranchName })
    : t("integrations.migration.preview.subtitleNoTarget");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("integrations.migration.preview.title")}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          {isLoading && (
            <div
              role="status"
              className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground"
            >
              <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
              {t("integrations.migration.preview.loading")}
            </div>
          )}

          {!isLoading && isError && (
            <div
              role="alert"
              className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{t("integrations.migration.preview.loadingError")}</span>
              </div>
              {errorMessage && (
                <>
                  <button
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    aria-expanded={showErrorDetails}
                    aria-controls={errorDetailsId}
                    className="flex items-center gap-1 text-xs text-red-600 dark:text-red-300 hover:underline"
                  >
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${showErrorDetails ? "rotate-180" : ""}`}
                    />
                    {showErrorDetails
                      ? t("integrations.migration.hideDetails")
                      : t("integrations.migration.showDetails")}
                  </button>
                  {showErrorDetails && (
                    <pre
                      id={errorDetailsId}
                      className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-red-100 p-2 font-mono text-xs dark:bg-red-900/40"
                    >
                      {errorMessage}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}

          {!isLoading && !isError && !hasStatements && (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {t("integrations.migration.preview.noChanges")}
            </div>
          )}

          {!isLoading && !isError && hasStatements && (
            <>
              <div
                role="note"
                className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>{t("integrations.migration.preview.reviewAdvisory")}</div>
              </div>

              <div
                role="region"
                aria-label={t(
                  "integrations.migration.preview.sqlStatementsRegionLabel",
                )}
                tabIndex={0}
                className={
                  hasDataLoss
                    ? "rounded border border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950 text-slate-900 dark:text-slate-50 font-mono text-xs"
                    : "rounded border border-l-4 border-l-green-500 bg-green-50 dark:bg-green-950 text-slate-900 dark:text-slate-50 font-mono text-xs"
                }
              >
                {statements.map((stmt, index) => {
                  const destructive = destructiveByIndex.get(index);
                  return (
                    <div
                      key={index}
                      className={
                        destructive
                          ? "flex items-start gap-2 border-l-4 border-red-500 bg-red-50/60 dark:bg-red-900/20 px-3 py-2 whitespace-pre-wrap text-red-900 dark:text-red-200"
                          : "flex items-start gap-2 border-l-4 border-transparent px-3 py-2 whitespace-pre-wrap"
                      }
                    >
                      {destructive ? (
                        <AlertTriangle
                          className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-300"
                          aria-label={t(
                            "integrations.migration.preview.destructiveStatementLabel",
                          )}
                        />
                      ) : (
                        <span
                          className="w-4 flex-shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="flex-1">{stmt}</span>
                    </div>
                  );
                })}
              </div>

              {hasDataLoss && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-sm text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3"
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <div className="font-medium">
                      {t("integrations.migration.preview.destructive.title")}
                    </div>
                    {warnings.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {destructiveCount > 0 && (
                      <div className="text-xs opacity-80">
                        {t(
                          "integrations.migration.preview.destructive.subtitle",
                          { count: destructiveCount },
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {isLoading || hasStatements
              ? t("integrations.migration.preview.cancel")
              : t("integrations.migration.preview.close")}
          </Button>
          {!isLoading && isError && onRetry && (
            <Button type="button" onClick={onRetry}>
              {t("integrations.migration.preview.retry")}
            </Button>
          )}
          {hasStatements && (
            <Button
              type="button"
              onClick={onApprove}
              disabled={isLoading || isError}
              variant={hasDataLoss ? "destructive" : "default"}
            >
              {hasDataLoss
                ? t("integrations.migration.preview.continueWithDataLoss")
                : t("integrations.migration.preview.continue")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
