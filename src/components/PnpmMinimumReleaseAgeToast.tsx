import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  Download,
  PackageCheck,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { isVersionAtLeast } from "@/shared/version_utils";

interface PnpmMinimumReleaseAgeToastProps {
  toastId: string | number;
  message: string;
  onInstallPnpm: () => Promise<void>;
  onOpenDocs: () => void;
  onNeverShowAgain: () => void;
}

const DEFAULT_MESSAGE =
  "Get the latest pnpm for the safest development experience.";
const PNPM_11_MINIMUM_NODE_VERSION = "22.13.0";

type InstallStatus = "idle" | "installing" | "success" | "error";

function getInstallErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Could not install pnpm because of ${String(error)}`;
}

export function PnpmMinimumReleaseAgeToast({
  toastId,
  message,
  onInstallPnpm,
  onOpenDocs,
  onNeverShowAgain,
}: PnpmMinimumReleaseAgeToastProps) {
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [installErrorMessage, setInstallErrorMessage] = useState<string>();
  const { data: nodeSystemInfo } = useQuery({
    queryKey: queryKeys.system.nodejsStatus,
    queryFn: () => ipc.system.getNodejsStatus(),
  });

  const handleClose = () => {
    toast.dismiss(toastId);
  };

  const handleNeverShowAgain = () => {
    onNeverShowAgain();
    toast.dismiss(toastId);
  };

  const handleInstallPnpm = async () => {
    setInstallStatus("installing");
    setInstallErrorMessage(undefined);

    try {
      await onInstallPnpm();
      setInstallStatus("success");
      window.setTimeout(() => toast.dismiss(toastId), 2_000);
    } catch (error) {
      setInstallStatus("error");
      setInstallErrorMessage(getInstallErrorMessage(error));
    }
  };

  const isInstalling = installStatus === "installing";
  const isError = installStatus === "error";
  const isSuccess = installStatus === "success";
  const showBenefits = !isSuccess && !isError;
  const needsNodeUpgrade =
    nodeSystemInfo !== undefined &&
    (!nodeSystemInfo.nodeVersion ||
      !isVersionAtLeast(
        nodeSystemInfo.nodeVersion,
        PNPM_11_MINIMUM_NODE_VERSION,
      ));
  const displayMessage =
    installStatus === "success"
      ? "pnpm successfully installed"
      : installStatus === "error"
        ? `${installErrorMessage}. Please read pnpm docs for other installation options.`
        : needsNodeUpgrade
          ? `pnpm v11 requires Node.js ${PNPM_11_MINIMUM_NODE_VERSION} or newer. Download and install the latest Node.js first.`
          : message || DEFAULT_MESSAGE;

  const handleOpenDocs = () => {
    onOpenDocs();
  };

  const handleDownloadNode = () => {
    if (!nodeSystemInfo) {
      return;
    }

    void ipc.system.openExternalUrl(nodeSystemInfo.nodeDownloadUrl);
  };

  return (
    <div className="relative bg-amber-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-amber-200 dark:border-slate-600 rounded-lg shadow-lg min-w-[380px] max-w-[480px] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="flex items-center mb-3">
              <div className="flex-shrink-0">
                <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-amber-600 dark:from-amber-400 dark:to-amber-500 rounded-full flex items-center justify-center shadow-sm">
                  <PackageCheck className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <h3 className="ml-3 text-sm font-semibold text-amber-900 dark:text-amber-100">
                Install pnpm
              </h3>
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-200/70 dark:bg-amber-400/20 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200 ring-1 ring-inset ring-amber-300/60 dark:ring-amber-400/30">
                Recommended
              </span>

              <button
                type="button"
                onClick={handleClose}
                className="ml-auto flex-shrink-0 p-1.5 text-amber-600 dark:text-slate-400 hover:text-amber-800 dark:hover:text-slate-200 transition-colors duration-200 rounded-md hover:bg-amber-100/60 dark:hover:bg-slate-700/50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mb-3 text-[14px] text-amber-900 dark:text-slate-200 leading-relaxed">
              {displayMessage}
            </p>

            {showBenefits && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-amber-800 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                  More secure
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                  Faster installs
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleNeverShowAgain}
                className="text-[12px] text-amber-700/80 dark:text-slate-400 hover:text-amber-900 dark:hover:text-slate-200 underline-offset-2 hover:underline transition-colors"
              >
                Never show again
              </button>
              {isError ? (
                <Button onClick={handleOpenDocs} size="sm" variant="default">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open docs
                </Button>
              ) : needsNodeUpgrade ? (
                <Button
                  onClick={handleDownloadNode}
                  size="sm"
                  variant="default"
                  disabled={isSuccess}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Node.js
                </Button>
              ) : (
                <Button
                  onClick={handleInstallPnpm}
                  size="sm"
                  variant="default"
                  disabled={isInstalling || isSuccess}
                >
                  {isInstalling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PackageCheck className="w-3.5 h-3.5" />
                  )}
                  Install pnpm
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
