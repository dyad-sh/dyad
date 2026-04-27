import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/lib/errors";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useNeon } from "@/hooks/useNeon";
import { queryKeys } from "@/lib/queryKeys";

interface MigrationPanelProps {
  appId: number;
}

export const MigrationPanel = ({ appId }: MigrationPanelProps) => {
  const { t } = useTranslation("home");
  const { app } = useLoadApp(appId);
  const { projectInfo, branches } = useNeon(appId);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const errorDetailsId = useId();
  const queryClient = useQueryClient();

  const dependenciesStatus = useQuery({
    queryKey: queryKeys.migration.dependenciesStatus({ appId }),
    queryFn: () => ipc.migration.dependenciesStatus({ appId }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const depsInstalled = dependenciesStatus.data?.installed;
  // Capture the install state at click time so the in-flight label doesn't
  // flicker if the status query refetches mid-mutation.
  const installingDepsRef = useRef(false);

  const invalidateDepsStatus = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.migration.dependenciesStatus({ appId }),
    });

  const pushMutation = useMutation({
    mutationFn: () => ipc.migration.push({ appId }),
    onSuccess: invalidateDepsStatus,
    onError: invalidateDepsStatus,
  });

  const productionBranch = branches.find(
    (branch) => branch.type === "production",
  );
  const sourceBranchName = branches.find(
    (branch) => branch.branchId === app?.neonActiveBranchId,
  )?.branchName;
  const targetBranchName = productionBranch?.branchName;
  const projectName = projectInfo?.projectName ?? app?.neonProjectId ?? null;
  const effectiveBranchId =
    app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId;
  const isProductionBranchActive =
    !!effectiveBranchId && effectiveBranchId === productionBranch?.branchId;
  const hasBranchContext = Boolean(
    projectName && sourceBranchName && targetBranchName,
  );
  const description = hasBranchContext
    ? t("integrations.migration.descriptionWithBranches", {
        projectName,
        sourceBranchName,
        targetBranchName,
      })
    : t("integrations.migration.description");
  const confirmDescription = hasBranchContext
    ? t("integrations.migration.confirmDescriptionWithBranches", {
        projectName,
        sourceBranchName,
        targetBranchName,
      })
    : t("integrations.migration.confirmDescription");

  // Auto-dismiss success/info banners after 5 seconds
  useEffect(() => {
    if (pushMutation.isSuccess && pushMutation.data?.success) {
      const timer = setTimeout(() => pushMutation.reset(), 5000);
      return () => clearTimeout(timer);
    }
  }, [pushMutation.isSuccess, pushMutation.data?.success]);

  const errorSummary = pushMutation.isError
    ? getErrorMessage(pushMutation.error)
    : t("integrations.migration.errorMessage");
  const errorDetails =
    pushMutation.error instanceof Error
      ? (pushMutation.error.stack ?? pushMutation.error.message)
      : pushMutation.error
        ? getErrorMessage(pushMutation.error)
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
          {description}
        </p>

        <div
          role="note"
          className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t("integrations.migration.backupWarning")}</span>
        </div>

        {depsInstalled === false && !pushMutation.isPending && (
          <div
            role="note"
            className="flex items-start gap-2 text-sm text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3"
          >
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t("integrations.migration.installDependenciesNote")}</span>
          </div>
        )}

        <AlertDialog>
          <AlertDialogTrigger
            disabled={pushMutation.isPending || isProductionBranchActive}
            render={
              <Button
                disabled={pushMutation.isPending || isProductionBranchActive}
              />
            }
          >
            {pushMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {installingDepsRef.current
                  ? t("integrations.migration.installingDependencies")
                  : t("integrations.migration.migrating")}
              </>
            ) : (
              <>
                <Database className="w-4 h-4 mr-2" />
                {t("integrations.migration.migrateToProduction")}
              </>
            )}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("integrations.migration.migrateToProduction")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("integrations.migration.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setShowErrorDetails(false);
                  installingDepsRef.current = depsInstalled === false;
                  pushMutation.mutate();
                }}
              >
                {t("integrations.migration.migrateToProduction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isProductionBranchActive && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("integrations.migration.switchBranchHint")}
          </p>
        )}

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
            {errorDetails && errorDetails !== errorSummary && (
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
