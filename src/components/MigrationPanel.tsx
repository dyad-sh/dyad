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
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/lib/errors";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useNeon } from "@/hooks/useNeon";
import { queryKeys } from "@/lib/queryKeys";
import { MigrationSqlPreviewDialog } from "./MigrationSqlPreviewDialog";

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

  const previewMutation = useMutation({
    mutationFn: () => ipc.migration.preview({ appId }),
    onSuccess: invalidateDepsStatus,
    onError: invalidateDepsStatus,
  });

  const migrateMutation = useMutation({
    mutationFn: (migrationId: string) =>
      ipc.migration.migrate({ appId, migrationId }),
    onSuccess: invalidateDepsStatus,
    onError: invalidateDepsStatus,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const previewHasDataLoss = previewMutation.data?.hasDataLoss ?? false;

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
    if (migrateMutation.isSuccess && migrateMutation.data?.success) {
      const timer = setTimeout(() => migrateMutation.reset(), 5000);
      return () => clearTimeout(timer);
    }
  }, [migrateMutation.isSuccess, migrateMutation.data?.success]);

  const errorSummary = migrateMutation.isError
    ? getErrorMessage(migrateMutation.error)
    : t("integrations.migration.errorMessage");
  const errorDetails =
    migrateMutation.error instanceof Error
      ? (migrateMutation.error.stack ?? migrateMutation.error.message)
      : migrateMutation.error
        ? getErrorMessage(migrateMutation.error)
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

        {depsInstalled === false && !migrateMutation.isPending && (
          <div
            role="note"
            className="flex items-start gap-2 text-sm text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3"
          >
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t("integrations.migration.installDependenciesNote")}</span>
          </div>
        )}

        <Button
          disabled={
            migrateMutation.isPending ||
            previewMutation.isPending ||
            isProductionBranchActive
          }
          onClick={() => {
            setShowErrorDetails(false);
            installingDepsRef.current = depsInstalled === false;
            previewMutation.reset();
            // Clear any prior migrate error/success so the stale banner doesn't
            // sit behind the preview dialog while the user reviews a new plan.
            migrateMutation.reset();
            previewMutation.mutate();
            setPreviewOpen(true);
          }}
        >
          {migrateMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {installingDepsRef.current
                ? t("integrations.migration.installingDependencies")
                : t("integrations.migration.migrating")}
            </>
          ) : previewMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("integrations.migration.computingMigrationPlan")}
            </>
          ) : (
            <>
              <Database className="w-4 h-4 mr-2" />
              {t("integrations.migration.migrateToProduction")}
            </>
          )}
        </Button>

        <MigrationSqlPreviewDialog
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open);
            // Don't reset() while the mutation is in-flight: doing so flips
            // isPending back to false and re-enables the trigger button, but
            // the backend preview keeps running. A second click would then
            // race the first request through the same deterministic work
            // dir, with each ensureFreshWorkDir wiping the other's files.
            if (!open && !previewMutation.isPending) previewMutation.reset();
          }}
          preview={previewMutation.data ?? null}
          isLoading={previewMutation.isPending}
          isError={previewMutation.isError}
          errorMessage={
            previewMutation.error
              ? getErrorMessage(previewMutation.error)
              : undefined
          }
          targetBranchName={targetBranchName}
          onApprove={() => {
            setPreviewOpen(false);
            setConfirmOpen(true);
          }}
          onCancel={() => {
            setPreviewOpen(false);
            if (!previewMutation.isPending) previewMutation.reset();
          }}
          onRetry={() => previewMutation.mutate()}
        />

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("integrations.migration.migrateToProduction")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDescription}
                {previewHasDataLoss && (
                  <span className="mt-2 block font-medium text-red-700 dark:text-red-300">
                    {t("integrations.migration.confirmDestructiveWarning")}
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("integrations.migration.cancel")}
              </AlertDialogCancel>
              {previewMutation.data && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConfirmOpen(false);
                    setPreviewOpen(true);
                  }}
                >
                  {t("integrations.migration.backToReview")}
                </Button>
              )}
              <AlertDialogAction
                className={
                  previewHasDataLoss
                    ? buttonVariants({ variant: "destructive" })
                    : undefined
                }
                disabled={!previewMutation.data?.migrationId}
                onClick={() => {
                  const migrationId = previewMutation.data?.migrationId;
                  setShowErrorDetails(false);
                  setConfirmOpen(false);
                  if (!migrationId) {
                    // Lost the preview between approve and confirm — re-open
                    // the preview dialog so the user can regenerate.
                    setPreviewOpen(true);
                    return;
                  }
                  // Deps were installed during preview if needed; the migrate
                  // step itself never installs anything, so make sure the
                  // in-flight label doesn't claim otherwise.
                  installingDepsRef.current = false;
                  migrateMutation.mutate(migrationId);
                }}
              >
                {previewHasDataLoss
                  ? t("integrations.migration.migrateToProductionDestructive")
                  : t("integrations.migration.migrateToProduction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isProductionBranchActive && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("integrations.migration.switchBranchHint")}
          </p>
        )}

        {migrateMutation.isSuccess &&
          migrateMutation.data?.success &&
          !migrateMutation.data?.noChanges && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {t("integrations.migration.success")}
            </div>
          )}

        {migrateMutation.isSuccess && migrateMutation.data?.noChanges && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3"
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {t("integrations.migration.alreadyInSync")}
          </div>
        )}

        {migrateMutation.isError && (
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
