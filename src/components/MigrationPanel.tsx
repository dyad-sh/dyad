import { useEffect, useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface MigrationPanelProps {
  appId: number;
}

export const MigrationPanel = ({ appId }: MigrationPanelProps) => {
  const { t } = useTranslation("home");
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const errorDetailsId = useId();
  const pushMutation = useMutation({
    mutationFn: () => ipc.migration.push({ appId }),
  });

  // Auto-dismiss success/info banners after 5 seconds
  useEffect(() => {
    if (pushMutation.isSuccess && pushMutation.data?.success) {
      const timer = setTimeout(() => pushMutation.reset(), 5000);
      return () => clearTimeout(timer);
    }
  }, [pushMutation.isSuccess, pushMutation.data?.success]);

  const errorSummary =
    pushMutation.error instanceof Error
      ? pushMutation.error.message
      : pushMutation.isError
        ? String(pushMutation.error)
        : t("integrations.migration.errorMessage");
  const errorDetails =
    pushMutation.error instanceof Error
      ? pushMutation.error.message
      : pushMutation.error
        ? String(pushMutation.error)
        : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          {t("integrations.migration.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("integrations.migration.description")}
        </p>

        <Button
          onClick={() => {
            setShowErrorDetails(false);
            pushMutation.mutate();
          }}
          disabled={pushMutation.isPending}
        >
          {pushMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("integrations.migration.migrating")}
            </>
          ) : (
            <>
              <Database className="w-4 h-4 mr-2" />
              {t("integrations.migration.migrateToProduction")}
            </>
          )}
        </Button>

        {pushMutation.isSuccess &&
          pushMutation.data?.success &&
          !pushMutation.data?.noChanges && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {t("integrations.migration.success")}
            </div>
          )}

        {pushMutation.isSuccess && pushMutation.data?.noChanges && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3"
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {t("integrations.migration.alreadyInSync")}
          </div>
        )}

        {pushMutation.isError && (
          <div
            role="alert"
            className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{errorSummary}</span>
            </div>
            {errorDetails && (
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
                    className="text-xs font-mono bg-red-100 dark:bg-red-900/40 rounded p-2 overflow-x-auto whitespace-pre-wrap"
                  >
                    {errorDetails}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
