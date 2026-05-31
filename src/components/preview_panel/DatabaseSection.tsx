import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Database,
  FlaskConical,
  Loader2,
  Server,
  UploadCloud,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useNeon } from "@/hooks/useNeon";
import { MigrationPanelBody } from "@/components/MigrationPanel";
import { DatabaseEnvVars } from "@/components/preview_panel/DatabaseEnvVars";

type EnvKind = "prod" | "dev";

interface DatabaseSectionProps {
  appId: number;
}

const ENV_TO_BRANCH: Record<EnvKind, "production" | "development"> = {
  prod: "production",
  dev: "development",
};

const branchTypeToEnv = (
  value: "production" | "development" | null | undefined,
): EnvKind | null =>
  value === "development" ? "dev" : value === "production" ? "prod" : null;

const ENV_META: Record<
  EnvKind,
  {
    branchType: "production" | "development";
    icon: typeof Server;
  }
> = {
  prod: { branchType: "production", icon: Server },
  dev: { branchType: "development", icon: FlaskConical },
};

export const DatabaseSection = ({ appId }: DatabaseSectionProps) => {
  const { t } = useTranslation("home");
  const { app, refreshApp } = useLoadApp(appId);
  const { branches, isLoadingBranches } = useNeon(appId);

  const productionBranch = branches.find((b) => b.type === "production");
  const effectiveBranchId =
    app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId;
  const isProductionBranchActive =
    !!effectiveBranchId && effectiveBranchId === productionBranch?.branchId;

  // The persisted deploy-branch choice lives on the app row. `override` holds an
  // optimistic value for instant UI until the app query refetches; `undefined`
  // means "use the persisted value".
  const persistedEnv = branchTypeToEnv(app?.selectedDatabaseBranchType);
  const [override, setOverride] = useState<EnvKind | null | undefined>(
    undefined,
  );
  const [pendingEnv, setPendingEnv] = useState<EnvKind | null>(null);

  useEffect(() => {
    setOverride(undefined);
    setPendingEnv(null);
  }, [appId]);

  const selectedEnv = override !== undefined ? override : persistedEnv;

  const setBranchMutation = useMutation({
    mutationFn: (branchType: "production" | "development" | null) =>
      ipc.neon.setSelectedDatabaseBranchType({ appId, branchType }),
    onSuccess: async () => {
      await refreshApp();
      setOverride(undefined);
    },
    onError: (_error, branchType) => {
      if (branchType === null) {
        // The user pressed "Back": honor that intent by keeping the picker
        // visible (override stays null) rather than snapping back to the
        // branch they were trying to leave.
        setOverride(null);
        toast.error(t("integrations.database.clearBranchError"));
      } else {
        setOverride(undefined);
        toast.error(t("integrations.database.selectBranchError"));
      }
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => ipc.vercel.syncNeonConfig({ appId }),
    onSuccess: (result) => {
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(t("integrations.database.syncSuccess"));
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || t("integrations.database.syncError"));
    },
  });

  const confirmEnv = () => {
    if (pendingEnv === null) return;
    setOverride(pendingEnv);
    setBranchMutation.mutate(ENV_TO_BRANCH[pendingEnv]);
  };

  const handleBack = () => {
    setOverride(null);
    setPendingEnv(null);
    setBranchMutation.mutate(null);
  };

  // A branch is "selected" once the app is on production or an env was picked.
  // Don't surface the sync action on the branch-selection screen.
  const hasBranchSelected = isProductionBranchActive || selectedEnv !== null;
  const showSync =
    !!app?.vercelProjectId &&
    !!app?.neonProjectId &&
    !isLoadingBranches &&
    hasBranchSelected;

  return (
    <Card data-testid="database-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          {t("integrations.database.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showSync && (
          <div
            className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            data-testid="sync-to-vercel"
          >
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t("integrations.database.syncToVercelHelp")}
            </p>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("integrations.database.syncing")}
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  {t("integrations.database.syncToVercel")}
                </>
              )}
            </Button>
          </div>
        )}

        {isLoadingBranches ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("integrations.database.loading")}
          </div>
        ) : isProductionBranchActive ? (
          // Case 2: the app is already on the production branch.
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("integrations.database.productionActiveMessage")}
            </p>
            <DatabaseEnvVars appId={appId} branchType="production" />
          </>
        ) : selectedEnv === null ? (
          // Case 1: pick which database branch to deploy against.
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("integrations.database.pickDatabase")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(Object.keys(ENV_META) as EnvKind[]).map((kind) => {
                const meta = ENV_META[kind];
                const Icon = meta.icon;
                const isSelected = pendingEnv === kind;
                const metaKey = kind === "prod" ? "production" : "development";
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setPendingEnv(kind)}
                    aria-pressed={isSelected}
                    className={`text-left rounded-lg border bg-background p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? "border-primary ring-2 ring-primary"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 text-primary" />
                      <span className="font-medium">
                        {t(`integrations.database.${metaKey}.title`)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t(`integrations.database.${metaKey}.description`)}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={confirmEnv}
                disabled={pendingEnv === null || setBranchMutation.isPending}
              >
                {t("integrations.database.continue")}
              </Button>
            </div>
          </>
        ) : (
          // Case 1: a branch was picked — show migration (production only) + env vars.
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="-ml-2"
                disabled={setBranchMutation.isPending}
              >
                <ArrowLeft className="w-4 h-4" />
                {t("integrations.database.backToSelection")}
              </Button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(
                  `integrations.database.${
                    selectedEnv === "prod" ? "production" : "development"
                  }.title`,
                )}
              </span>
            </div>

            {selectedEnv === "prod" && <MigrationPanelBody appId={appId} />}

            <DatabaseEnvVars
              appId={appId}
              branchType={ENV_META[selectedEnv].branchType}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
};
