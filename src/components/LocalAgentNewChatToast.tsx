import { toast } from "sonner";
import { X, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";

interface LocalAgentNewChatToastProps {
  toastId: string | number;
  onNeverShowAgain: () => void;
}

export function LocalAgentNewChatToast({
  toastId,
  onNeverShowAgain,
}: LocalAgentNewChatToastProps) {
  const { t } = useTranslation("chat");
  const handleClose = () => {
    toast.dismiss(toastId);
  };

  const handleNeverShowAgain = () => {
    onNeverShowAgain();
    toast.dismiss(toastId);
  };

  return (
    <div className="relative bg-blue-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-blue-200 dark:border-slate-600 rounded-xl shadow-lg min-w-[380px] max-w-[450px] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="flex items-center mb-3">
              <div className="flex-shrink-0">
                <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500 rounded-full flex items-center justify-center shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <h3 className="ml-3 text-sm font-semibold text-blue-900 dark:text-blue-100">
                {t("agentModeActivated")}
              </h3>

              {/* Close button */}
              <button
                type="button"
                onClick={handleClose}
                className="ml-auto flex-shrink-0 p-1.5 text-blue-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-slate-200 transition-colors duration-200 rounded-md hover:bg-blue-100/50 dark:hover:bg-slate-700/50"
                aria-label={t("close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Message */}
            <div className="mb-4">
              <p className="text-[14px] text-blue-800 dark:text-slate-200 leading-relaxed">
                {t("agentModeTip")}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={handleNeverShowAgain}
                size="sm"
                variant="ghost"
                className="text-blue-600 dark:text-slate-400 hover:text-blue-800 dark:hover:text-slate-200 hover:bg-blue-100/50 dark:hover:bg-slate-700/50"
              >
                {t("neverShowAgain")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
