import { useAtomValue, useSetAtom } from "jotai";
import {
  clearPackageManagerWarningForAppAtom,
  currentPackageManagerWarningAtom,
  dismissPackageManagerWarningForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useRebuildAppAfterPnpmInstall } from "@/hooks/useRunApp";
import { ExternalLink, Loader2, PackageCheck, Shield, X } from "lucide-react";
import { useState } from "react";

type InstallStatus = "idle" | "installing" | "success" | "error";

function getInstallErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Could not install pnpm because of ${String(error)}`;
}

export function PackageManagerWarningBanner() {
  const warning = useAtomValue(currentPackageManagerWarningAtom);
  const clearWarning = useSetAtom(clearPackageManagerWarningForAppAtom);
  const dismissWarning = useSetAtom(dismissPackageManagerWarningForAppAtom);
  const rebuildAppAfterPnpmInstall = useRebuildAppAfterPnpmInstall();
  const { updateSettings } = useSettings();
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [installErrorMessage, setInstallErrorMessage] = useState<string>();

  if (!warning) {
    return null;
  }

  const suppressFutureWarnings = () =>
    updateSettings({ hidePnpmMinimumReleaseAgeWarning: true });

  const handleDismiss = () => {
    dismissWarning();
  };

  const handleOpenDocs = () => {
    void ipc.system.openExternalUrl("https://pnpm.io/installation");
  };

  const handleInstallPnpm = async () => {
    setInstallStatus("installing");
    setInstallErrorMessage(undefined);

    try {
      await ipc.system.installPnpm();
      if (warning.appId !== null) {
        await rebuildAppAfterPnpmInstall(warning.appId);
      }
      setInstallStatus("success");
      window.setTimeout(() => clearWarning(), 2_000);
    } catch (error) {
      setInstallStatus("error");
      setInstallErrorMessage(getInstallErrorMessage(error));
    } finally {
      void suppressFutureWarnings();
    }
  };

  const isInstalling = installStatus === "installing";
  const isSuccess = installStatus === "success";
  const isError = installStatus === "error";
  const displayMessage = isSuccess
    ? "pnpm installed. Rebuilding preview..."
    : isError
      ? `${installErrorMessage}.`
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
          Install the latest pnpm for better security and less disk space
        </TooltipContent>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-1.5">
        {isError ? (
          <Button size="sm" variant="ghost" onClick={handleOpenDocs}>
            <ExternalLink className="size-3.5" />
            Docs
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
          onClick={handleDismiss}
          aria-label="Dismiss pnpm warning"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
