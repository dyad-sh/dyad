import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface MigrationPanelProps {
  appId: number;
}

export const MigrationPanel = ({ appId }: MigrationPanelProps) => {
  const { t } = useTranslation("home");
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const pushMutation = useMutation({
    mutationFn: (force?: boolean) => ipc.migration.push({ appId, force }),
    onSuccess: (data) => {
      if (!data.success && data.warnings?.length) {
        setWarnings(data.warnings);
      }
    },
  });

  const handlePush = () => {
    setWarnings([]);
    pushMutation.mutate(false);
  };

  const handleForceConfirm = () => {
    setWarnings([]);
    pushMutation.mutate(true);
  };

  // Auto-dismiss success/info banners after 5 seconds
  useEffect(() => {
    if (pushMutation.isSuccess && pushMutation.data?.success) {
      const timer = setTimeout(() => pushMutation.reset(), 5000);
      return () => clearTimeout(timer);
    }
  }, [pushMutation.isSuccess, pushMutation.data?.success]);

  return (
    <>
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

          <Button onClick={handlePush} disabled={pushMutation.isPending}>
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
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                {t("integrations.migration.success")}
              </div>
            )}

          {pushMutation.isSuccess && pushMutation.data?.noChanges && (
            <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {t("integrations.migration.alreadyInSync")}
            </div>
          )}

          {pushMutation.isError && (
            <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{t("integrations.migration.errorMessage")}</span>
              </div>
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="flex items-center gap-1 text-xs text-red-600 dark:text-red-300 hover:underline"
              >
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${showErrorDetails ? "rotate-180" : ""}`}
                />
                {t("integrations.migration.showDetails")}
              </button>
              {showErrorDetails && (
                <pre className="text-xs font-mono bg-red-100 dark:bg-red-900/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {pushMutation.error instanceof Error
                    ? pushMutation.error.message
                    : String(pushMutation.error)}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={warnings.length > 0}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              {t("integrations.migration.destructiveChangesTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("integrations.migration.destructiveChangesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setWarnings([])}>
              {t("integrations.migration.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("integrations.migration.proceedAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
