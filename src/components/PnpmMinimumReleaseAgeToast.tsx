import { toast } from "sonner";
import { ExternalLink, PackageCheck, X } from "lucide-react";
import { Button } from "./ui/button";

interface PnpmMinimumReleaseAgeToastProps {
  message: string;
  toastId: string | number;
  onInstallPnpm: () => void;
  onNeverShowAgain: () => void;
}

export function PnpmMinimumReleaseAgeToast({
  message,
  toastId,
  onInstallPnpm,
  onNeverShowAgain,
}: PnpmMinimumReleaseAgeToastProps) {
  const handleClose = () => {
    toast.dismiss(toastId);
  };

  const handleNeverShowAgain = () => {
    onNeverShowAgain();
    toast.dismiss(toastId);
  };

  const handleInstallPnpm = () => {
    onInstallPnpm();
    toast.dismiss(toastId);
  };

  return (
    <div className="relative bg-amber-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-amber-200 dark:border-slate-600 rounded-xl shadow-lg min-w-[380px] max-w-[480px] overflow-hidden">
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
                Update pnpm
              </h3>

              <button
                type="button"
                onClick={handleClose}
                className="ml-auto flex-shrink-0 p-1.5 text-amber-600 dark:text-slate-400 hover:text-amber-800 dark:hover:text-slate-200 transition-colors duration-200 rounded-md hover:bg-amber-100/60 dark:hover:bg-slate-700/50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mb-4 text-[14px] text-amber-900 dark:text-slate-200 leading-relaxed">
              {message}
            </p>

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={handleNeverShowAgain}
                size="sm"
                variant="ghost"
                className="text-amber-700 dark:text-slate-400 hover:text-amber-900 dark:hover:text-slate-200 hover:bg-amber-100/60 dark:hover:bg-slate-700/50"
              >
                Never show again
              </Button>
              <Button onClick={handleInstallPnpm} size="sm" variant="outline">
                <ExternalLink className="w-3.5 h-3.5" />
                Install pnpm
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
