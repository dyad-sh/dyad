import { useAtomValue, useSetAtom } from "jotai";
import {
  clearPackageManagerWarningForAppAtom,
  currentPackageManagerWarningAtom,
  dismissPackageManagerWarningsAtom,
  type PackageManagerWarning,
} from "@/atoms/previewRuntimeAtoms";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useRebuildAppAfterPnpmInstall, useRunApp } from "@/hooks/useRunApp";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { isVersionAtLeast } from "@/shared/version_utils";
import {
  Download,
  ExternalLink,
  Loader2,
  PackageCheck,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type InstallStatus = "idle" | "installing" | "success" | "error";

const PNPM_11_MINIMUM_NODE_VERSION = "22.13.0";

function getInstallErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Could not install pnpm because of ${String(error)}`;
}

export function PackageManagerWarningBanner() {
  const warning = useAtomValue(currentPackageManagerWarningAtom);

  if (!warning) {
    return null;
  }

  // Keying by warning identity resets install state whenever a different
  // warning is shown; unmounting on clear resets it between warnings.
  return (
    <PackageManagerWarningBannerContent
      key={`${warning.appId}:${warning.message}`}
      warning={warning}
    />
  );
}

function PackageManagerWarningBannerContent({
  warning,
}: {
  warning: PackageManagerWarning;
}) {
  const clearWarning = useSetAtom(clearPackageManagerWarningForAppAtom);
  const dismissWarnings = useSetAtom(dismissPackageManagerWarningsAtom);
  const rebuildAppAfterPnpmInstall = useRebuildAppAfterPnpmInstall();
  const { restartApp } = useRunApp();
  const { updateSettings } = useSettings();
  const queryClient = useQueryClient();
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [installErrorMessage, setInstallErrorMessage] = useState<string>();
  const clearTimerRef = useRef<number | undefined>(undefined);
  const { data: nodeSystemInfo } = useQuery({
    queryKey: queryKeys.system.nodejsStatus,
    queryFn: () => ipc.system.getNodejsStatus(),
  });

  useEffect(() => {
    return () => window.clearTimeout(clearTimerRef.current);
  }, []);

  const suppressFutureWarnings = () =>
    updateSettings({ hidePnpmMinimumReleaseAgeWarning: true });

  const isPnpmMigrationWarning = warning.kind === "pnpm-migration";

  const handleOpenDocs = () => {
    void ipc.system.openExternalUrl(
      isPnpmMigrationWarning
        ? "https://dyad.sh/docs/upgrades/pnpm-migration"
        : "https://pnpm.io/installation",
    );
  };

  const handleDownloadNode = () => {
    if (!nodeSystemInfo) {
      return;
    }

    void ipc.system.openExternalUrl(nodeSystemInfo.nodeDownloadUrl);
  };

  const handleInstallPnpm = async () => {
    setInstallStatus("installing");
    setInstallErrorMessage(undefined);

    try {
      await ipc.system.installPnpm();
      await rebuildAppAfterPnpmInstall(warning.appId);
      setInstallStatus("success");
      clearTimerRef.current = window.setTimeout(
        () => clearWarning(warning.appId),
        2_000,
      );
    } catch (error) {
      setInstallStatus("error");
      setInstallErrorMessage(getInstallErrorMessage(error));
    } finally {
      void suppressFutureWarnings();
    }
  };

  const handleMigratePnpm = async () => {
    setInstallStatus("installing");
    setInstallErrorMessage(undefined);

    try {
      await ipc.upgrade.executeAppUpgrade({
        appId: warning.appId,
        upgradeId: "pnpm-version-migration",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.appUpgrades.byApp({ appId: warning.appId }),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.versions.list({ appId: warning.appId }),
        }),
      ]);
      setInstallStatus("success");
      await restartApp();
    } catch (error) {
      setInstallStatus("error");
      setInstallErrorMessage(getInstallErrorMessage(error));
    }
  };

  const isInstalling = installStatus === "installing";
  const isSuccess = installStatus === "success";
  const isError = installStatus === "error";
  const needsNodeUpgrade =
    !isPnpmMigrationWarning &&
    nodeSystemInfo !== undefined &&
    (!nodeSystemInfo.nodeVersion ||
      !isVersionAtLeast(
        nodeSystemInfo.nodeVersion,
        PNPM_11_MINIMUM_NODE_VERSION,
      ));
  const displayMessage = isSuccess
    ? isPnpmMigrationWarning
      ? "pnpm migration applied. Restarting preview..."
      : "pnpm installed. Rebuilding preview..."
    : isError
      ? `${installErrorMessage}.`
      : needsNodeUpgrade
        ? `pnpm v11 requires Node.js ${PNPM_11_MINIMUM_NODE_VERSION} or newer. Download and install the latest Node.js first.`
        : warning.message;
  return (
    <div
      className="flex min-h-10 items-center gap-3 border-b border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100"
      data-testid="package-manager-warning-banner"
    >
      <Shield className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate text-left">
              {displayMessage}
            </span>
          }
        />
        <TooltipContent side="bottom" align="start" className="max-w-md">
          {displayMessage}
        </TooltipContent>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-1.5">
        {isPnpmMigrationWarning ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleMigratePnpm}
            disabled={isInstalling || isSuccess}
            data-testid="package-manager-warning-run-upgrade"
          >
            {isInstalling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PackageCheck className="size-3.5" />
            )}
            {isInstalling ? "Migrating" : "Migrate"}
          </Button>
        ) : isError ? (
          <Button size="sm" variant="ghost" onClick={handleOpenDocs}>
            <ExternalLink className="size-3.5" />
            Docs
          </Button>
        ) : needsNodeUpgrade ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDownloadNode}
            disabled={isSuccess}
          >
            <Download className="size-3.5" />
            Download Node.js
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleInstallPnpm}
            disabled={isInstalling || isSuccess}
          >
            {isInstalling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PackageCheck className="size-3.5" />
            )}
            Install
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => dismissWarnings(warning.appId)}
          aria-label="Dismiss pnpm warning"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
