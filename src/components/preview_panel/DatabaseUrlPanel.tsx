import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Database,
  FlaskConical,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/errors";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useDriftStatus, useSyncToVercel } from "@/hooks/useVercelSync";
import { showSuccess, showError, showWarning } from "@/lib/toast";

type EnvKind = "prod" | "dev";
type DbBranchType = "production" | "development";

interface DatabaseUrlPanelProps {
  appId: number;
}

const LEGACY_STORAGE_KEY = (appId: number) =>
  `dyad.databaseUrlPanel.env.${appId}`;

const ENV_META: Record<
  EnvKind,
  {
    branchType: DbBranchType;
    title: string;
    description: string;
    icon: typeof Server;
  }
> = {
  prod: {
    branchType: "production",
    title: "Production",
    description:
      "Pick this once real users are using the app and you need their data kept safe.",
    icon: Server,
  },
  dev: {
    branchType: "development",
    title: "Development",
    description:
      "Pick this if you're still experimenting and no real users are testing the app yet.",
    icon: FlaskConical,
  },
};

const branchTypeToKind = (branchType: DbBranchType): EnvKind =>
  branchType === "production" ? "prod" : "dev";

export const DatabaseUrlPanel = ({ appId }: DatabaseUrlPanelProps) => {
  const { app, refreshApp } = useLoadApp(appId);
  const queryClient = useQueryClient();

  const persistedBranchType = (app?.databaseUrlBranchType ??
    null) as DbBranchType | null;
  const selectedEnv: EnvKind | null = persistedBranchType
    ? branchTypeToKind(persistedBranchType)
    : null;

  const [pendingEnv, setPendingEnv] = useState<EnvKind | null>(null);
  const [copied, setCopied] = useState(false);

  // One-time migration of the legacy localStorage value into the DB column.
  // Runs once per app once the loaded app row reveals no persisted choice.
  useEffect(() => {
    if (!app || appId == null) return;
    if (app.databaseUrlBranchType != null) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY(appId));
    } catch {
      raw = null;
    }
    if (raw !== "prod" && raw !== "dev") return;
    const branchType: DbBranchType =
      raw === "prod" ? "production" : "development";
    ipc.app
      .setDatabaseUrlBranchType({ appId, branchType })
      .then(() => {
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY(appId));
        } catch {
          /* ignore */
        }
        refreshApp();
      })
      .catch((error) => {
        console.error("Failed to backfill databaseUrlBranchType:", error);
      });
  }, [app, appId, refreshApp]);

  useEffect(() => {
    setPendingEnv(null);
    setCopied(false);
  }, [appId]);

  const setSelectedEnv = async (env: EnvKind) => {
    await ipc.app.setDatabaseUrlBranchType({
      appId,
      branchType: ENV_META[env].branchType,
    });
    refreshApp();
  };

  const confirmEnv = async () => {
    if (pendingEnv === null) return;
    await setSelectedEnv(pendingEnv);
    setPendingEnv(null);
  };

  const branchType: DbBranchType | null =
    selectedEnv !== null ? ENV_META[selectedEnv].branchType : null;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.neon.branchConnectionUri({
      appId,
      branchType: branchType ?? "development",
    }),
    queryFn: () =>
      ipc.neon.getBranchConnectionUri({
        appId,
        branchType: branchType!,
      }),
    enabled: branchType !== null,
    staleTime: 5 * 60 * 1000,
  });

  const hasVercelProject = !!app?.vercelProjectId;
  const lastSyncedBranchType = app?.vercelLastSyncedBranchType as
    | DbBranchType
    | null
    | undefined;
  const branchTypeChanged = useMemo(
    () =>
      !!lastSyncedBranchType &&
      !!branchType &&
      lastSyncedBranchType !== branchType,
    [lastSyncedBranchType, branchType],
  );

  const { data: drift } = useDriftStatus(hasVercelProject ? appId : null);
  const syncMutation = useSyncToVercel(appId);

  const handleBack = async () => {
    await ipc.app.setDatabaseUrlBranchType({ appId, branchType: null });
    refreshApp();
    setPendingEnv(null);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!data?.connectionUri) return;
    await navigator.clipboard.writeText(data.connectionUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync();
      if (result.warning) {
        showWarning(result.warning);
      } else {
        showSuccess("Synced to Vercel.");
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId }),
      });
      refreshApp();
    } catch (err) {
      showError("Sync to Vercel failed: " + getErrorMessage(err));
    }
  };

  const showBranchSwitchCta = hasVercelProject && branchTypeChanged;
  const showDriftBanner =
    hasVercelProject && !!drift?.hasDrift && !branchTypeChanged;

  return (
    <Card data-testid="database-url-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Database URL
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedEnv === null ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Pick the database your deployed app should connect to. Copy the
              connection string into your hosting provider's{" "}
              <code className="font-mono text-xs">DATABASE_URL</code>{" "}
              environment variable.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(Object.keys(ENV_META) as EnvKind[]).map((kind) => {
                const meta = ENV_META[kind];
                const Icon = meta.icon;
                const isSelected = pendingEnv === kind;
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
                      <span className="font-medium">{meta.title}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {meta.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={confirmEnv}
                disabled={pendingEnv === null}
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="-ml-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to selection
              </Button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {ENV_META[selectedEnv].title}
              </span>
            </div>

            <div>
              <label
                htmlFor={`db-url-${appId}`}
                className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block"
              >
                {ENV_META[selectedEnv].title} database URL
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Paste this into your deployed app's{" "}
                <code className="font-mono">DATABASE_URL</code> environment
                variable.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id={`db-url-${appId}`}
                  readOnly
                  type="text"
                  value={
                    isLoading ? "" : error ? "" : (data?.connectionUri ?? "")
                  }
                  placeholder={isLoading ? "Loading…" : ""}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  disabled={!data?.connectionUri}
                  aria-label="Copy URL"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {getErrorMessage(error)}
                </p>
              )}
            </div>

            {showBranchSwitchCta && (
              <div
                data-testid="vercel-branch-switch-cta"
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-300" />
                  <div className="flex-1 space-y-2">
                    <p className="text-amber-900 dark:text-amber-100">
                      Your Vercel deployment is still using the{" "}
                      <strong>{lastSyncedBranchType}</strong> branch. Switching
                      to <strong>{branchType}</strong> will require pushing new
                      env vars and will invalidate any active sessions on the
                      live site.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSync}
                      disabled={syncMutation.isPending}
                    >
                      {syncMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Syncing…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Sync to Vercel
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {showDriftBanner && (
              <div
                data-testid="vercel-drift-banner"
                className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm dark:border-yellow-800 dark:bg-yellow-900/20"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-300" />
                  <div className="flex-1">
                    <p className="text-yellow-900 dark:text-yellow-100">
                      Vercel env vars or trusted domain differ from the last
                      successful sync.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasVercelProject && !showBranchSwitchCta && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Push the current connection string and Neon Auth allowlist to
                  Vercel.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMutation.isPending}
                  data-testid="vercel-sync-button"
                >
                  {syncMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync to Vercel
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
